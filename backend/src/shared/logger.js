/**
 * Structured Logger for Codezy Level 2
 * Standardizes log format with correlation IDs and context information.
 */

export const createLogger = (context = {}) => {
  const sanitize = (data) => {
    if (!data) return data;
    if (typeof data !== 'object') return data;
    
    const sanitized = { ...data };
    // Redact potential secret keys
    const secretKeys = ['token', 'accessToken', 'refreshToken', 'secret', 'password', 'key', 'authorization'];
    for (const key of Object.keys(sanitized)) {
      if (secretKeys.some(s => key.toLowerCase().includes(s))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    return sanitized;
  };

  const formatMessage = (level, message, meta = {}) => {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      context: sanitize(context),
      meta: sanitize(meta),
    });
  };

  return {
    info: (message, meta) => console.log(formatMessage('INFO', message, meta)),
    warn: (message, meta) => console.warn(formatMessage('WARN', message, meta)),
    error: (message, meta) => console.error(formatMessage('ERROR', message, meta)),
    debug: (message, meta) => {
      if (process.env.NODE_ENV !== 'production') {
        console.debug(formatMessage('DEBUG', message, meta));
      }
    },
    withContext: (additionalContext) => createLogger({ ...context, ...additionalContext }),
  };
};

export const logger = createLogger();
