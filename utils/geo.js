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


// Replace everything from const ML_SERVICE_URL to the bottom of utils/geo.js
const CITY_COORDS = {
  kanpur: [26.4499, 80.3319],
  lucknow: [26.8467, 80.9462],
  varanasi: [25.3176, 82.9739],
  agra: [27.1767, 78.0081],
  prayagraj: [25.4358, 81.8463],
  allahabad: [25.4358, 81.8463],
  meerut: [28.9845, 77.7064],
  noida: [28.5355, 77.3910],
  gorakhpur: [26.7606, 83.3732],
  delhi: [28.6139, 77.2090],
  jhansi: [25.4484, 78.5685],
  bareilly: [28.3670, 79.4304],
  aligarh: [27.8974, 78.0880],
  moradabad: [28.8386, 78.7733],
  mathura: [27.4924, 77.6737],
  ayodhya: [26.7922, 82.1998],
  unnao: [26.5393, 80.4878]
};

const PERISHABILITY_WEIGHT = {
  vegetable: 1.8,
  fruit: 1.6,
  other: 1.2,
  pulse: 0.6,
  grain: 0.4
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const straightKm = R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  return +(straightKm * 1.22).toFixed(2); // 1.22x road winding factor
}

function resolveCoords(locationStr, lat, lng, seedStr = '') {
  if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
    return [Number(lat), Number(lng)];
  }
  const locLower = (locationStr || 'kanpur').toLowerCase();
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (locLower.includes(city)) {
      // Slight deterministic village offset if exact GPS wasn't saved
      let hash = 0;
      for (let i = 0; i < seedStr.length; i++) hash = (hash * 31 + seedStr.charCodeAt(i)) % 100;
      const offsetLat = ((hash % 15) - 7) * 0.008;
      const offsetLng = (((hash * 3) % 15) - 7) * 0.008;
      return [+(coords[0] + offsetLat).toFixed(5), +(coords[1] + offsetLng).toFixed(5)];
    }
  }
  return [26.4499, 80.3319];
}

function computeSpoilageRisk(category, distanceKm, daysSinceHarvest = 1) {
  const weight = PERISHABILITY_WEIGHT[(category || 'vegetable').toLowerCase()] || 1.2;
  const transitHours = distanceKm / 38.0;
  const rawScore = weight * (transitHours * 4.5 + Math.max(0, daysSinceHarvest) * 5.0);
  return +Math.min(95.0, Math.max(2.0, rawScore)).toFixed(1);
}

// 1. Buyer & Bulk Buyer: Closest Farmer & Virtual FPO Pooler
async function findClosestFarmersML({ buyerLat, buyerLng, cropFilter, requiredQtyKg, isBulkBuyer, crops }) {
  const bLat = Number(buyerLat) || 26.4499;
  const bLng = Number(buyerLng) || 80.3319;
  const filterStr = (cropFilter || '').trim().toLowerCase();
  const ranked = [];

  for (const c of crops || []) {
    const cropName = c.name || 'Crop';
    if (filterStr && !cropName.toLowerCase().includes(filterStr)) continue;

    const kisanName = c.kisan && c.kisan.name ? c.kisan.name : 'Verified Kisan';
    const [fLat, fLng] = resolveCoords(c.location, c.lat, c.lng, String(c._id || kisanName));
    const distanceKm = haversineKm(bLat, bLng, fLat, fLng);
    const etaMins = Math.max(15, Math.round((distanceKm / 38.0) * 60));

    const harvestDays = c.harvestDate
      ? Math.max(0, Math.min(7, Math.floor((Date.now() - new Date(c.harvestDate).getTime()) / (1000 * 60 * 60 * 24))))
      : 1;

    const spoilageRiskPct = computeSpoilageRisk(c.category, distanceKm, harvestDays);
    const freshnessScore = +(100.0 - spoilageRiskPct).toFixed(1);

    const transportCostKg = +Math.min(12.0, distanceKm * 0.035).toFixed(2);
    const basePriceKg = isBulkBuyer && c.bulkPrice ? Number(c.bulkPrice) : Number(c.price) || 20;
    const landedCostKg = +(basePriceKg + transportCostKg).toFixed(2);

    const aiRankCost = +(distanceKm * 0.55 + landedCostKg * 1.2 + spoilageRiskPct * 0.4).toFixed(2);

    ranked.push({
      cropId: String(c._id),
      cropName,
      category: c.category || 'vegetable',
      kisanName,
      location: c.location || 'Kanpur',
      lat: fLat,
      lng: fLng,
      distanceKm,
      etaMins,
      basePriceKg,
      transportCostKg,
      landedCostKg,
      availableQtyKg: Number(c.quantity) || 0,
      spoilageRiskPct,
      freshnessScore,
      aiRankCost
    });
  }

  // Sort primarily by closest distance, breaking ties by AI rank cost
  ranked.sort((a, b) => a.distanceKm - b.distanceKm || a.aiRankCost - b.aiRankCost);

  if (ranked.length > 0) {
    ranked[0].badge = '📍 Closest Farmer';
    const bestVal = ranked.reduce((min, cur) => (cur.landedCostKg < min.landedCostKg ? cur : min), ranked[0]);
    if (bestVal.cropId !== ranked[0].cropId) {
      bestVal.badge = '💰 Best Landed Price';
    } else {
      ranked[0].badge = '🏆 Closest & Best Value';
    }
  }

  // Virtual FPO Multi-Farmer Pooling for Bulk Buyers
  const reqQty = Number(requiredQtyKg) || 0;
  let remainingQty = reqQty;
  const allocations = [];

  if (reqQty > 0 && ranked.length > 0) {
    for (const farmer of ranked) {
      if (remainingQty <= 0) break;
      const takeQtyKg = Math.min(farmer.availableQtyKg, remainingQty);
      if (takeQtyKg > 0) {
        allocations.push({
          cropId: farmer.cropId,
          kisanName: farmer.kisanName,
          cropName: farmer.cropName,
          location: farmer.location,
          distanceKm: farmer.distanceKm,
          takeQtyKg,
          landedCostKg: farmer.landedCostKg,
          subtotalRs: +(takeQtyKg * farmer.landedCostKg).toFixed(2),
          lat: farmer.lat,
          lng: farmer.lng
        });
        remainingQty -= takeQtyKg;
      }
    }
  }

  return {
    totalMatches: ranked.length,
    closestFarmer: ranked[0] || null,
    farmers: ranked,
    fpoPool: reqQty > 0
      ? {
          requestedQtyKg: reqQty,
          fulfilledQtyKg: +(reqQty - Math.max(0, remainingQty)).toFixed(2),
          farmersCount: allocations.length,
          allocations
        }
      : null
  };
}

