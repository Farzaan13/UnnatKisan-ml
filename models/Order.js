const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  buyer:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kisan:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  crop:     { type: mongoose.Schema.Types.ObjectId, ref: 'Crop', required: true },
  quantity: { type: Number, required: true, min: 1 },
  totalPrice: { type: Number, required: true },
  orderType:{ type: String, enum: ['retail', 'bulk'], default: 'retail' },
  status:   { type: String, enum: ['pending', 'accepted', 'rejected', 'shipped', 'delivered'], default: 'pending' },

  // delivery info (order form se aata hai, delivery plan route ke liye zaroori)
  deliveryCity:    { type: String, trim: true },
  deliveryAddress: { type: String, trim: true },
  distanceKm: Number,   // crop ki location se delivery city tak (lagbhag)

  // kisan jab order accept karta hai tab banta hai
  trackingId: String,

  // payment
  paymentMethod: { type: String, enum: ['cod', 'online'], default: 'cod' },
  paymentStatus: { type: String, enum: ['pending', 'submitted', 'paid', 'failed'], default: 'pending' },
  transactionId: String,   // online payment ka UTR
  paymentProof:  String,   // screenshot ka path (optional)
  paidAt: Date,

  // har status change ka record (tracking timeline ke liye)
  statusHistory: [{
    _id: false,
    status: { type: String, enum: ['pending', 'accepted', 'rejected', 'shipped', 'delivered'] },
    at:     { type: Date, default: Date.now }
  }],

  // seedDemand.js ke demo orders ko pehchaanne ke liye
  isDemo: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);