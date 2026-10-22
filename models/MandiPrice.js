const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  state: String,
  district: String,
  market: String,
  commodity: String,
  variety: String,
  grade: String,
  date: String,      // "22/10/2026"
  t: Number,         // date ka timestamp (sort ke liye)
  min: Number,       // ₹ per kg
  max: Number,
  modal: Number,
  syncId: String     // kis sync run mein aaya
});

schema.index({ commodity: 1, state: 1 });
schema.index(
  { state: 1, district: 1, market: 1, commodity: 1, variety: 1, grade: 1, date: 1 },
  { unique: true }
);

module.exports = mongoose.model('MandiPrice', schema);