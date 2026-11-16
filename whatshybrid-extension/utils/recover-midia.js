/**
 * WA-05 — o botão de baixar do histórico navegava até em registro SEM mídia.
 *
 * O dono clicou em baixar numa mensagem de TEXTO editada. Sem arquivo em
 * cache, o painel caía no caminho "localizar no WhatsApp", que abre a conversa
 * pelo chatId guardado. Como esse chatId era um `@lid`, o WhatsApp tratou os
 * dígitos como telefone e mostrou "O número +244 194828361906 não está no
 * WhatsApp" — um número que nunca existiu, no meio de outra conversa aberta.
 *
 * Mensagem de texto não tem o que buscar no WhatsApp: o conteúdo já está
 * guardado. Este teste decide se vale navegar.
 */
(function (root) {
  'use strict';

  const TIPOS_DE_MIDIA = ['image', 'video', 'audio', 'ptt', 'sticker', 'document', 'gif'];

  /** O registro é de mídia? (pelo tipo declarado ou pelo mimetype guardado) */
  function ehDeMidia(msg) {
    if (!msg) return false;
    const tipo = String(msg.mediaType || msg.type || '').toLowerCase();
    if (TIPOS_DE_MIDIA.includes(tipo)) return true;
    const mime = String(msg.mimetype || '');
    return /^(image|video|audio|application)\//.test(mime);
  }

  /**
   * Vale a pena ir ao WhatsApp procurar o arquivo?
   * Só quando é mídia E existe por onde buscar (directPath/mediaKey, ou o
   * próprio chat para achar a mensagem na tela).
   */
  function valeNavegarPorMidia(msg) {
    if (!ehDeMidia(msg)) return false;
    return !!(msg.directPath || msg.mediaKey || msg.chatId);
  }

  root.WHL_RecoverMidia = { ehDeMidia, valeNavegarPorMidia, TIPOS_DE_MIDIA };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WHL_RecoverMidia;
})(typeof window !== 'undefined' ? window : globalThis);
