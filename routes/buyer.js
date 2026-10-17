const express = require('express');
const mongoose = require('mongoose');
const Crop = require('../models/Crop');
const Order = require('../models/Order');
const User = require('../models/User');
const { isLoggedIn, allowRoles } = require('../middleware/auth');
const { orderRules, checkoutRules, handleErrors } = require('../middleware/validators');
const uploadImage = require('../middleware/upload');

const uploadBuffer = require('../utils/cloudinary');
const { CITY_NAMES, CITIES } = require('../utils/cities');
const { roadKmToCity } = require('../utils/geo');

const CATEGORIES = ['vegetable', 'fruit', 'grain', 'pulse', 'other'];
const SORTS = { new: { createdAt: -1 }, low: { price: 1 }, high: { price: -1 } };
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = (role) => {
  const router = express.Router();
  const isBulk = role === 'bulkbuyer';
  const base = isBulk ? '/buyer' : '/customer';

  router.use(isLoggedIn, allowRoles(role));
  router.use((req, res, next) => {
    res.locals.base = base;
    res.locals.buyerRole = role;
    next();
  });

  // Crops ki list + search/filter
  // Crops ki list + search/filter
  router.get('/dashboard', async (req, res) => {
    // query string kabhi array bhi ho sakti hai, isliye sirf string lo
    const str = (v) => (typeof v === 'string' ? v : '');
    const q = str(req.query.q).trim();
    const category = str(req.query.category);
    const sort = str(req.query.sort) || 'new';
    const maxPrice = str(req.query.maxPrice);
    const need = str(req.query.need);

    const query = { quantity: { $gt: 0 }, kisan: { $ne: req.session.user.id }, verified: 'verified' };

    // naam, location, description ya kisan (naam / gaon / FPO) se dhundo
    if (q) {
      const rx = { $regex: escapeRegex(q), $options: 'i' };
      const kisans = await User.find({
        role: 'kisan',
        $or: [{ name: rx }, { village: rx }, { fpoName: rx }]
      }).select('_id');

      query.$or = [
        { name: rx },
        { location: rx },
        { description: rx },
        { kisan: { $in: kisans.map((k) => k._id) } }
      ];
    }

    if (CATEGORIES.includes(category)) query.category = category;

    if (isBulk) {
      // bulkbuyer ko sirf wahi crops jinka stock bulk minimum se kam na ho
      query.$expr = { $gte: ['$quantity', '$minBulkQty'] };

      // "mujhe itna chahiye": stock itna ho aur minimum order itna ya usse kam ho
      const want = parseInt(need, 10);
      if (want > 0) {
        query.quantity = { $gte: want };
        query.minBulkQty = { $lte: want };
      }
    }

    let crops = await Crop.find(query).sort({ createdAt: -1 });
    // customer ko sirf wahi crops jinka stock category ke minimum se kam na ho
    if (!isBulk) crops = crops.filter((c) => c.quantity >= c.minQtyFor(role));

    // price filter aur sort us rate par jo is buyer ko dikhta hai (customer ya bulk)
    const unit = (c) => c.priceFor(role);
    const max = Number(maxPrice);
    if (max > 0) crops = crops.filter((c) => unit(c) <= max);
    if (sort === 'low') crops.sort((a, b) => unit(a) - unit(b));
    else if (sort === 'high') crops.sort((a, b) => unit(b) - unit(a));

    res.render(isBulk ? 'bulk/dashboard' : 'buyer/dashboard', {
      title: 'Crops', crops, categories: CATEGORIES,
      filters: { q, category, sort, maxPrice, need }
    });
  });
  // Mere orders (ye route /crops/:id se pehle rakho)
  router.get('/orders', async (req, res) => {
    const orders = await Order.find({ buyer: req.session.user.id })
      .populate('crop', 'name')
      .populate('kisan', 'name phone village')
      .sort({ createdAt: -1 });
    res.render('buyer/orders', { title: 'Mere orders', orders });
  });

  // Crop ka detail aur order form
  router.get('/crops/:id', async (req, res) => {
    const { id } = req.params;
    const crop = mongoose.isValidObjectId(id)
      ? await Crop.findById(id).populate('kisan', 'name village fpoName businessName')
      : null;

    if (!crop || crop.verified !== 'verified') {
      req.flash('error', 'crop not found');
      return res.redirect(base + '/dashboard');
    }
    if (crop.kisan.equals(req.session.user.id)) {
      req.flash('error', 'You cannot buy your own crop');
      return res.redirect(base + '/dashboard');
    }
    res.render('buyer/crop', { title: crop.name, crop, cities: CITY_NAMES, cityCoords: CITIES });
  });

  // Order place karo
  router.post('/crops/:id/order',
    uploadImage, orderRules,
    handleErrors((req) => `${base}/crops/${req.params.id}`),
    async (req, res) => {
      const { id } = req.params;
      const { deliveryCity, deliveryAddress } = req.body;
      const qty = parseInt(req.body.quantity, 10);

      // online payment sirf bulk buyer ke liye
      const method = isBulk && req.body.paymentMethod === 'online' ? 'online' : 'cod';
      const dropUpload = () => {  };
      if (method !== 'online') dropUpload();

      const crop = mongoose.isValidObjectId(id) ? await Crop.findById(id) : null;
      if (!crop || crop.verified !== 'verified') {
        dropUpload();
        req.flash('error', 'Crop not found');
        return res.redirect(base + '/dashboard');
      }
      const minNeeded = crop.minQtyFor(role);
      if (qty < minNeeded) {
        dropUpload();
        req.flash('error', `${isBulk ? 'Bulk order' : 'Retail order'} ke liye kam se kam ${minNeeded} kg lena hoga`);
        return res.redirect(`${base}/crops/${id}`);
      }

      // stock atomically kam karo (do log ek saath order karein to bhi stock negative nahi hoga)
      const reserved = await Crop.findOneAndUpdate(
        { _id: crop._id, quantity: { $gte: qty } },
        { $inc: { quantity: -qty } }
      );
      if (!reserved) {
        dropUpload();
        req.flash('error', 'not enough stock available now, please try again');
        return res.redirect(`${base}/crops/${id}`);
      }

      let order;
      try {
        let proofUrl;
        if (method === 'online' && req.file) proofUrl = await uploadBuffer(req.file, 'payment').secure_url;
        order = await Order.create({
          buyer: req.session.user.id,
          kisan: crop.kisan,
          crop: crop._id,
          quantity: qty,
          totalPrice: qty * crop.priceFor(role),
          orderType: isBulk ? 'bulk' : 'retail',
          deliveryCity,
          deliveryAddress,
          distanceKm: roadKmToCity(crop.lat, crop.lng, deliveryCity),
          paymentMethod: method,
          paymentStatus: method === 'online' ? 'submitted' : 'pending',
          transactionId: method === 'online' ? req.body.transactionId : undefined,
          paymentProof: proofUrl,
          statusHistory: [{ status: 'pending' }]
        });
      } catch (err) {
        dropUpload();
        await Crop.updateOne({ _id: crop._id }, { $inc: { quantity: qty } }); // stock wapas
        throw err;
      }

      req.flash('success', 'Order placed! Please check your order receipt.');
      res.redirect(`${base}/orders/${order._id}/confirmation`);
    }
  );

  // Order confirmation / receipt (sirf us order ka buyer dekh sakta hai)
  router.get('/orders/:id/confirmation', async (req, res) => {
    const { id } = req.params;
    const order = mongoose.isValidObjectId(id)
      ? await Order.findOne({ _id: id, buyer: req.session.user.id })
        .populate('crop', 'name category')
        .populate('kisan', 'name phone village fpoName')
        .populate('buyer', 'name phone email businessName')
      : null;

    if (!order) {
      req.flash('error', 'Order not found');
      return res.redirect(base + '/orders');
    }
    res.render('buyer/confirmation', { title: 'Order receipt', order });
  });

  // Bulk buyer: reject hui payment ka naya proof bhejo
  if (isBulk) {
    router.post('/orders/:id/payment', uploadImage, async (req, res) => {
      const { id } = req.params;
      const txn = (req.body.transactionId || '').trim();
      const back = `${base}/orders/${id}/confirmation`;

      if (!mongoose.isValidObjectId(id) || !/^[A-Za-z0-9]{8,30}$/.test(txn)) {
        req.flash('error', 'Please enter a valid UTR / transaction ID (8 to 30 characters)');
        return res.redirect(mongoose.isValidObjectId(id) ? back : base + '/orders');
      }

      const $set = { paymentStatus: 'submitted', transactionId: txn };
      if (req.file) $set.paymentProof = (await uploadBuffer(req.file, 'payment')).secure_url;

      const order = await Order.findOneAndUpdate(
        { _id: id, buyer: req.session.user.id, paymentMethod: 'online', paymentStatus: 'failed' },
        { $set }
      );

      req.flash(order ? 'success' : 'error',
        order ? 'New payment proof submitted, kisan will verify it' : 'You cannot submit a new proof at this time');
      res.redirect(order ? back : base + '/orders');
    });
  }

  // ================= CART =================
  const minOf = (crop) => crop.minQtyFor(role);
  const cartOf = (req) => req.session.cart || {};
  // session save hone ke baad hi redirect (warna cart kabhi kabhi gayab dikhta hai)
  const go = (req, res, to) => req.session.save(() => res.redirect(to));

  // Cart dekho
  router.get('/cart', async (req, res) => {
    const cart = cartOf(req);
    const ids = Object.keys(cart).filter((k) => mongoose.isValidObjectId(k));
    const crops = ids.length
          ? await Crop.find({ _id: { $in: ids }, verified: 'verified' }).populate('kisan', 'name village')
      : [];

    // jo crops ab maujood nahi, unhe cart se hata do
    const found = new Set(crops.map((c) => c._id.toString()));
    Object.keys(cart).forEach((k) => { if (!found.has(k)) delete cart[k]; });
    req.session.cart = cart;

    const groupMap = new Map();
    let grandTotal = 0;
    crops.forEach((crop) => {
      const qty = cart[crop._id.toString()];
      const unit = crop.priceFor(role);
      const line = {
        crop, qty,
        min: minOf(crop),
        unitPrice: unit,
        amount: qty * unit,
        problem: qty > crop.quantity
          ? `now only ${crop.quantity} kg is available`
          : qty < minOf(crop) ? `now only ${minOf(crop)} kg is required` : null
      };
      const key = crop.kisan ? crop.kisan._id.toString() : 'unknown';
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          kisanId: key,
          kisanName: crop.kisan ? crop.kisan.name : 'Kisan',
          village: crop.kisan ? crop.kisan.village : '',
          lines: [], subtotal: 0
        });
      }
      const g = groupMap.get(key);
      g.lines.push(line);
      g.subtotal += line.amount;
      grandTotal += line.amount;
    });

    res.render('buyer/cart', {
      title: 'My cart',
      groups: [...groupMap.values()],
      grandTotal,
      cities: CITY_NAMES,
      cityCoords: CITIES
    });
  });

  // Cart mein daalo
  router.post('/cart/add/:id', async (req, res) => {
    const { id } = req.params;
    const crop = mongoose.isValidObjectId(id) ? await Crop.findById(id) : null;
      if (!crop || crop.verified !== 'verified') {
      req.flash('error', 'Crop not found');
      return go(req, res, base + '/dashboard');
    }

    if (crop.kisan.equals(req.session.user.id)) {
      req.flash('error', 'You cannot buy your own crop');
      return go(req, res, base + '/dashboard');
    }

    const back = `${base}/crops/${id}`;
    let qty = parseInt(req.body.quantity, 10);
    if (!(qty >= 1)) qty = minOf(crop);

    const cart = cartOf(req);
    const newQty = (cart[id] || 0) + qty;

    if (newQty < minOf(crop)) {
      req.flash('error', `minimum ${minOf(crop)} kg purchase required for this crop`);
      return go(req, res, back);
    }
    if (newQty > crop.quantity) {
      req.flash('error', ` only ${crop.quantity} kg is available`);
      return go(req, res, back);
    }

    cart[id] = newQty;
    req.session.cart = cart;
    req.flash('success', `${crop.name} added to cart`);
    go(req, res, base + '/cart');
  });

  // Quantity badlo
  router.patch('/cart/update/:id', async (req, res) => {
    const { id } = req.params;
    const cart = cartOf(req);
    const crop = mongoose.isValidObjectId(id) && cart[id]
  ? await Crop.findOne({ _id: id, verified: 'verified' })
  : null;

    if (!crop) {
      req.flash('error', 'This item is not in your cart');
      return go(req, res, base + '/cart');
    }

    const qty = parseInt(req.body.quantity, 10);
    if (!(qty >= minOf(crop))) {
      req.flash('error', `${crop.name}: minimum ${minOf(crop)} kg purchase required`);
    } else if (qty > crop.quantity) {
      req.flash('error', `${crop.name}: only ${crop.quantity} kg is available`);
    } else {
      cart[id] = qty;
      req.session.cart = cart;
      req.flash('success', 'Quantity updated');
    }
    go(req, res, base + '/cart');
  });

  // Item hatao
  router.delete('/cart/remove/:id', (req, res) => {
    const cart = cartOf(req);
    delete cart[req.params.id];
    req.session.cart = cart;
    req.flash('success', 'Item removed from cart');
    go(req, res, base + '/cart');
  });

  // Checkout: har cart item ka alag order
  router.post('/cart/checkout',
    checkoutRules,
    handleErrors(`${base}/cart`),
    async (req, res) => {
      const cart = cartOf(req);
      const ids = Object.keys(cart).filter((k) => mongoose.isValidObjectId(k));
      if (!ids.length) {
        req.flash('error', 'Cart is empty');
        return go(req, res, base + '/cart');
      }

            const crops = await Crop.find({ _id: { $in: ids }, verified: 'verified' });
      const { deliveryCity, deliveryAddress } = req.body;
      const method = isBulk && req.body.paymentMethod === 'online' ? 'online' : 'cod';
      const utrOf = (kisanId) => (req.body['utr_' + kisanId] || '').trim();

      // online payment: har kisan ke liye sahi UTR chahiye
      if (method === 'online') {
        const bad = crops.some((c) => !/^[A-Za-z0-9]{8,30}$/.test(utrOf(c.kisan.toString())));
        if (bad) {
          req.flash('error', 'Please enter a valid UTR / transaction ID (8 to 30 characters)');
          return go(req, res, base + '/cart');
        }
      }

      const placed = [];
      const failed = [];

      for (const crop of crops) {
        const id = crop._id.toString();
        if (crop.kisan.equals(req.session.user.id)) {
          failed.push(`${crop.name} (my crop)`);
          continue;
        }
        const qty = cart[id];

        if (qty < minOf(crop)) {
          failed.push(`${crop.name} (minimum ${minOf(crop)} kg)`);
          continue;
        }

        // stock atomically kam karo
        const reserved = await Crop.findOneAndUpdate(
          { _id: crop._id, quantity: { $gte: qty } },
          { $inc: { quantity: -qty } }
        );
        if (!reserved) {
          failed.push(`${crop.name} (stock is less than ${qty} kg now)`);
          continue;
        }

        try {
          await Order.create({
            buyer: req.session.user.id,
            kisan: crop.kisan,
            crop: crop._id,
            quantity: qty,
            totalPrice: qty * crop.priceFor(role),
            orderType: isBulk ? 'bulk' : 'retail',
            deliveryCity,
            deliveryAddress,
            distanceKm: roadKmToCity(crop.lat, crop.lng, deliveryCity),
            paymentMethod: method,
            paymentStatus: method === 'online' ? 'submitted' : 'pending',
            transactionId: method === 'online' ? utrOf(crop.kisan.toString()) : undefined,
            statusHistory: [{ status: 'pending' }]
          });
          placed.push(id);
        } catch (err) {
          await Crop.updateOne({ _id: crop._id }, { $inc: { quantity: qty } }); // stock wapas
          failed.push(`${crop.name} (error occurred)`);
        }
      }

      // jo order ho gaye ya jo crops ab maujood nahi, unhe cart se hatao; baaki cart mein rahenge
      const stillExists = new Set(crops.map((c) => c._id.toString()));
      Object.keys(cart).forEach((k) => {
        if (placed.includes(k) || !stillExists.has(k)) delete cart[k];
      });
      req.session.cart = cart;

      if (placed.length) req.flash('success', `${placed.length} order(s) placed successfully.`);
      if (failed.length) req.flash('error', 'These items could not be ordered: ' + failed.join(', '));

      go(req, res, placed.length ? base + '/orders' : base + '/cart');
    }
  );



  return router;
};