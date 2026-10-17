const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKS = 8;

// Pichhle 8 hafton ki weekly quantity, purana pehle. Aakhri entry = pichhle 7 din.
function buildSeries(orders, now = Date.now()) {
  const series = new Array(WEEKS).fill(0);
  orders.forEach((o) => {
    const weeksAgo = Math.floor((now - new Date(o.createdAt).getTime()) / WEEK_MS);
    if (weeksAgo >= 0 && weeksAgo < WEEKS) series[WEEKS - 1 - weeksAgo] += o.quantity;
  });
  return series;
}

// Moving average (aakhri 3 hafte) + linear trend (least squares)
function forecast(series, horizon = 4) {
  const n = series.length;
  const xMean = (n - 1) / 2;
  const yMean = series.reduce((a, b) => a + b, 0) / n;

  let num = 0, den = 0;
  series.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
  const slope = den ? num / den : 0;

  const level = series.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const predicted = [];
  for (let k = 1; k <= horizon; k++) {
    predicted.push(Math.max(0, Math.round(level + slope * (k + 1))));
  }

  const trend = Math.abs(slope) < 0.5 ? 'stable' : slope > 0 ? 'up' : 'down';
  return { predicted, slope: Math.round(slope * 10) / 10, trend };
}

module.exports = { buildSeries, forecast, WEEK_MS, WEEKS };