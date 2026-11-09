#!/usr/bin/env node
/**
 * Diagnóstico com as chaves REAIS: N amostras do MÉTODO 0 (/api/v2/ai/process)
 * por conversa (sintéticas por padrão; CONVERSAS_FILE=<json fora do repo> para
 * outras), com marcas automáticas: GENÉRICA (frase de atendimento), LACUNA
 * ("R$ XXX", "[valor]"), FIDELIDADE-SEM-CONFIRMAR (loja) e FALHOU.
 * Uso: node audit/harness/real-sampling.js <backend> <N> [tag]  (OUT=<json> opcional)
 */
'use strict';
const fs = require('fs');
const B = process.argv[2]; const N = +process.argv[3] || 3; const TAG = process.argv[4] || '';
const CONV = process.env.CONVERSAS_FILE ? JSON.parse(fs.readFileSync(process.env.CONVERSAS_FILE, 'utf8')) : {
  compra_rastreio: [['assistant','Boa noite! Conseguiu ver o código de rastreio do meu pedido?'],['user','Boa noite! Hoje temos envio'],['user','Até as 20h mando o rastreio'],['assistant','Beleza, fico no aguardo'],['assistant','O que eu comprei é aquele da foto, de 90mg?'],['user','Sim'],['user','PX123456789BR'],['user','O prazo é de uns 7 dias'],['user','Esse rastreio é da transportadora Jet']],
  colega_trabalho: [['assistant','Fala, pode tirar uma dúvida minha?'],['assistant','Tu tem o contato de alguém do RH da regional?'],['user','Pra falar sobre qual assunto??'],['user','Eles não vão saber'],['user','Vão dizer que é assunto da outra unidade']],
  pessoal_tensa: [['user','Melhor a gente não se falar hoje'],['user','Você prometeu e não cumpriu de novo'],['assistant','Calma, deixa eu te explicar'],['user','Não quero nem imaginar como vai ser da próxima vez'],['user','A conclusão é que você vai fazer de novo e pior']],
  loja_controle: [['user','Boa tarde! Vi o anúncio de vocês no Instagram'],['assistant','Boa tarde! Que bom que chamou 😊 Como posso ajudar?'],['user','Queria saber do plano para clínica odontológica'],['assistant','Temos o plano Pro, ideal para clínicas. Quantos dentistas atendem aí?'],['user','Somos 3 dentistas e 2 recepcionistas'],['user','Quanto fica por mês para esse tamanho? E tem fidelidade?']],
};
const GENERIC = /(em que (mais )?posso (ser útil|te ajudar|ajudar)|estou (à|a) (sua )?disposição|estou aqui para (te )?ajudar|posso (te )?ajudar com mais alguma|se (houver|tiver|precisar de) (mais )?(algo|alguma (coisa|informação))|qualquer (coisa|dúvida),? (me )?(avis|cham|estou))/i;
const PLACEHOLDER = /(R\$\s*(\[|X{2,}|_)|\[valor\]|XXX)/i;
async function http(method, url, body, token) {
  const t0 = Date.now();
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { _t: t.slice(0, 200) }; }
  return { status: r.status, json: j, ms: Date.now() - t0 };
}
(async () => {
  const sign = await http('POST', `${B}/api/v1/auth/signup`, { email: `aval-${Date.now()}-${Math.random().toString(36).slice(2,6)}@example.com`, password: 'Audit#Senha2026', name: 'Aval', company: 'Avaliacao Prompt Real', plan: 'pro' });
  const token = sign.json.accessToken; if (!token) throw new Error(JSON.stringify(sign.json));
  const out = { tag: TAG, backend: B, n: N, results: {} };
  let i = 0;
  for (const [name, conv] of Object.entries(CONV)) {
    out.results[name] = [];
    const history = conv.map(([role, content]) => ({ role, content }));
    const last = [...conv].reverse().find(([r]) => r === 'user')[1];
    for (let r = 0; r < N; r++) {
      const res = await http('POST', `${B}/api/v2/ai/process`, { chatId: `55119${String(++i).padStart(8,'0')}@c.us`, message: last, language: 'pt-BR', history }, token);
      const text = res.json.response || `[erro ${res.status}: ${res.json.error || ''}]`;
      const flags = [GENERIC.test(text) && 'GENÉRICA', PLACEHOLDER.test(text) && 'LACUNA', name === 'loja_controle' && /fidelidade/i.test(text) && !/(confirm|verific|checar|consult)/i.test(text) && 'FIDELIDADE-SEM-CONFIRMAR', res.json.success === false && 'FALHOU'].filter(Boolean);
      out.results[name].push({ ms: res.ms, success: res.json.success, text, flags });
      console.log(`[${TAG}] ${name} #${r + 1} ${res.ms}ms ${flags.join(',') || 'ok'} :: ${text.replace(/\s+/g, ' ').slice(0, 230)}`);
    }
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
