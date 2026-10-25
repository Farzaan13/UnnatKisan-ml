const { CITIES } = require('./cities');

const ROAD_FACTOR = 1.3;  // seedhi doori ko road distance mein badalne ka andaza
const COST_PER_KM = 12;   // ₹ per km, apne hisaab se badlo

const toRad = (d) => (d * Math.PI) / 180;

// do coordinates ke beech road distance ka andaza (km)
function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// crop ki location (lat, lng) se delivery city tak road km. Data na ho to null.
function roadKmToCity(fromLat, fromLng, city) {
  const c = CITIES[city];
  if (!c || fromLat == null || fromLng == null) return null;
  return Math.round(haversineKm(fromLat, fromLng, c.lat, c.lng) * ROAD_FACTOR);
}

function dist(a, b) {
  if (a === b) return 0;
  const p = CITIES[a], q = CITIES[b];
  const dLat = toRad(q.lat - p.lat);
  const dLng = toRad(q.lng - p.lng);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(p.lat)) * Math.cos(toRad(q.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h)) * ROAD_FACTOR;
}

const length = (route) =>
  route.slice(1).reduce((sum, city, i) => sum + dist(route[i], city), 0);

// Har baar sabse paas wala agla shehar chuno
function nearestNeighbour(start, cities) {
  const left = [...cities];
  const route = [start];
  while (left.length) {
    const cur = route[route.length - 1];
    let best = 0;
    left.forEach((c, i) => { if (dist(cur, c) < dist(cur, left[best])) best = i; });
    route.push(left.splice(best, 1)[0]);
  }
  return route;
}

// Route ke tukde ulat kar dekho, chhota ho to rakh lo
function twoOpt(route) {
  let best = route;
  let bestLen = length(route);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const len = length(cand);
        if (len < bestLen - 1e-6) { best = cand; bestLen = len; improved = true; }
      }
    }
  }
  return best;
}

// orders: populated Order docs (accepted). Return trip count nahi kiya gaya.
function planRoute(pickup, orders) {
  const valid = orders.filter((o) => CITIES[o.deliveryCity]);
  const skipped = orders.length - valid.length;

  const groups = new Map();
  valid.forEach((o) => {
    if (!groups.has(o.deliveryCity)) groups.set(o.deliveryCity, []);
    groups.get(o.deliveryCity).push(o);
  });

  const cities = [...groups.keys()];
  const naive = [pickup, ...cities];                       // order aane ke sequence mein
  const best = twoOpt(nearestNeighbour(pickup, cities));   // optimized

  let cum = 0;
  const stops = best.slice(1).map((city, i) => {
    const leg = dist(best[i], city);
    cum += leg;
    return { city, legKm: Math.round(leg), cumKm: Math.round(cum), orders: groups.get(city) };
  });

  const totalKm = Math.round(length(best));
  const naiveKm = Math.round(length(naive));

  return {
    stops, skipped, totalKm, naiveKm,
    savedKm: naiveKm - totalKm,
    savedPct: naiveKm ? Math.round(((naiveKm - totalKm) / naiveKm) * 100) : 0,
    cost: totalKm * COST_PER_KM,
    naiveCost: naiveKm * COST_PER_KM,
    costPerKm: COST_PER_KM,
  };
}


const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';

// 1. Calls Python ML Service to rank closest farmers & build Virtual FPO pools for buyers
async function findClosestFarmersML({ buyerLat, buyerLng, cropFilter, requiredQtyKg, isBulkBuyer, crops }) {
  const listings = (crops || []).map((c) => {
    const harvestDays = c.harvestDate
      ? Math.max(0, Math.floor((Date.now() - new Date(c.harvestDate).getTime()) / (1000 * 60 * 60 * 24)))
      : 1;
    return {
      cropId: String(c._id),
      cropName: c.name || 'Crop',
      category: c.category || 'vegetable',
      kisanName: (c.kisan && c.kisan.name) ? c.kisan.name : 'Verified Kisan',
      location: c.location || 'Kanpur',
      lat: c.lat || null,
      lng: c.lng || null,
      price: Number(c.price) || 20,
      bulkPrice: c.bulkPrice ? Number(c.bulkPrice) : null,
      quantity: Number(c.quantity) || 0,
      daysSinceHarvest: harvestDays
    };
  });

  try {
    const res = await fetch(`${ML_SERVICE_URL}/find-closest-farmers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyerLat: Number(buyerLat) || 26.4499,
        buyerLng: Number(buyerLng) || 80.3319,
        cropFilter: cropFilter || null,
        requiredQtyKg: requiredQtyKg ? Number(requiredQtyKg) : null,
        isBulkBuyer: Boolean(isBulkBuyer),
        listings
      }),
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) throw new Error('ML service error');
    return await res.json();
  } catch (err) {
    console.warn('Closest-farmer ML fallback:', err.message);
    return { totalMatches: 0, closestFarmer: null, farmers: [], fpoPool: null };
  }
}

// 2. Calls Python ML Service for perishability-aware multi-stop route optimization
async function planRouteML(pickupCity, orders) {
  const stops = (orders || []).map((o) => ({
    orderId: String(o._id),
    buyerName: (o.buyer && o.buyer.name) ? o.buyer.name : 'Buyer',
    cropName: (o.crop && o.crop.name) ? o.crop.name : 'Crop',
    category: (o.crop && o.crop.category) ? o.crop.category : 'vegetable',
    quantityKg: Number(o.quantity) || 50,
    city: o.deliveryAddress || o.city || 'Lucknow',
    lat: o.lat || null,
    lng: o.lng || null
  }));

  try {
    const res = await fetch(`${ML_SERVICE_URL}/optimize-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickupCity: pickupCity || 'Kanpur',
        stops
      }),
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) throw new Error('ML route error');
    return await res.json();
  } catch (err) {
    console.warn('Route ML fallback:', err.message);
    return null;
  }
}

// Single combined export at the very end of utils/geo.js
module.exports = {
  planRoute,
  findClosestFarmersML,
  roadKmToCity,
  planRouteML
};