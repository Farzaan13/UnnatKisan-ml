// middleware/auth.js
const User = require('../models/User');

module.exports.isLoggedIn = async (req, res, next) => {
  if (!req.session.user) {
    req.flash('error', 'First Login');
    return res.redirect('/login');
  }

  // har request par check: user abhi bhi maujood hai aur blocked nahi hai
  const u = await User.findById(req.session.user.id).select('isBlocked blockReason');
  if (!u || u.isBlocked) {
    delete req.session.user;
    req.flash('error', u
      ? `Your account is blocked. Reason: ${u.blockReason || 'policy violation'}`
      : 'Account not found');
    return res.redirect('/login');
  }
  next();
};

module.exports.allowRoles = (...roles) => (req, res, next) => {
  if (!roles.includes(req.session.user.role)) {
    req.flash('error', 'You are not authorized to access this page');
    return res.redirect('/');
  }
  next();
};