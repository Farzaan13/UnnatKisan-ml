// Order banate waqt tay karo ki delivery kaun manage karega:
//  - kisan -> bulkbuyer   : bulkbuyer (jo kharid raha hai)
//  - bulkbuyer -> customer: bulkbuyer (jo bech raha hai)
//  - kisan -> customer    : admin
exports.deliveryOwner = ({ buyerRole, buyerId, crop }) => {
  if (buyerRole === 'bulkbuyer') return { deliveryBy: 'bulkbuyer', deliveryManager: buyerId };
  if (crop.sellerRole === 'bulkbuyer') return { deliveryBy: 'bulkbuyer', deliveryManager: crop.kisan };
  return { deliveryBy: 'admin' };
};