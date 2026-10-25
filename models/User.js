const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name:  { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['customer', 'bulkbuyer', 'kisan', 'admin', 'delivery'],
    required: true
  },
  // sirf kisan ke liye
  village: String,
  fpoName: String,
  // sirf bulkbuyer ke liye
  businessName: String,
  gstNumber: String,

  // sirf delivery partner ke liye
  vehicle: String,                                                   // bike, auto, tempo...
  managedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },  // kisne banaya (admin ya bulkbuyer)
  managedByRole: { type: String, enum: ['admin', 'bulkbuyer'] },

  // admin block system
  isBlocked:   { type: Boolean, default: false },
  blockReason: String
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);