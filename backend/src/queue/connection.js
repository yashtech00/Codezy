const config = require('../config/env');

module.exports = {
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null,
};
