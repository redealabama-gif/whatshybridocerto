/**
 * DOMs simulados do WhatsApp Web usados pelos harnesses.
 *  - bubbleOld: formato que o código da extensão espera (.message-in/.message-out,
 *    data-id "true|false_<chat>_<id>").
 *  - bubbleNew: formato observado no WhatsApp REAL do usuário (diagnóstico
 *    WHL_RecoverDiag + inspeção do DOM em 2026-11): data-id só com o id da
 *    mensagem, sem .message-in/.message-out e com UM único
 *    data-testid="msg-container" na página.
 */
'use strict';
const CONV = [
  ['in', 'Boa tarde! Vi o anúncio de vocês no Instagram'],
  ['out', 'Boa tarde! Que bom que chamou 😊 Como posso ajudar?'],
  ['in', 'Queria saber do plano para clínica odontológica'],
  ['out', 'Temos o plano Pro, ideal para clínicas. Quantos dentistas atendem aí?'],
  ['in', 'Somos 3 dentistas e 2 recepcionistas'],
  ['in', 'Quanto fica por mês para esse tamanho? E tem fidelidade?'],
];
function bubbleOld([dir, text], i) {
  return `<div class="${dir === 'out' ? 'message-out' : 'message-in'}" data-id="${dir === 'out'}_5511988887777@c.us_3EB0OLD${i}">
    <div class="copyable-text" data-pre-plain-text="[10:0${i}] X: "><span class="selectable-text copyable-text"><span>${text}</span></span></div>
    ${dir === 'out' ? '<span data-icon="msg-dblcheck"></span>' : ''}</div>`;
}
function bubbleNew([dir, text], i, msgContainerAt = 0) {
  return `<div role="row"><div data-id="3EB0NEW00000000000${i}">${i === msgContainerAt ? '<div data-testid="msg-container">' : '<div>'}
    <div class="copyable-text" data-pre-plain-text="[10:0${i}] X: "><span class="selectable-text copyable-text"><span>${text}</span></span></div>
    ${dir === 'out' ? '<span data-icon="msg-dblcheck"></span>' : ''}</div></div></div>`;
}
const page = (bubbles) => `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="main"><header><span title="Clínica Sorriso">Clínica Sorriso</span></header>
<div data-testid="conversation-panel-messages">${bubbles}</div>
<footer style="position:relative"><div contenteditable="true" role="textbox"></div></footer></div></body></html>`;
const CHROME_STUB = "window.chrome={runtime:{id:'x',sendMessage(){},onMessage:{addListener(){}},getURL:p=>p},storage:{local:{get(k,cb){if(cb){cb({});return}return Promise.resolve({})},set(o,cb){if(cb)cb();return Promise.resolve()}},onChanged:{addListener(){}}}};";
module.exports = { CONV, bubbleOld, bubbleNew, page, CHROME_STUB };
