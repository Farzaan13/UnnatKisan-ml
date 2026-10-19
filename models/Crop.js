const mongoose = require('mongoose');
const { customerMinFor } = require('../utils/minQty');

const cropSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, enum: ['vegetable', 'fruit', 'grain', 'pulse', 'other'], default: 'other' },
  price: { type: Number, required: true, min: 0 },          // customer ke liye per kg
  bulkPrice: { type: Number, min: 0 },                      // bulk buyer ke liye per kg
  sellerRole: { type: String, enum: ['kisan', 'bulkbuyer'], default: 'kisan' },  // kisne list ki
  quantity: { type: Number, required: true, min: 0 },       // kg available
  minBulkQty: { type: Number, default: 100 },               // bulkbuyer ke liye minimum
  harvestDate:{type: Date, required: true},
  location: String,
  lat: { type: Number, min: -90, max: 90 },
  lng: { type: Number, min: -180, max: 180 },
  image: String,
  description: String,
  kisan: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // admin verification
  verified:   { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  verifyNote: String   // reject karne ka reason
}, { timestamps: true });

// role ke hisaab se rate: bulk buyer ko bulkPrice (na ho to normal price), baaki ko price
cropSchema.methods.priceFor = function (role) {
  return role === 'bulkbuyer' && this.bulkPrice > 0 ? this.bulkPrice : this.price;
};

// role ke hisaab se minimum order:
// - bulk buyer ko minBulkQty
// - customer ko category ka minimum (agar crop bulk buyer ne list ki hai to koi minimum nahi, 1 kg)
cropSchema.methods.minQtyFor = function (role) {
  if (role === 'bulkbuyer') return this.minBulkQty || 100;
  if (this.sellerRole === 'bulkbuyer') return 1;
  return customerMinFor(this.category);
};

module.exports = mongoose.model('Crop', cropSchema);