const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const Order = require('../models/Order');
const { isLoggedIn, allowRoles } = require('../middleware/auth');

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// kind: 'admin' ya 'bulkbuyer'
module.exports = (kind) => {
  const router = express.Router();
  const isAdmin = kind === 'admin';
  const base = isAdmin ? '/admin/delivery' : '/buyer/delivery';

  router.use(isLoggedIn, allowRoles(isAdmin ? 'admin' : 'bulkbuyer'));
  router.use((req, res, next) => {
    res.locals.dBase = base;
    res.locals.dKind = kind;
    next();
  });

  // is manager ke orders aur partners
  const myOrders = (req) => isAdmin
    ? { deliveryBy: 'admin' }
    : { deliveryBy: 'bulkbuyer', deliveryManager: req.session.user.id };
  const myPartners = (req) => isAdmin
    ? { role: 'delivery', managedByRole: 'admin' }
    : { role: 'delivery', managedBy: req.session.user.id };

  // Page: partners + orders
  router.get('/', async (req, res) => {
    const status = ['accepted', 'shipped', 'delivered'].includes(req.query.status) ? req.query.status : 'accepted';

    const [partners, orders] = await Promise.all([
      User.find(myPartners(req)).select('-password').sort({ createdAt: -1 }),
      Order.find({ ...myOrders(req), status })
        .populate('crop', 'name location')
        .populate('buyer', 'name phone businessName')
        .populate('kisan', 'name phone village businessName')    // kisan = seller
        .populate('deliveryPartner', 'name phone')
        .sort({ createdAt: -1 })
        .limit(100)
    ]);

    res.render('delivery/manage', { title: 'Delivery management', partners, orders, status });
  });

  // Naya delivery partner banao
  router.post('/partners', async (req, res) => {
    const name = str(req.body.name, 60);
    const email = str(req.body.email, 100).toLowerCase();
    const phone = str(req.body.phone, 15);
    const vehicle = str(req.body.vehicle, 40);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!name || !/^\S+@\S+\.\S+$/.test(email) || !/^[6-9]\d{9}$/.test(phone) || password.length < 8) {
      req.flash('error', 'Naam, sahi email, 10 digit phone aur kam se kam 8 character ka password daalo');
      return res.redirect(base);
    }
    if (await User.findOne({ email })) {
      req.flash('error', 'Is email ka account pehle se hai');
      return res.redirect(base);
    }

    await User.create({
      name, email, phone, vehicle,
      password: await bcrypt.hash(password, 10),
      role: 'delivery',
      managedBy: req.session.user.id,
      managedByRole: kind
    });

    req.flash('success', `${name} ko delivery partner bana diya. Email aur password unhe de do.`);
    res.redirect(base);
  });

  // Partner ko on/off karo
  router.patch('/partners/:id/toggle', async (req, res) => {
    const { id } = req.params;
    const p = mongoose.isValidObjectId(id) ? await User.findOne({ _id: id, ...myPartners(req) }) : null;

    if (!p) {
      req.flash('error', 'Partner nahi mila');
      return res.redirect(base);
    }
    if (p.isBlocked) {
      await User.updateOne({ _id: p._id }, { isBlocked: false, $unset: { blockReason: 1 } });
    } else {
      await User.updateOne({ _id: p._id }, { isBlocked: true, blockReason: 'Deactivated by manager' });
    }
    req.flash('success', p.isBlocked ? `${p.name} activate ho gaya` : `${p.name} deactivate ho gaya`);
    res.redirect(base);
  });

   // Assign a partner (also lets you reassign a failed delivery)
  router.patch('/orders/:id/assign', async (req, res) => {
    const { id } = req.params;
    const pid = str(req.body.partner, 30);

    const partner = mongoose.isValidObjectId(pid)
      ? await User.findOne({ _id: pid, ...myPartners(req), isBlocked: { $ne: true } })
      : null;

    const order = partner && mongoose.isValidObjectId(id)
      ? await Order.findOneAndUpdate(
          {
            _id: id, ...myOrders(req),
            $or: [
              { status: 'accepted' },
              { status: 'shipped', 'deliveryIssue.reason': { $exists: true } }
            ]
          },
          {
            $set: { deliveryPartner: partner._id, assignedAt: new Date(), codeTries: 0 },
            $unset: { deliveryIssue: 1, partnerLoc: 1 }
          }
        )
      : null;

    req.flash(order ? 'success' : 'error',
      order ? `Order assigned to ${partner.name}` : 'Could not assign this order');
    res.redirect(base);
  });

  return router;
};