const MandiPrice = require('../models/MandiPrice');

const RESOURCE = '9ef84268-d588-465a-a308-a864a43d0070';
const BASE = `https://api.data.gov.in/resource/${RESOURCE}`;
const TTL = 30 * 60 * 1000;               // 30 minute cache
const cache = new Map();

exports.STATES = [
  'Andhra Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'NCT of Delhi', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal'
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const ts = (s) => {
  const [d, m, y] = String(s || '').split('/').map(Number);
  return y ? new Date(y, m - 1, d).getTime() : 0;
};
const perKg = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round((n / 100) * 100) / 100 : null;   // quintal -> kg
};

// ---------- 1) Atlas se ----------
async function fromDb({ commodity, state, district }) {
  const q = { commodity: new RegExp(esc(commodity), 'i') };
  if (state) q.state = state;
  if (district) q.district = new RegExp(esc(district), 'i');
  const docs = await MandiPrice.find(q).lean();
  return docs.map((d) => ({
    market: d.market, district: d.district, state: d.state, commodity: d.commodity,
    variety: d.variety, date: d.date, t: d.t, min: d.min, max: d.max, modal: d.modal
  }));
}

// ---------- 2) Live API (backup) ----------
async function fetchRecords({ state, district, commodity, limit = 500, offset = 0 }) {
  const url = new URL(BASE);
  url.searchParams.set('api-key', process.env.DATA_GOV_API_KEY || '');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  if (state) url.searchParams.set('filters[state.keyword]', state);
  if (district) url.searchParams.set('filters[district]', district);
  if (commodity) url.searchParams.set('filters[commodity]', commodity);

  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('data.gov.in ' + res.status);
  const json = await res.json();
  return json.records || [];
}

async function fromApi({ commodity, state, district }) {
  let recs = await fetchRecords({ state, district, commodity: titleCase(commodity) });
  if (!recs.length) {
    let all = [];
    for (let offset = 0; offset < 2500; offset += 500) {
      const part = await fetchRecords({ state, district, offset });
      all = all.concat(part);
      if (part.length < 500) break;
    }
    const q = commodity.toLowerCase();
    recs = all.filter((r) => String(r.commodity || '').toLowerCase().includes(q));
  }
  return recs
    .map((r) => ({
      market: r.market, district: r.district, state: r.state, commodity: r.commodity,
      variety: r.variety, date: r.arrival_date, t: ts(r.arrival_date),
      min: perKg(r.min_price), max: perKg(r.max_price), modal: perKg(r.modal_price)
    }))
    .filter((r) => r.modal);
}

// ---------- summary ----------
function summarize(rowsIn, commodity) {
  let rows = rowsIn;
  // "Potato" likhne par pehle poore naam wale ("Potato") lo, "Sweet Potato" jaise nahi
  const exact = rows.filter((r) => String(r.commodity).toLowerCase() === commodity.toLowerCase());
  if (exact.length) rows = exact;
  if (!rows.length) return { found: false, date: null, summary: null, rows: [] };

  const latest = Math.max(...rows.map((r) => r.t));
  const today = rows.filter((r) => r.t === latest).sort((a, b) => a.modal - b.modal);
  const modals = today.map((r) => r.modal);
  return {
    found: true,
    date: today[0].date,
    commodity: today[0].commodity,
    summary: {
      markets: today.length,
      low: Math.min(...today.map((r) => r.min || r.modal)),
      high: Math.max(...today.map((r) => r.max || r.modal)),
      avg: Math.round((modals.reduce((a, b) => a + b, 0) / modals.length) * 100) / 100
    },
    rows: today.slice(0, 50)
  };
}

exports.getMandiPrices = async (input) => {
  const commodity = clean(input.commodity, 40);
  const state = clean(input.state, 40);
  const district = clean(input.district, 40);
  if (!commodity) throw new Error('commodity required');

  const key = [commodity, state, district].join('|').toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.data;

  let rows = await fromDb({ commodity, state, district });
  if (!rows.length) rows = await fromApi({ commodity, state, district });   // Atlas mein nahi to live

  const data = summarize(rows, commodity);
  cache.set(key, { t: Date.now(), data });
  return data;
};