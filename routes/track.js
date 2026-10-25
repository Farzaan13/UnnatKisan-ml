const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { isLoggedIn } = require('../middleware/auth');
const { CITIES } = require('../utils/cities');

const router = express.Router();
router.use(isLoggedIn);

// Who may see an order's tracking: the buyer, the seller, the manager, the partner, or an admin
async function loadAllowed(req) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return null;

  const order = await Order.findById(id)
    .populate('crop', 'name lat lng location')
    .populate('deliveryPartner', 'name phone');
  if (!order) return null;

  const me = String(req.session.user.id);
  const same = (x) => x && String(x._id || x) === me;
  const ok = req.session.user.role === 'admin'
    || same(order.buyer) || same(order.kisan) || same(order.deliveryManager) || same(order.deliveryPartner);
  return ok ? order : null;
}

router.get('/:id', async (req, res) => {
  const order = await loadAllowed(req);
  if (!order) {
    req.flash('error', 'Order not found');
    return res.redirect('/');
  }
  res.render('track/map', { title: 'Track delivery', orderId: order._id.toString() });
});

router.get('/:id/data', async (req, res) => {
  const order = await loadAllowed(req);
  if (!order) return res.status(404).json({ error: 'Not found' });

  const crop = order.crop;
  const drop = CITIES[order.deliveryCity];
  const p = order.deliveryPartner;

  res.json({
    cropName: crop ? crop.name : 'Crop',
    status: order.status,
    pickup: crop && Number.isFinite(crop.lat) && Number.isFinite(crop.lng)
      ? { lat: crop.lat, lng: crop.lng, label: crop.location || 'Pickup' } : null,
    drop: drop ? { lat: drop.lat, lng: drop.lng, label: order.deliveryCity } : null,
    partner: p ? { name: p.name, phone: p.phone } : null,
    // the location is shown only while the order is on its way
    loc: order.status === 'shipped' && order.partnerLoc && Number.isFinite(order.partnerLoc.lat)
      ? { lat: order.partnerLoc.lat, lng: order.partnerLoc.lng, at: order.partnerLoc.at } : null
  });
});

module.exports = router;