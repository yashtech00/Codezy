import config from '../config/env.js';

export default {
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null,
};

