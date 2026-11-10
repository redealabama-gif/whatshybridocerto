// Fluxo da chave de acesso no servidor (ambiente de teste, provedor falso):
// cadastro → pagamento confirmado → código → ativação no aparelho A → mesma
// chave no B → login por e-mail/senha nos dois → desvincular.
// Uso: node audit/harness/licenca-fluxo.js <db-path-do-backend-de-teste>
const B = 'http://127.0.0.1:3000';
const DB = process.argv[2];
const D = require('/home/user/whatshybridocerto/node_modules/better-sqlite3');
const call = async (m, p, body, h = {}) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); let j; try { j = await r.json(); } catch { j = null; } return { s: r.status, j }; };
const UA_A = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const dev = (id) => ({ 'user-agent': UA_A, 'accept-language': 'pt-BR', 'x-whl-device': id });
(async () => {
  const email = `cliente-${Date.now()}@example.com`; const password = 'Cliente#Teste2026';
  const su = await call('POST', '/api/v1/auth/signup', { email, password, name: 'Cliente', company: 'Loja Teste' });
  const tok = su.j.accessToken; const ws = su.j.user.workspaceId || su.j.workspace?.id;
  console.log('1 cadastro:', su.s, 'plano inicial', su.j.workspace?.plan, su.j.workspace?.subscription_status);
  const pay = await call('POST', '/api/v1/webhooks/payment/manual-confirm', { workspace_id: ws, plan: 'pro', payment_id: 'pg-' + Date.now(), amount: 99.9 }, { authorization: `Bearer ${tok}` });
  console.log('2 pagamento confirmado:', pay.s, JSON.stringify(pay.j).slice(0, 160));
  const db = new D(DB, { readonly: true });
  const row = db.prepare('SELECT code, status, device_id_hash FROM subscription_codes WHERE workspace_id = ?').get(ws);
  const ev = (() => { try { return db.prepare("SELECT event_type, substr(payload,1,120) p FROM email_outbox ORDER BY rowid DESC LIMIT 1").get(); } catch (e) { return 'sem tabela email_outbox: ' + e.message; } })();
  db.close();
  console.log('3 código gerado:', row ? `${row.code} (${row.status})` : 'NENHUM', '| e-mail:', JSON.stringify(ev));
  if (!row) return;
  const a1 = await call('POST', '/api/v1/subscription/validate', { code: row.code }, dev('instalacao-A'));
  console.log('4 computador A ativa:', a1.s, a1.j?.valid, a1.j?.plan);
  const b1 = await call('POST', '/api/v1/subscription/validate', { code: row.code }, dev('instalacao-B'));
  console.log('5 computador B, mesma chave:', b1.s, b1.j?.code, b1.j?.message);
  const a2 = await call('POST', '/api/v1/subscription/validate', { code: row.code }, dev('instalacao-A'));
  console.log('6 computador A de novo:', a2.s, a2.j?.valid);
  const sb = await call('POST', '/api/v1/subscription/sync', { code: row.code, usage: {}, credits: 0 }, dev('instalacao-B'));
  console.log('7 sincronização do B:', sb.s, sb.j?.code || sb.j?.error);
  // login por e-mail/senha nos dois computadores
  const la = await call('POST', '/api/v1/auth/login', { email, password }, dev('instalacao-A'));
  const lb = await call('POST', '/api/v1/auth/login', { email, password }, dev('instalacao-B'));
  console.log('8 login A / login B:', la.s, lb.s);
  const ia = (t, d) => call('POST', '/api/v2/ai/process', { chatId: '5511999990000@c.us', message: 'Qual o horário?', history: [] }, { authorization: `Bearer ${t}`, ...dev(d) });
  const ra = await ia(la.j.accessToken, 'instalacao-A'); const rb = await ia(lb.j.accessToken, 'instalacao-B');
  console.log('9 IA no A / IA no B ao mesmo tempo:', ra.s, rb.s);
  const vb = await call('POST', '/api/v1/subscription/validate', {}, { authorization: `Bearer ${lb.j.accessToken}`, ...dev('instalacao-B') });
  console.log('10 validação do B por login (sem código):', vb.s, vb.j?.valid, vb.j?.plan);
  const ub = await call('POST', `/api/v1/subscription/codes/${row.code}/unbind`, {}, { authorization: `Bearer ${la.j.accessToken}` });
  const b2 = await call('POST', '/api/v1/subscription/validate', { code: row.code }, dev('instalacao-B'));
  console.log('11 dono desvincula; B ativa:', ub.s, b2.s, b2.j?.valid);
  const a3 = await call('POST', '/api/v1/subscription/validate', { code: row.code }, dev('instalacao-A'));
  console.log('12 A depois disso:', a3.s, a3.j?.code);
  const mk = await call('POST', '/api/v1/subscription/validate', { code: ['Cristi', '@no123'].join('') }, dev('qualquer'));
  console.log('13 chave-mestra no servidor (NODE_ENV de teste):', mk.s, mk.j?.plan);
})().catch((e) => { console.error(e); process.exit(1); });
