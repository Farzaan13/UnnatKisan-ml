if (process.env.NODE_ENV !== 'production'){
  require('node:dns').setServers(['8.8.8.8', '1.1.1.1']);
}
require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const ejsMate = require('ejs-mate');

const app = express();

app.locals.CUSTOMER_MIN_QTY = require('./utils/minQty').CUSTOMER_MIN_QTY;
const Crop = require('./models/Crop');
const { CATEGORY_META, CATEGORY_ORDER, cropEmoji } = require('./utils/categories');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// View engine
app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing, static files, method override
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(methodOverride('_method'));

// Session (MongoDB mein store, nodemon restart par logout nahi hoga)
// app.use(session({
//   secret: process.env.SESSION_SECRET,
//   resave: false,
//   saveUninitialized: false,
//   store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
//   cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 }
// }));
app.set('trust proxy', 1); 

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,

  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URL,
    collectionName: 'sessions'
  }),

  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // sirf HTTPS par bhejna
    maxAge: 1000 * 60 * 60 * 24
  }
}));
app.use(flash());

// Har view mein flash aur currentUser
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.currentUser = req.session.user || null;
    res.locals.cartCount = req.session.cart ? Object.keys(req.session.cart).length : 0;
  next();
});

// Routes
// Home page: saari listing, category-wise, name se search
// Home page: saari listing, category filter, search aur sort
app.get('/', async (req, res) => {
  const str = (v) => (typeof v === 'string' ? v : '');
  const q = str(req.query.q).trim().slice(0, 50);
  const cat = CATEGORY_ORDER.includes(str(req.query.cat)) ? str(req.query.cat) : '';
  const sort = ['low', 'high'].includes(str(req.query.sort)) ? str(req.query.sort) : 'new';

  const filter = { quantity: { $gt: 0 }, verified: 'verified' };
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };

  const all = await Crop.find(filter).sort({ createdAt: -1 });

  // har category ki ginti (search ke hisaab se, category filter se pehle)
  const counts = {};
  CATEGORY_ORDER.forEach((k) => { counts[k] = all.filter((c) => c.category === k).length; });

  // jo rate is visitor ko dikhna hai (guest/customer: customer rate, bulk buyer: bulk rate)
  const viewRole = req.session.user ? req.session.user.role : 'customer';
  const unit = (c) => c.priceFor(viewRole);

  let crops = cat ? all.filter((c) => c.category === cat) : all;
  if (sort === 'low') crops = [...crops].sort((a, b) => unit(a) - unit(b));
  else if (sort === 'high') crops = [...crops].sort((a, b) => unit(b) - unit(a));

  const sections = cat
    ? []
    : CATEGORY_ORDER
        .map((key) => ({ key, ...CATEGORY_META[key], crops: crops.filter((c) => c.category === key) }))
        .filter((s) => s.crops.length > 0);

  // hero ke board ke liye sabse naye 5 crops
  const board = await Crop.find({ quantity: { $gt: 0 }, verified: 'verified' }).sort({ createdAt: -1 }).limit(5);

  res.render('home', {
    title: 'Home', q, cat, sort,
    total: crops.length, allCount: all.length,
    counts, crops, sections, board,
    cropEmoji, CATEGORY_META, CATEGORY_ORDER
  });
});

app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/auth'));
app.use('/kisan', require('./routes/kisan'));
app.use('/customer', require('./routes/customer'));
app.use('/buyer', require('./routes/buyer')('bulkbuyer'));

// 404
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page nahi mila',
    message: 'Ye page maujood nahi hai.'
  });
});

// Error handler (sabse last mein)
app.use(require('./middleware/errorHandler'));

// DB connect hone ke baad hi server start

const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGO_URL)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, () => console.log(`Server on ${PORT}`));
  })
  .catch(err => console.log('MongoDB connection failed:', err.message));