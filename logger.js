const format = require("date-fns/format");

const webLogger = (req, e) => {
  console.log(format(new Date(), "yyyy-MM-dd HH:mm:ss"));
  console.log(`[${req.method}] ${req.originalUrl}`);
  console.log(e);
  console.error(format(new Date(), "yyyy-MM-dd HH:mm:ss"));
  console.error(`[${req.method}] ${req.originalUrl}`);
  console.error(e);
};

const logger = (e) => {
  console.log(format(new Date(), "yyyy-MM-dd HH:mm:ss"));
  console.error(e);
};

module.exports = { webLogger, logger };
