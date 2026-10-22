const express = require('express');
const { isLoggedIn } = require('../middleware/auth');
const { getMandiPrices, STATES } = require('../utils/mandi');

const router = express.Router();
router.use(isLoggedIn);

const hits = new Map();   // user ke hisaab se rate limit

router.get('/', (req, res) => {
  res.render('mandi/index', { title: 'Mandi Bhav', states: STATES });
});

router.get('/api', async (req, res) => {
  const uid = req.session.user.id;
  const now = Date.now();
  const list = (hits.get(uid) || []).filter((t) => now - t < 60 * 1000);
  if (list.length >= 20) return res.status(429).json({ error: 'Thodi der baad try karo' });
  list.push(now);
  hits.set(uid, list);

  const s = (v) => (typeof v === 'string' ? v : '');
  if (!s(req.query.commodity).trim()) return res.status(400).json({ error: 'Fasal ka naam likho' });

  try {
    res.json(await getMandiPrices({
      commodity: s(req.query.commodity), state: s(req.query.state), district: s(req.query.district)
    }));
  } catch (e) {
    console.error('mandi:', e.message);
    res.status(502).json({ error: 'Mandi bhav abhi nahi mil paa raha. Thodi der baad try karo.' });
  }
});

module.exports = router;