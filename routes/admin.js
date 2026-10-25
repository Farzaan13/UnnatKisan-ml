const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Crop = require('../models/Crop');
const Order = require('../models/Order');
const { isLoggedIn, allowRoles } = require('../middleware/auth');

const router = express.Router();
router.use(isLoggedIn, allowRoles('admin'));

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const str = (v) => (typeof v === 'string' ? v : '');

// ================= DASHBOARD =================
router.get('/dashboard', async (req, res) => {
  const [
    users, blocked, pendingCrops, orders,
    needPartner, failed, onTheWay, partners,
    roleRows, recentOrders
  ] = await Promise.all([
    User.countDocuments({ role: { $ne: 'admin' } }),
    User.countDocuments({ isBlocked: true }),
    Crop.countDocuments({ verified: 'pending' }),
    Order.countDocuments(),

    // admin-managed deliveries (farmer -> customer orders)
    Order.countDocuments({ deliveryBy: 'admin', status: 'accepted', deliveryPartner: null }),
    Order.countDocuments({ deliveryBy: 'admin', status: 'shipped', 'deliveryIssue.reason': { $exists: true } }),
    Order.countDocuments({ deliveryBy: 'admin', status: 'shipped' }),
    User.countDocuments({ role: 'delivery', managedByRole: 'admin', isBlocked: { $ne: true } }),

    User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]),
    Order.find()
      .populate('crop', 'name')
      .populate('buyer', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
  ]);

  const roles = { kisan: 0, bulkbuyer: 0, customer: 0, delivery: 0 };
  roleRows.forEach((r) => { if (r._id in roles) roles[r._id] = r.n; });

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    stats: { users, blocked, pendingCrops, orders, needPartner, failed, onTheWay, partners },
    roles,
    recentOrders
  });
});

// Saare users, role aur search se filter
router.get('/users', async (req, res) => {
 const role = ['kisan', 'bulkbuyer', 'customer', 'delivery'].includes(req.query.role) ? req.query.role : '';
  const q = str(req.query.q).trim();
  const filter = { role: role || { $ne: 'admin' } };
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: 'i' };
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  const users = await User.find(filter).select('-password').sort({ createdAt: -1 });
  res.render('admin/users', { title: 'Manage users', users, role, q });
});

router.patch('/users/:id/block', async (req, res) => {
  const { id } = req.params;
  const reason = str(req.body.reason).trim().slice(0, 200);
  const user = mongoose.isValidObjectId(id)
    ? await User.findOneAndUpdate({ _id: id, role: { $ne: 'admin' } },
        { isBlocked: true, blockReason: reason })
    : null;

  if (user) {
    // block hone wale ki live crops hata do (unblock par wapas verify karni padengi)
    await Crop.updateMany({ kisan: user._id, verified: 'verified' },
      { verified: 'rejected', verifyNote: 'Seller blocked' });
  }
  req.flash(user ? 'success' : 'error', user ? `${user.name} blocked` : 'User not found');
  res.redirect(req.get('Referer') || '/admin/users');
});

router.patch('/users/:id/unblock', async (req, res) => {
  const { id } = req.params;
  const user = mongoose.isValidObjectId(id)
    ? await User.findOneAndUpdate({ _id: id, role: { $ne: 'admin' } },
        { isBlocked: false, $unset: { blockReason: 1 } })
    : null;
  req.flash(user ? 'success' : 'error', user ? `${user.name} unblocked` : 'User not found');
  res.redirect(req.get('Referer') || '/admin/users');
});

// Crops verification (default: pending wali)
router.get('/crops', async (req, res) => {
  const status = ['pending', 'verified', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const crops = await Crop.find({ verified: status })
    .populate('kisan', 'name phone village fpoName businessName role')
    .sort({ createdAt: -1 });
  res.render('admin/crops', { title: 'Verify crops', crops, status });
});

router.patch('/crops/:id/:decision', async (req, res) => {
  const { id, decision } = req.params;
  const to = { verify: 'verified', reject: 'rejected' }[decision];
  const note = to === 'rejected' ? str(req.body.note).trim().slice(0, 200) : '';

  const ok = to && mongoose.isValidObjectId(id)
    ? await Crop.updateOne({ _id: id }, { verified: to, verifyNote: note })
    : null;
  req.flash(ok && ok.matchedCount ? 'success' : 'error',
    ok && ok.matchedCount ? `Crop ${to}` : 'Crop not found');
  res.redirect(req.get('Referer') || '/admin/crops');
});

module.exports = router;