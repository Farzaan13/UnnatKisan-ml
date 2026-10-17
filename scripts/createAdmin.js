require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');

(async () => {
  await mongoose.connect(process.env.MONGO_URL);
  await User.create({
    name: 'Admin', email: 'admin@unnatkisan.com', phone: '9999999999',
    password: await bcrypt.hash('Aaja@1v1', 10), role: 'admin'
  });
  console.log('Admin user created:');
  await mongoose.disconnect();
})();