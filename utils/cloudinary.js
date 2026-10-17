const { v2: cloudinary } = require('cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// multer ki memory mein padi file ko Cloudinary par bhejo, secure_url wapas milta hai
// folder: 'crops' ya 'payments'
exports.uploadBuffer = (file, folder) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: `unnatkisan/${folder}`,
          resource_type: 'image',
          // bahut badi photo ko 1200px tak chhota karo, size bhi kam hoga
          transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }]
        },
        (err, result) => (err ? reject(err) : resolve(result))
      )
      .end(file.buffer);
  });

// purani photo delete karo (URL se public_id nikalkar). Fail ho to chup-chaap ignore.
exports.removeByUrl = async (url) => {
  if (!url || !url.includes('res.cloudinary.com')) return;
  const m = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i);
  if (!m) return;
  try {
    await cloudinary.uploader.destroy(m[1]);
  } catch (e) { /* ignore */ }
};