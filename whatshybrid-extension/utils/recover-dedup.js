/**
 * WA-06 — a tela do Recover descartava mensagens boas como "duplicata".
 *
 * A chave antiga era:
 *   from + to + body[0..50] + floor(timestamp / 5000)
 *
 * Ela não olhava o id nem o tipo. Medido no aparelho do dono (15/11/2026): um
 * áudio e uma imagem apagados na MESMA conversa, no MESMO segundo, os dois sem
 * legenda (mídia não tem texto) geravam exatamente a mesma chave — e a imagem
 * era jogada fora na hora de montar a lista. Ela estava salva e inteira
 * (98 KB, tamanho do original); só não aparecia.
 *
 * Agora o id manda: duas mensagens diferentes nunca compartilham id. A
 * heurística antiga (com tipo e ação somados) só vale para registro sem id,
 * que é o caso dos capturados pela tela.
 */
(function (root) {
  'use strict';

  const JANELA_MS = 5000; // registros do mesmo evento chegam por caminhos diferentes
  const CORPO = 50;

  function chaveDe(h) {
    const id = h && (h.id || h.msgId);
    if (id) return 'id:' + String(id);
    return [
      (h && h.from) || '',
      (h && h.to) || '',
      ((h && h.body) || '').substring(0, CORPO),
      (h && h.type) || '',
      (h && h.action) || '',
      Math.floor(((h && h.timestamp) || 0) / JANELA_MS),
    ].join('_');
  }

  function dedupRecoverHistory(lista) {
    const vistos = new Set();
    return (lista || []).filter((h) => {
      const k = chaveDe(h);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  }

  root.WHL_RecoverDedup = { dedupRecoverHistory, chaveDe };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WHL_RecoverDedup;
})(typeof window !== 'undefined' ? window : globalThis);
