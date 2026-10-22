const express = require('express');
const { isLoggedIn } = require('../middleware/auth');
const { getMandiPrices, listAllPrices, STATES } = require('../utils/mandi');

const router = express.Router();
router.use(isLoggedIn);

const hits = new Map();   // user ke hisaab se rate limit
const limited = (uid) => {
  const now = Date.now();
  const list = (hits.get(uid) || []).filter((t) => now - t < 60 * 1000);
  if (list.length >= 20) return true;
  list.push(now);
  hits.set(uid, list);
  return false;
};
const s = (v) => (typeof v === 'string' ? v : '');

router.get('/', (req, res) => {
  res.render('mandi/index', { title: 'Mandi Bhav', states: STATES });
});

// ek fasal ka mandi-wise bhav
router.get('/api', async (req, res) => {
  if (limited(req.session.user.id)) return res.status(429).json({ error: 'Thodi der baad try karo' });
  if (!s(req.query.commodity).trim()) return res.status(400).json({ error: 'Fasal ka naam likho' });

  try {
    res.json(await getMandiPrices({
      commodity: s(req.query.commodity), state: s(req.query.state), district: s(req.query.district)
    }));
  } catch (e) {
    console.error('mandi:', e.message, e.cause ? (e.cause.code || e.cause.message) : '');
    res.status(502).json({ error: 'Mandi bhav abhi nahi mil paa raha. Thodi der baad try karo.' });
  }
});

// saari fasal ki list
router.get('/all', async (req, res) => {
  if (limited(req.session.user.id)) return res.status(429).json({ error: 'Thodi der baad try karo' });
  try {
    res.json(await listAllPrices({ state: s(req.query.state) }));
  } catch (e) {
    console.error('mandi all:', e.message);
    res.status(502).json({ error: 'Mandi bhav abhi nahi mil paa raha. Thodi der baad try karo.' });
  }
});

module.exports = router;