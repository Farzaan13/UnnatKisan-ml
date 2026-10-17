// Customer ke liye category ke hisaab se minimum order (kg)
const CUSTOMER_MIN_QTY = {
  vegetable: 10,
  fruit: 20,
  grain: 50,
  pulse: 50,
  other: 50
};

const customerMinFor = (category) => CUSTOMER_MIN_QTY[category] || 50;

module.exports = { CUSTOMER_MIN_QTY, customerMinFor };