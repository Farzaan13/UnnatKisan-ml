require('node:dns').setServers(['8.8.8.8', '1.1.1.1']);   // local DNS ki dikkat ke liye
require('dotenv').config();

const mongoose = require('mongoose');
const MandiPrice = require('../models/MandiPrice');

const RESOURCE = '9ef84268-d588-465a-a308-a864a43d0070';
const LIMIT = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ts = (s) => {
  const [d, m, y] = String(s || '').split('/').map(Number);
  return y ? new Date(y, m - 1, d).getTime() : 0;
};
const perKg = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round((n / 100) * 100) / 100 : null;
};

async function page(offset) {
  const url = new URL(`https://api.data.gov.in/resource/${RESOURCE}`);
  url.searchParams.set('api-key', process.env.DATA_GOV_API_KEY);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(LIMIT));
  url.searchParams.set('offset', String(offset));

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      return json.records || [];
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1500 * attempt);
    }
  }
}

(async () => {
  if (!process.env.DATA_GOV_API_KEY) throw new Error('.env mein DATA_GOV_API_KEY nahi hai');
  if (!process.env.MONGO_URL) throw new Error('.env mein MONGO_URL (Atlas) nahi hai');

  await mongoose.connect(process.env.MONGO_URL);
  await MandiPrice.init();                       // unique index banao

  const syncId = String(Date.now());
  let total = 0;
  let offset = 0;

  while (true) {
    const recs = await page(offset);
    if (!recs.length) break;

    const ops = recs
      .map((r) => {
        const modal = perKg(r.modal_price);
        if (!modal) return null;
        const doc = {
          state: r.state || '', district: r.district || '', market: r.market || '',
          commodity: r.commodity || '', variety: r.variety || '', grade: r.grade || '',
          date: r.arrival_date || '', t: ts(r.arrival_date),
          min: perKg(r.min_price), max: perKg(r.max_price), modal, syncId
        };
        return {
          updateOne: {
            filter: {
              state: doc.state, district: doc.district, market: doc.market,
              commodity: doc.commodity, variety: doc.variety, grade: doc.grade, date: doc.date
            },
            update: { $set: doc },
            upsert: true
          }
        };
      })
      .filter(Boolean);

    if (ops.length) await MandiPrice.bulkWrite(ops, { ordered: true });
    total += ops.length;
    console.log(`${total} records save hue...`);

    if (recs.length < LIMIT || offset >= 100000) break;
    offset += LIMIT;
    await sleep(300);
  }

  if (total > 0) {
    const old = await MandiPrice.deleteMany({ syncId: { $ne: syncId } });   // purana data hatao
    console.log('Purane records hataye:', old.deletedCount);
  }
  console.log('Sync poora. Total:', total);
  await mongoose.disconnect();
})().catch((e) => { console.error('Fail:', e.message); process.exit(1); });