require('dotenv').config();
const mongoose = require('mongoose');
const Crop = require('../models/Crop');
const User = require('../models/User');
const Order = require('../models/Order');
const { CITY_NAMES } = require('../utils/cities');
const { WEEK_MS, WEEKS } = require('../utils/forecast');

const rand = (a, b) => a + Math.random() * (b - a);

(async () => {
  await mongoose.connect(process.env.MONGO_URL);

  if (process.argv.includes('--clear')) {
    const r = await Order.deleteMany({ isDemo: true });
    console.log('Demo orders hata diye:', r.deletedCount);
    return mongoose.disconnect();
  }

  const buyer = await User.findOne({ role: { $in: ['customer', 'bulkbuyer'] } });
  const crops = await Crop.find();
  if (!buyer || !crops.length) {
    console.log('Pehle ek customer account aur kuch crops banao.');
    return mongoose.disconnect();
  }

  const now = Date.now();
  const docs = [];

  crops.forEach((crop) => {
    const base = rand(5, 30);
    const trend = rand(-0.08, 0.3);             // har crop ka alag trend
    for (let w = WEEKS - 1; w >= 0; w--) {      // w = kitne hafte pehle
      const weekQty = Math.max(1, Math.round(base * (1 + trend * (WEEKS - 1 - w)) * rand(0.8, 1.2)));
      const parts = 1 + Math.floor(Math.random() * 3);
      for (let p = 0; p < parts; p++) {
        const qty = Math.max(1, Math.round(weekQty / parts));
        const at = new Date(now - (w * WEEK_MS + rand(0, 0.95) * WEEK_MS));
        docs.push({
          buyer: buyer._id, kisan: crop.kisan, crop: crop._id,
          quantity: qty, totalPrice: qty * crop.price, orderType: 'retail',
          status: 'delivered',
          deliveryCity: CITY_NAMES[Math.floor(Math.random() * CITY_NAMES.length)],
          deliveryAddress: 'Demo address, demo gali',
          statusHistory: [{ status: 'delivered', at }],
          isDemo: true, createdAt: at, updatedAt: at
        });
      }
    }
  });

  await Order.collection.insertMany(docs);   // timestamps schema se bypass, taaki purani tareekh rahe
  console.log(`${docs.length} demo orders ban gaye (${crops.length} crops).`);
  await mongoose.disconnect();
})();