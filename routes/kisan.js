const express = require('express');
const mongoose = require('mongoose');
const Crop = require('../models/Crop');
const Order = require('../models/Order');
const { isLoggedIn, allowRoles } = require('../middleware/auth');
const uploadImage = require('../middleware/upload');
const { cropRules, handleErrors } = require('../middleware/validators');

const { uploadBuffer, removeByUrl } = require('../utils/cloudinary');
const { CITY_NAMES } = require('../utils/cities');
const { planRoute } = require('../utils/geo');
const { buildSeries, forecast, WEEK_MS, WEEKS } = require('../utils/forecast');

const { chatCrop } = require('../utils/cropChat');
const router = express.Router();

// is router ke saare routes sirf logged-in kisan ke liye
router.use(isLoggedIn, allowRoles('kisan', 'bulkbuyer'));

// ===== Chatbot (crop listing helper) =====
const chatHits = new Map();   // user ke hisaab se rate limit (API ka kharcha bachane ke liye)

router.post('/chatbot', express.json({ limit: '10kb' }), async (req, res) => {
  const uid = req.session.user.id;
  const now = Date.now();
  const hits = (chatHits.get(uid) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (hits.length >= 20) {
    return res.status(429).json({ reply: 'Thodi der baad dobara try karo.', draft: null });
  }
  hits.push(now);
  chatHits.set(uid, hits);

  try {
      res.json(await chatCrop(req.body.messages, req.body.voice === true, req.body.lang));
  } catch (e) {
    console.error('chatbot:', e.message);
    res.status(500).json({ reply: 'Abhi chatbot kaam nahi kar raha. Form se crop add kar lo.', draft: null });
  }
});
const removeImage = (url) => {removeByUrl(url);
};

// kisan sirf apni hi crop edit/delete kar sake
const loadOwnCrop = async (req, res, next) => {
  const { id } = req.params;
  const crop = mongoose.isValidObjectId(id) ? await Crop.findById(id) : null;

  if (!crop || !crop.kisan.equals(req.session.user.id)) {
    req.flash('error', 'Crop not found or you do not have permission to edit it');
    return res.redirect('/kisan/dashboard');
  }
  req.crop = crop;
  next();
};

// Dashboard
router.get('/dashboard', async (req, res) => {
  const crops = await Crop.find({ kisan: req.session.user.id }).sort({ createdAt: -1 });
  const totalQty = crops.reduce((sum, c) => sum + c.quantity, 0);
  res.render('kisan/dashboard', { title: 'Kisan Dashboard', crops, totalQty });
});

// Nayi crop ka form
router.get('/crops/new', (req, res) => {
  res.render('kisan/new', { title: 'Add Crop' });
});

// Crop save
router.post('/crops',
  uploadImage, cropRules, handleErrors('/kisan/crops/new'),
  async (req, res) => {
    const { name, category, price, quantity, bulkPrice, minBulkQty, harvestDate, location, lat, lng, description } = req.body;
  let image;
  if(req.file) image = await uploadBuffer(req.file, 'crop').secure_url;
    await Crop.create({
      name, category, price, quantity, bulkPrice,
      sellerRole: req.session.user.role,
      location, description,

      lat: Number(lat), lng: Number(lng),
      minBulkQty: minBulkQty || undefined,
      harvestDate: harvestDate || undefined,
      image,
      kisan: req.session.user.id
    });

    req.flash('success', 'Crop added successfully, it will now be visible to customers after admin verification');
    res.redirect('/kisan/dashboard');
  }
);

// Edit form
router.get('/crops/:id/edit', loadOwnCrop, (req, res) => {
  res.render('kisan/edit', { title: 'Edit Crop', crop: req.crop });
});

// Update
router.put('/crops/:id',
  loadOwnCrop, uploadImage, cropRules,
  handleErrors((req) => `/kisan/crops/${req.params.id}/edit`),
  async (req, res) => {
    const crop = req.crop;
    const { name, category, price, quantity, bulkPrice, minBulkQty, harvestDate, location, lat, lng, description } = req.body;

        Object.assign(crop, {
      name, category, price, quantity, bulkPrice, location, description,
      lat: Number(lat), lng: Number(lng),
      minBulkQty: minBulkQty || crop.minBulkQty,
      harvestDate: harvestDate || undefined,
      verified: 'pending',      // edit ke baad admin dobara verify karega
      verifyNote: ''
    });
        req.flash('success', 'Crop updated. It will be visible again after admin verification');

    if (req.file) {
      const up = await uploadBuffer(req.file, 'crop');
      await removeImage(crop.image);
      crop.image = up.secure_url;
    }

    await crop.save();
    req.flash('success', 'Crop updated successfully');
    res.redirect('/kisan/dashboard');
  }
);

// Delete
router.delete('/crops/:id', loadOwnCrop, async (req, res) => {
   await removeImage(req.crop.image);
  await req.crop.deleteOne();
  req.flash('success', 'Crop deleted successfully');
  res.redirect('/kisan/dashboard');
});

// Kisan ke paas aaye orders
router.get('/orders', async (req, res) => {
  const orders = await Order.find({ kisan: req.session.user.id })
    .populate('buyer', 'name phone role businessName')
    .populate('crop', 'name')
    .sort({ createdAt: -1 });
  res.render('kisan/orders', { title: 'Aaye hue orders', orders });
});

// Order ka status badlo (sirf sahi sequence mein)
const transitions = {
  accept: { from: 'pending', to: 'accepted' },
  reject: { from: 'pending', to: 'rejected' },
  ship: { from: 'accepted', to: 'shipped' },
  deliver: { from: 'shipped', to: 'delivered' },
};

router.patch('/orders/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  const t = transitions[action];

  let order = null;
  if (t && mongoose.isValidObjectId(id)) {
    const update = {
      $set: { status: t.to },
      $push: { statusHistory: { status: t.to, at: new Date() } }
    };
    if (action === 'accept') {
      update.$set.trackingId = 'UK-' + Date.now().toString(36).toUpperCase();
    }

    const filter = { _id: id, kisan: req.session.user.id, status: t.from };

    if (action === 'reject') {
      delete filter.status;
      filter.$or = [
        { status: 'pending' },
        { status: 'accepted', paymentStatus: 'failed' }
      ];
    }
    // online payment verify hone se pehle ship nahi ho sakta
    if (action === 'ship') {
      filter.$or = [{ paymentMethod: { $ne: 'online' } }, { paymentStatus: 'paid' }];
    }

    order = await Order.findOneAndUpdate(filter, update);
  }

  if (!order) {
    req.flash('error', 'this action is not possible,  (may be online payment verify )');
    return res.redirect('/kisan/orders');
  }

  if (t.to === 'rejected') {
    await Crop.updateOne({ _id: order.crop }, { $inc: { quantity: order.quantity } });
  }

  // COD: delivery par cash mil gaya
  if (action === 'deliver' && order.paymentMethod !== 'online') {
    await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: 'paid', paidAt: new Date() } });
  }

  req.flash('success', `Order ${t.to} successfully`);
  res.redirect('/kisan/orders');
});

