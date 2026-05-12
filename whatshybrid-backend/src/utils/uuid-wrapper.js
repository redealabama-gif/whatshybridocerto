/**
 * UUID Wrapper for CommonJS compatibility
 * Provides synchronous access to UUID v13.x (ESM) in CommonJS environment
 */

let uuidModule = null;
let initPromise = null;

/**
 * Initialize UUID module (call once at startup)
 */
async function initUUID() {
  if (!initPromise) {
    initPromise = import('uuid').then(module => {
      uuidModule = module;
      return module;
    });
  }
  return initPromise;
}

/**
 * Get UUID v4 function
 * Must call initUUID() before using this
 */
function uuidv4() {
  if (!uuidModule) {
    throw new Error('UUID module not initialized. Call initUUID() first.');
  }
  return uuidModule.v4();
}

/**
 * Generate UUID v4 (async)
 */
async function generateUUID() {
  if (!uuidModule) {
    await initUUID();
  }
  return uuidModule.v4();
}

module.exports = {
  initUUID,
  uuidv4,
  generateUUID,
  v4: uuidv4
};