// 2. Kisan Delivery Side: Perishability-Aware Multi-Stop Route Optimizer
async function planRouteML(pickupCity = 'Kanpur', orders = []) {
  const [startLat, startLng] = resolveCoords(pickupCity, null, null, pickupCity);

  if (!orders || orders.length === 0) {
    return {
      pickupCity,
      pickupCoords: [startLat, startLng],
      totalKm: 0,
      naiveKm: 0,
      kmSaved: 0,
      fuelSavedLiters: 0,
      estimatedCostRs: 0,
      orderedStops: []
    };
  }

  const nodes = orders.map((o, i) => {
    const cityStr = o.deliveryAddress || o.city || 'Lucknow';
    const [sLat, sLng] = resolveCoords(cityStr, o.lat, o.lng, String(o._id || i));
    const category = o.crop && o.crop.category ? o.crop.category : 'vegetable';
    const perishabilityWeight = PERISHABILITY_WEIGHT[category.toLowerCase()] || 1.2;

    return {
      orderId: String(o._id),
      buyerName: o.buyer && o.buyer.name ? o.buyer.name : 'Buyer',
      cropName: o.crop && o.crop.name ? o.crop.name : 'Crop',
      category,
      quantityKg: Number(o.quantity) || 50,
      city: cityStr,
      lat: sLat,
      lng: sLng,
      perishabilityWeight
    };
  });

  // Naive unoptimized route distance
  let naiveKm = 0;
  let cLat = startLat, cLng = startLng;
  for (const n of nodes) {
    naiveKm += haversineKm(cLat, cLng, n.lat, n.lng);
    cLat = n.lat;
    cLng = n.lng;
  }

  // Perishability-Weighted Nearest Neighbor Solver
  const unvisited = [...nodes];
  const orderedStops = [];
  cLat = startLat;
  cLng = startLng;
  let totalKm = 0;
  let cumulativeMins = 0;

  while (unvisited.length > 0) {
    let bestIdx = 0;
    let bestScore = Infinity;

    for (let idx = 0; idx < unvisited.length; idx++) {
      const cand = unvisited[idx];
      const d = haversineKm(cLat, cLng, cand.lat, cand.lng);
      const priorityFactor = 1.0 - Math.min(0.3, (cand.perishabilityWeight - 0.4) * 0.18);
      const score = d * priorityFactor;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }

    const chosen = unvisited.splice(bestIdx, 1)[0];
    const legKm = haversineKm(cLat, cLng, chosen.lat, chosen.lng);
    totalKm += legKm;
    const legMins = Math.max(10, Math.round((legKm / 38.0) * 60));
    cumulativeMins += legMins;
    const spoilageRiskPct = computeSpoilageRisk(chosen.category, totalKm, 1);

    orderedStops.push({
      ...chosen,
      stopNumber: orderedStops.length + 1,
      legKm: +legKm.toFixed(2),
      cumulativeKm: +totalKm.toFixed(2),
      etaMins: cumulativeMins,
      spoilageRiskPct,
      priorityBadge: chosen.perishabilityWeight >= 1.5 ? '🔥 High Perishability Priority' : '📦 Standard Load'
    });

    cLat = chosen.lat;
    cLng = chosen.lng;
  }

  const kmSaved = +Math.max(0, naiveKm - totalKm).toFixed(2);
  const fuelSavedLiters = +(kmSaved / 12.0).toFixed(2);

  return {
    pickupCity,
    pickupCoords: [startLat, startLng],
    totalKm: +totalKm.toFixed(2),
    naiveKm: +naiveKm.toFixed(2),
    kmSaved,
    fuelSavedLiters,
    estimatedCostRs: Math.round(totalKm * 14.0),
    orderedStops
  };
}

// Single combined export at the very end of utils/geo.js
module.exports = {
  planRoute,
  findClosestFarmersML,
  planRouteML
};