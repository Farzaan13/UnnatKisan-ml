const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { signupRules, loginRules, handleErrors } = require('../middleware/validators');

const router = express.Router();

const homeByRole = {
  admin: '/admin/dashboard',
  kisan: '/kisan/dashboard',
  customer: '/customer/dashboard',
  bulkbuyer: '/buyer/dashboard',
};

// login aur signup dono yahi use karte hain: naya session banao, user save karo, dashboard bhejo
const startSession = (req, res, next, user, message) => {
  req.session.regenerate((err) => {
    if (err) return next(err);
    // session mein sirf zaroori cheezein, poora user ya password nahi
    req.session.user = { id: user._id, name: user.name, role: user.role };
    req.flash('success', message);
    // session store mein save hone ke baad hi redirect karo
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect(homeByRole[user.role]);
    });
  });
};

router.get('/signup', (req, res) => res.render('auth/signup'));

router.post('/signup', signupRules, handleErrors('/signup'), async (req, res, next) => {
  try {
    const { name, email, phone, password, role, village, fpoName, businessName, gstNumber } = req.body;

    if (await User.findOne({ email })) {
      req.flash('error', 'An account with this email already exists');
      return res.redirect('/signup');
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, phone, password: hashed, role, village, fpoName, businessName, gstNumber });

    // register ke baad seedha login
    startSession(req, res, next, user, `Welcome to Unnat Kisan, ${user.name}! Your account has been created.`);
  } catch (err) { next(err); }
});

router.get('/login', (req, res) => res.render('auth/login'));

router.post('/login', loginRules, handleErrors('/login'), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      req.flash('error', 'Invalid email or password');
      return res.redirect('/login');
    }
    if (user.isBlocked) {
      req.flash('error', `Your account is blocked. Reason: ${user.blockReason || 'policy violation'}`);
      return res.redirect('/login');
    }

    startSession(req, res, next, user, `Welcome back, ${user.name}!`);
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;