// Online payment verify / reject
router.patch('/orders/:id/payment/:decision', async (req, res) => {
  const { id, decision } = req.params;
  const to = { verify: 'paid', reject: 'failed' }[decision];

  let order = null;
  if (to && mongoose.isValidObjectId(id)) {
    const $set = { paymentStatus: to };
    if (to === 'paid') $set.paidAt = new Date();
    order = await Order.findOneAndUpdate(
      { _id: id, kisan: req.session.user.id, paymentMethod: 'online', paymentStatus: 'submitted' },
      { $set }
    );
  }

  req.flash(order ? 'success' : 'error',
    order ? (to === 'paid' ? 'Payment verified' : 'Payment proof rejected') : 'This action is not possible');
  res.redirect('/kisan/orders');
});

// Delivery plan: accepted orders ka optimized route
router.get('/delivery-plan', async (req, res) => {
  const pickup = CITY_NAMES.includes(req.query.pickup) ? req.query.pickup : 'Kanpur';

  const orders = await Order.find({ kisan: req.session.user.id, status: 'accepted' })
    .populate('crop', 'name')
    .populate('buyer', 'name phone')
    .sort({ createdAt: 1 });

  res.render('kisan/delivery', {
    title: 'Delivery plan', pickup, cities: CITY_NAMES,
    orderCount: orders.length, plan: planRoute(pickup, orders)
  });
});

// Insights: demand forecast
router.get('/insights', async (req, res) => {
  const crops = await Crop.find({ kisan: req.session.user.id });
  const names = [...new Set(crops.map((c) => c.name.trim().toLowerCase()))];

  const now = Date.now();
  const orders = await Order.find({
    status: { $ne: 'rejected' },
    createdAt: { $gte: new Date(now - WEEKS * WEEK_MS) }
  }).populate('crop', 'name');

  const insights = names.map((name) => {
    const series = buildSeries(
      orders.filter((o) => o.crop && o.crop.name.trim().toLowerCase() === name), now
    );
    const f = forecast(series);
    const stock = crops
      .filter((c) => c.name.trim().toLowerCase() === name)
      .reduce((sum, c) => sum + c.quantity, 0);

    const avg = f.predicted.reduce((a, b) => a + b, 0) / f.predicted.length;
    let advice = 'Stock is adequate.';
    if (series.every((v) => v === 0)) advice = 'No order data available yet, forecast will be visible later.';
    else if (stock < avg) advice = 'Upcoming week\'s demand exceeds stock, consider listing more stock.';
    else if (stock > avg * 3) advice = 'Stock significantly exceeds demand, consider lowering the price for faster sales.';

    return { name, series, stock, advice, ...f };
  });

  res.render('kisan/insights', { title: 'Demand insights', insights });
});

module.exports = router;




