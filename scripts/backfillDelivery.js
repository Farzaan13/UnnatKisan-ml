require('node:dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/Order');
require('../models/Crop');

(async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const orders = await Order.find({ deliveryBy: { $exists: false } }).populate('crop', 'sellerRole');

  let n = 0;
  for (const o of orders) {
    let set;
    if (o.orderType === 'bulk') set = { deliveryBy: 'bulkbuyer', deliveryManager: o.buyer };
    else if (o.crop && o.crop.sellerRole === 'bulkbuyer') set = { deliveryBy: 'bulkbuyer', deliveryManager: o.kisan };
    else set = { deliveryBy: 'admin' };
    await Order.updateOne({ _id: o._id }, { $set: set });
    n++;
  }
  console.log('Updated:', n);
  await mongoose.disconnect();
})();