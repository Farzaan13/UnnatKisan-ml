module.exports = (err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', {
    title: 'Error',
    message: 'something went wrong. Please try again later.'
  });
};