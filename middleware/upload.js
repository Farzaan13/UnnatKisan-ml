const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG or WEBP image is allowed '));
  }
}).single('image');

// multer ke errors ko flash mein badalne wala wrapper
module.exports = (req, res, next) => {
  upload(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Image size must be less than 2MB'
        : err.message;
      req.flash('error', msg);
      return res.redirect(req.get('Referer') || '/kisan/dashboard');
    }
    next();
  });
};