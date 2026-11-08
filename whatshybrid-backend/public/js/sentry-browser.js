/* eslint-env browser */
/**
 * Sentry no navegador (opcional).
 *
 * Liga só quando o backend expõe SENTRY_DSN_BROWSER em GET /config.js
 * (window.WHL_CONFIG) — carregue /config.js ANTES deste arquivo. Sem DSN,
 * nada é baixado.
 *
 * O SDK vem do CDN oficial do Sentry, com versão fixa (a mesma do
 * @sentry/node do backend). O host browser.sentry-cdn.com já é liberado na CSP
 * do portal (src/server.js), e o envio dos eventos passa pelo connect-src
 * https:. Se o CDN falhar, a página segue normal — só fica sem o Sentry.
 */
(function () {
  const SENTRY_BROWSER_VERSION = '7.120.4';
  const cfg = window.WHL_CONFIG || {};
  const dsn = cfg.SENTRY_DSN_BROWSER;
  if (!dsn) return;

  const script = document.createElement('script');
  script.src = 'https://browser.sentry-cdn.com/' + SENTRY_BROWSER_VERSION + '/bundle.min.js';
  script.crossOrigin = 'anonymous';
  script.async = true;
  script.onload = function () {
    if (!window.Sentry || typeof window.Sentry.init !== 'function') return;
    window.Sentry.init({
      dsn: dsn,
      release: cfg.APP_VERSION || undefined,
      environment: window.location.hostname,
    });
  };
  document.head.appendChild(script);
})();
