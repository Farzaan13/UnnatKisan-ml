const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { isLoggedIn, allowRoles } = require('../middleware/auth');

const router = express.Router();
router.use(isLoggedIn, allowRoles('delivery'));

const FAIL_REASONS = [
  'Buyer not available',
  'Wrong or incomplete address',
  'Could not reach the buyer',
  'Buyer refused the order',
  'Other'
];
const MAX_CODE_TRIES = 5;
const back = '/delivery/dashboard';

// My assigned orders
router.get('/dashboard', async (req, res) => {
  const tab = req.query.tab === 'done' ? 'done' : 'active';

  const orders = await Order.find({
    deliveryPartner: req.session.user.id,
    status: tab === 'done' ? 'delivered' : { $in: ['accepted', 'shipped'] }
  })
    .populate('crop', 'name location lat lng')
    .populate('buyer', 'name phone businessName')
    .populate('kisan', 'name phone village businessName')   // kisan = seller
    .sort({ assignedAt: -1 })
    .limit(100);

  res.render('delivery/dashboard', {
    title: 'My deliveries', orders, tab, failReasons: FAIL_REASONS
  });
});

// Pickup: accepted -> shipped, and create the delivery code
router.patch('/orders/:id/pickup', async (req, res) => {
  const { id } = req.params;
  let order = null;

  if (mongoose.isValidObjectId(id)) {
    order = await Order.findOneAndUpdate(
      {
        _id: id, deliveryPartner: req.session.user.id, status: 'accepted',
        // online payment must be verified before the goods are picked up
        $or: [{ paymentMethod: { $ne: 'online' } }, { paymentStatus: 'paid' }]
      },
      {
        $set: { status: 'shipped', deliveryCode: String(crypto.randomInt(1000, 10000)), codeTries: 0 },
        $unset: { deliveryIssue: 1 },
        $push: { statusHistory: { status: 'shipped', at: new Date() } }
      }
    );
  }

  req.flash(order ? 'success' : 'error',
    order ? 'Pickup confirmed. Ask the buyer for the delivery code.'
          : 'This action is not possible (online payment may not be verified yet)');
  res.redirect(back);
});

// Delivered: needs the buyer's code
router.patch('/orders/:id/deliver', async (req, res) => {
  const { id } = req.params;
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';

  const o = mongoose.isValidObjectId(id)
    ? await Order.findOne({ _id: id, deliveryPartner: req.session.user.id, status: 'shipped' })
    : null;

  if (!o) {
    req.flash('error', 'This action is not possible');
    return res.redirect(back);
  }

  // older orders (before this feature) have no code, so they can be delivered without one
  if (o.deliveryCode) {
    if (o.codeTries >= MAX_CODE_TRIES) {
      req.flash('error', 'Too many wrong codes. Please report this delivery as failed.');
      return res.redirect(back);
    }
    if (code !== o.deliveryCode) {
      await Order.updateOne({ _id: o._id }, { $inc: { codeTries: 1 } });
      req.flash('error', 'Wrong delivery code. Ask the buyer to check the code on their Orders page.');
      return res.redirect(back);
    }
  }

  const updated = await Order.findOneAndUpdate(
    { _id: o._id, deliveryPartner: req.session.user.id, status: 'shipped' },
    {
      $set: { status: 'delivered' },
      $unset: { deliveryIssue: 1, partnerLoc: 1 },
      $push: { statusHistory: { status: 'delivered', at: new Date() } }
    }
  );

  // COD: the cash has been collected
  if (updated && updated.paymentMethod !== 'online') {
    await Order.updateOne({ _id: o._id }, { $set: { paymentStatus: 'paid', paidAt: new Date() } });
  }

  req.flash(updated ? 'success' : 'error', updated ? 'Delivery completed' : 'This action is not possible');
  res.redirect(back);
});

// Delivery failed: record the reason, the manager will see it
router.patch('/orders/:id/fail', async (req, res) => {
  const { id } = req.params;
  const reason = FAIL_REASONS.includes(req.body.reason) ? req.body.reason : null;
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 200) : '';

  const order = reason && mongoose.isValidObjectId(id)
    ? await Order.findOneAndUpdate(
        { _id: id, deliveryPartner: req.session.user.id, status: 'shipped' },
        { $set: { deliveryIssue: { reason, note, at: new Date() } } }
      )
    : null;

  req.flash(order ? 'success' : 'error',
    order ? 'Failed delivery reported to your manager' : 'Please choose a reason');
  res.redirect(back);
});

// Live location (called every ~15 seconds by the dashboard while sharing is on)
router.post('/location', express.json({ limit: '1kb' }), async (req, res) => {
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ ok: false });
  }
  // only orders that are on the way get the location
  await Order.updateMany(
    { deliveryPartner: req.session.user.id, status: 'shipped' },
    { $set: { partnerLoc: { lat, lng, at: new Date() } } }
  );
  res.json({ ok: true });
});

module.exports = router;