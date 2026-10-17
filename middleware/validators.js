const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { CITY_NAMES } = require('../utils/cities');
const { customerMinFor } = require('../utils/minQty');

exports.signupRules = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Please enter a valid email').normalizeEmail(),
  body('phone').matches(/^[6-9]\d{9}$/).withMessage('Please enter a valid 10-digit mobile number'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  body('confirmPassword').custom((v, { req }) => v === req.body.password)
    .withMessage('Passwords do not match'),
  body('role').isIn(['customer', 'bulkbuyer', 'kisan']).withMessage('Please select a valid role'),
  body('village').if(body('role').equals('kisan')).trim().notEmpty().withMessage('Please enter your village name'),
  body('businessName').if(body('role').equals('bulkbuyer')).trim().notEmpty().withMessage('Please enter your business name'),
  body('gstNumber').if(body('role').equals('bulkbuyer'))
    .matches(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/)
    .withMessage('Please enter a valid GST number'),
];

exports.loginRules = [
  body('email').isEmail().withMessage('Please enter a valid email').normalizeEmail(),
  body('password').notEmpty().withMessage('Please enter your password'),
];

exports.cropRules = [
  body('name').trim().notEmpty().withMessage('Please enter the crop name'),
  body('category').isIn(['vegetable', 'fruit', 'grain', 'pulse', 'other'])
    .withMessage('Please select a valid category'),
  body('price').isFloat({ gt: 0 }).withMessage('Please enter a valid price'),
  body('bulkPrice').isFloat({ gt: 0 }).withMessage('Please enter a valid bulk buyer price'),
  body('quantity').isInt({ gt: 0 }).withMessage('Please enter a valid quantity')
    .bail()
    .custom((v, { req }) => {
      // bulk buyer kisi bhi quantity mein list kar sakta hai
      if (req.session && req.session.user && req.session.user.role === 'bulkbuyer') return true;

      const min = customerMinFor(req.body.category);
      if (Number(v) < min) {
        throw new Error(`${req.body.category} ke liye kam se kam ${min} kg stock add karo (customer ka minimum order ${min} kg hai)`);
      }
      return true;
    }),
  body('minBulkQty').optional({ checkFalsy: true }).isInt({ gt: 0 })
    .withMessage('Please enter a valid bulk minimum quantity'),
  body('harvestDate').optional({ checkFalsy: true }).isISO8601()
    .withMessage('Please enter a valid harvest date'),
  body('location').trim().notEmpty().withMessage('Choose a location from the suggestions'),
  body('lat').isFloat({ min: 6, max: 38 })
    .withMessage('choose a location within India'),
  body('lng').isFloat({ min: 68, max: 98 })
    .withMessage('choose a location within India'),
  body('description').trim().optional({ checkFalsy: true })
    .isLength({ max: 500 }).withMessage('Please keep the description under 500 characters'),
];

// redirectTo string bhi ho sakta hai aur function bhi (edit page ke liye id chahiye)
exports.handleErrors = (redirectTo) => (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // validation fail hui to upload hui photo hata do
    req.flash('error', errors.array().map(e => e.msg));
    const to = typeof redirectTo === 'function' ? redirectTo(req) : redirectTo;
    return res.redirect(to);
  }
  next();
};


exports.orderRules = [
  body('quantity').isInt({ gt: 0 }).withMessage('Quantity 1 ya usse zyada daalo'),
  body('deliveryCity').isIn(CITY_NAMES).withMessage('choose a city from the list'),

  body('paymentMethod').optional({ checkFalsy: true }).isIn(['cod', 'online'])
    .withMessage('Payment method is invalid'),
  body('transactionId').if(body('paymentMethod').equals('online'))
    .trim().matches(/^[A-Za-z0-9]{8,30}$/)
    .withMessage('Please enter a valid UTR / transaction ID (8 to 30 characters)'),


  body('deliveryAddress').trim().isLength({ min: 10, max: 200 })
    .withMessage('Please enter a complete delivery address (10 to 200 characters)'),
];

exports.checkoutRules = [
  body('deliveryCity').isIn(CITY_NAMES).withMessage('choose a city from the list'),
  body('deliveryAddress').trim().isLength({ min: 10, max: 200 })
    .withMessage('Please enter a complete delivery address (10 to 200 characters)'),
  body('paymentMethod').optional({ checkFalsy: true }).isIn(['cod', 'online'])
    .withMessage('Payment method is invalid'),
];