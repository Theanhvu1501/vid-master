/**
 * Simple logger for Veo3 module
 */
export function createLogger(prefix) {
  return {
    info: (...args) => console.log(`[${prefix}]`, ...args),
    warn: (...args) => console.warn(`[${prefix}]`, ...args),
    error: (...args) => console.error(`[${prefix}]`, ...args),
    debug: (...args) => {
      if (process.env.DEBUG) console.log(`[${prefix}:debug]`, ...args);
    },
    success: (...args) => console.log(`✓ [${prefix}]`, ...args),
  };
}

export default createLogger;
