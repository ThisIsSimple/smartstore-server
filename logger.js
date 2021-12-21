const logger = (req, e) => {
  console.error(`[${req.method}] ${req.originalUrl}`)
  console.error(e);
};

module.exports = {
  logger,
};
