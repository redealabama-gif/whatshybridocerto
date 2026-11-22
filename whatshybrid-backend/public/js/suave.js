/**
 * Vórtex Pro — rolagem suave (Lenis)
 *
 * POR QUE. Medi deltacafes.com e landonorris.com, os dois sites que o dono
 * trouxe como referência de "premium": os dois usam Lenis, e o <html> dos
 * dois carrega a classe `lenis`. É a assinatura mais reconhecível de site
 * caprichado, e são 13 KB auto-hospedados.
 *
 * TRÊS COISAS DO PROJETO BRIGAM COM ELE, e estão tratadas aqui:
 *
 * 1. `html { scroll-behavior: smooth }` (css/futuristic.css:32). A rolagem
 *    suave NATIVA disputa com a do Lenis e o resultado treme. A classe
 *    .lenis em <html> desliga a nativa (regra em css/redesign.css).
 *
 * 2. `html { scroll-padding-top: 96px }` (css/redesign.css). O navegador
 *    respeita isso num salto de âncora nativo; o scrollTo do Lenis não.
 *    Sem o offset abaixo, o título da seção volta a parar atrás da barra
 *    fixa — o mesmo defeito que o scroll-padding resolveu.
 *
 * 3. `prefers-reduced-motion`. Quem pediu menos movimento não quer a
 *    página deslizando: nesse caso o Lenis nem começa, e a rolagem segue
 *    a do sistema.
 *
 * O parallax e o carregador de fundos (js/landing-fx.js) ouvem o evento
 * `scroll` do window. O Lenis, rolando o documento (sem wrapper), continua
 * emitindo esse evento — por isso os dois seguem funcionando sem mudança.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  var menosMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (menosMovimento || typeof globalThis.Lenis !== 'function') return;

  // Mesmo valor do scroll-padding-top do CSS. Se um mudar, o outro muda:
  // é a altura da barra fixa mais uma folga.
  var FOLGA_DA_BARRA = 96;

  var lenis = new globalThis.Lenis({
    // 1,05 s para o deslize assentar. Abaixo de 0,8 quase não se nota;
    // acima de 1,3 a página parece pesada e o visitante briga com ela.
    duration: 1.05,
    // Desaceleração exponencial: rápida no começo, macia no fim.
    easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
    smoothWheel: true,
    // No celular a rolagem por toque já é suave e tem física própria do
    // sistema. Interceptar piora: perde o "arremesso" nativo.
    syncTouch: false,
  });

  function quadro(tempo) {
    lenis.raf(tempo);
    requestAnimationFrame(quadro);
  }
  requestAnimationFrame(quadro);

  /* Âncoras do menu — sem isto o salto some, porque o Lenis assume o
     controle da posição e o pulo nativo do navegador é desfeito. */
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href^="#"]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href === '#') return;
    var alvo = document.querySelector(href);
    if (!alvo) return;
    ev.preventDefault();
    lenis.scrollTo(alvo, { offset: -FOLGA_DA_BARRA, duration: 1.1 });
    // Mantém o endereço com a âncora, como o navegador faria, sem
    // disparar outro salto.
    if (window.history && window.history.pushState) {
      window.history.pushState(null, '', href);
    }
  });

  // Quem chega pelo endereço com #secao: o navegador já posicionou, mas
  // sem conhecer a barra fixa quando o Lenis está no comando.
  window.addEventListener('load', function () {
    if (!window.location.hash) return;
    var alvo = document.querySelector(window.location.hash);
    if (alvo) lenis.scrollTo(alvo, { offset: -FOLGA_DA_BARRA, immediate: true });
  });

  // Deixa acessível para depuração e para quem precisar parar a rolagem
  // (um modal aberto, por exemplo).
  window.__lenis = lenis;
})();
