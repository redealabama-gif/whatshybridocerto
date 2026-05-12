/**
 * Extension Version Middleware — v9.2.0
 *
 * A extensão envia X-Extension-Version em todo request. O backend usa pra:
 *   1. Versionar handlers (compat 30+ dias com versões anteriores)
 *   2. Telemetria (saber quais versões estão em uso)
 *   3. Forçar update se versão muito antiga (kill switch)
 *
 * Uso em rotas:
 *   if (req.extVersion?.gte('9.2.0')) {
 *     // novo formato
 *   } else {
 *     // formato legado
 *   }
 *
 * Configuração via env:
 *   EXT_MIN_SUPPORTED_VERSION=9.0.0      → abaixo disso, retorna 426 Upgrade Required
 *   EXT_DEPRECATED_BELOW=9.1.0           → loga warning mas continua funcionando
 */

const logger = require('../utils/logger').logger;

const MIN_SUPPORTED = process.env.EXT_MIN_SUPPORTED_VERSION || '9.0.0';
const DEPRECATED_BELOW = process.env.EXT_DEPRECATED_BELOW || '9.0.0';

/**
 * Compara duas versões SemVer (sem deps). Retorna -1, 0, 1.
 * Suporta apenas major.minor.patch básico.
 */
function compareVersions(a, b) {
  const parse = (v) => {
    if (!v || typeof v !== 'string') return [0, 0, 0];
    return v.split('.').slice(0, 3).map(n => parseInt(n, 10) || 0);
  };
  const [aM, am, ap] = parse(a);
  const [bM, bm, bp] = parse(b);
  if (aM !== bM) return aM < bM ? -1 : 1;
  if (am !== bm) return am < bm ? -1 : 1;
  if (ap !== bp) return ap < bp ? -1 : 1;
  return 0;
}

class VersionWrapper {
  constructor(version) {
    this.raw = version || '0.0.0';
  }
  gte(other) { return compareVersions(this.raw, other) >= 0; }
  gt(other)  { return compareVersions(this.raw, other) > 0; }
  lte(other) { return compareVersions(this.raw, other) <= 0; }
  lt(other)  { return compareVersions(this.raw, other) < 0; }
  eq(other)  { return compareVersions(this.raw, other) === 0; }
  toString() { return this.raw; }
}

/**
 * Extrai versão da extensão dos headers (case-insensitive)
 */
function extractVersion(req) {
  return (
    req.headers['x-extension-version'] ||
    req.headers['x-ext-version'] ||
    req.body?._extension_version ||
    req.query?._ext ||
    null
  );
}

function middleware(opts = {}) {
  return (req, res, next) => {
    const version = extractVersion(req);

    // Apenas aplica em rotas da extensão (não no portal/marketing)
    const isExtensionRoute =
      req.path.startsWith('/api/v1/extension') ||
      req.path.startsWith('/api/v1/conversations') ||
      req.path.startsWith('/api/v1/contacts') ||
      req.path.startsWith('/api/v1/ai-settings') ||
      (req.path.startsWith('/api/v1/') && version);

    if (!isExtensionRoute) return next();

    if (!version) {
      // Sem header — pode ser portal (deixa passar) ou request muito velho
      return next();
    }

    req.extVersion = new VersionWrapper(version);

    // Kill switch: força update se versão muito velha
    if (req.extVersion.lt(MIN_SUPPORTED)) {
      logger.warn(`[ExtVersion] Blocked request from too-old version`, {
        version,
        min: MIN_SUPPORTED,
        path: req.path,
        ip: req.ip,
      });
      return res.status(426).json({
        error: 'Extension version too old. Please update.',
        code: 'EXTENSION_TOO_OLD',
        current_version: version,
        min_supported: MIN_SUPPORTED,
        update_url: 'https://chrome.google.com/webstore/detail/whatshybrid-pro/your-extension-id',
      });
    }

    // Deprecation warning header
    if (req.extVersion.lt(DEPRECATED_BELOW)) {
      res.setHeader('X-Extension-Deprecation-Warning',
        `Your extension version ${version} is deprecated. Please update to >= ${DEPRECATED_BELOW}.`);
    }

    // Atualiza last seen no workspace (best-effort, async)
    if (req.workspaceId) {
      setImmediate(() => {
        try {
          const db = require('../utils/database');
          db.run(
            `UPDATE workspaces SET current_extension_version = ? WHERE id = ?`,
            [version.substring(0, 20), req.workspaceId]
          );
        } catch (_) {}
      });
    }

    next();
  };
}

module.exports = { middleware, compareVersions, VersionWrapper, extractVersion };
