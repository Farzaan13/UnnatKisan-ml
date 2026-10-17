
// local DNS ki problem ke liye (Atlas SRV)
require('node:dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { uploadBuffer } = require('../utils/cloudinary');

const LOCAL = process.env.LOCAL_MONGO_URL;  // purana local database
const ATLAS = process.env.MONGO_URL;        // naya Atlas database

// '/uploads/abc.jpg' jaisi purani photo ko Cloudinary par bhejo aur naya link do
async function toCloud(url, folder) {
  if (!url || !url.startsWith('/uploads/')) return url;
  const file = path.join(__dirname, '..', 'public', url);
  if (!fs.existsSync(file)) {
    console.log('  photo file nahi mili:', url);
    return undefined;
  }
  const r = await uploadBuffer({ buffer: fs.readFileSync(file) }, folder);
  return r.secure_url;
}

(async () => {
  if (!LOCAL || !ATLAS) throw new Error('.env mein LOCAL_MONGO_URL aur MONGO_URL dono chahiye');
  if (LOCAL === ATLAS) throw new Error('LOCAL_MONGO_URL aur MONGO_URL alag honi chahiye');

  const src = await mongoose.createConnection(LOCAL).asPromise();
  const dst = await mongoose.createConnection(ATLAS).asPromise();
  console.log('Dono database connect ho gaye');

  const cols = (await src.db.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.') && n !== 'sessions');

  for (const name of cols) {
    const docs = await src.db.collection(name).find().toArray();
    if (!docs.length) { console.log(`${name}: khali, skip`); continue; }

    for (const d of docs) {
      if (name === 'crops') {
        d.image = await toCloud(d.image, 'crops');
        if (!d.verified) d.verified = 'verified';        // purani crops live rahengi
      }
      if (name === 'orders') {
        d.paymentProof = await toCloud(d.paymentProof, 'payments');
      }
    }

    // _id ke hisaab se upsert, to script dobara chalane par duplicate nahi banenge
    await dst.db.collection(name).bulkWrite(
      docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } }))
    );
    console.log(`${name}: ${docs.length} documents copy hue`);
  }

  await src.close();
  await dst.close();
  console.log('Migration poora');
})().catch((e) => { console.error('Fail:', e.message); process.exit(1); });