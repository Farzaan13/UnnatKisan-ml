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

// utils/forecast.js
const MandiPrice = require("../models/MandiPrice");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8000";

async function getMLDemandAndPriceForecast(cropName, cityName, days = 7) {
  let latestMandiPriceQuintal = null;

  try {
    // 1. Check if we have a live synced price in models/MandiPrice.js
    const mandiRecord = await MandiPrice.findOne({
      crop: new RegExp(`^${cropName}$`, "i"),
      city: new RegExp(`^${cityName}$`, "i"),
    }).sort({ updatedAt: -1 });

    if (mandiRecord && mandiRecord.modalPrice) {
      latestMandiPriceQuintal = mandiRecord.modalPrice;
    }
  } catch (dbErr) {
    console.warn("Could not query MandiPrice collection:", dbErr.message);
  }

  try {
    // 2. Call our Python FastAPI ML service
    const response = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        crop: cropName || "Wheat",
        city: cityName || "Kanpur",
        current_mandi_price: latestMandiPriceQuintal,
        days: days,
      }),
      signal: AbortSignal.timeout(3000), // 3-second timeout
    });

    if (!response.ok) {
      throw new Error(`ML service responded with status ${response.status}`);
    }

    const mlData = await response.json();
    return { ...mlData, source: "AI_MODEL" };
  } catch (err) {
    console.warn("ML Service unreachable, using local fallback forecast:", err.message);
    // Fallback if Python server isn't running
    const baseKg = latestMandiPriceQuintal ? +(latestMandiPriceQuintal / 100).toFixed(2) : 24.0;
    return {
      crop: cropName,
      city: cityName,
      total7DayDemandKg: 5800,
      avgMandiPriceKg: baseKg,
      recommendedPriceKg: +(baseKg * 1.08).toFixed(2),
      recommendedMinKg: +(baseKg * 1.03).toFixed(2),
      recommendedMaxKg: +(baseKg * 1.14).toFixed(2),
      trend: "UP",
      advice: `Estimated 7-day demand is 5,800 kg. Recommended direct marketplace price is ₹${(baseKg * 1.08).toFixed(2)}/kg.`,
      dailyForecasts: [],
      source: "FALLBACK",
    };
  }
}

module.exports = {
  getMLDemandAndPriceForecast,
  // Keep any existing exports you already have in utils/forecast.js below this line
};