'use strict';

/**
 * Testes do LearnedExamplesStore (Fase 3c) — captura da correção do operador
 * como exemplo de treino durável e recuperável. Usa um SQLite :memory: real
 * (mesmo engine do driver) pra validar o SQL de verdade, inclusive o upsert
 * de dedup por pergunta normalizada.
 */

const Database = require('better-sqlite3');
const store = require('../../src/ai/learning/LearnedExamplesStore');

// Shim com a MESMA interface do util de DB (run/get/all/exec, params em array).
function makeDb() {
  const raw = new Database(':memory:');
  return {
    _raw: raw,
    exec: (sql) => raw.exec(sql),
    run: (sql, params = []) => raw.prepare(sql).run(...params),
    get: (sql, params = []) => raw.prepare(sql).get(...params),
    all: (sql, params = []) => raw.prepare(sql).all(...params),
  };
}

function withEnv(key, val, fn) {
  const old = process.env[key];
  if (val === undefined) delete process.env[key];
  else process.env[key] = val;
  try {
    return fn();
  } finally {
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  }
}

describe('LearnedExamplesStore.captureFromEdit', () => {
  test('captura uma correção e o loadForRanking a devolve', () => {
    const db = makeDb();
    const r = store.captureFromEdit(
      {
        workspaceId: 'ws1',
        question: 'qual o prazo de entrega?',
        originalResponse: 'Não tenho essa informação.',
        correctedResponse: 'Entregamos em até 3 dias úteis para todo o Brasil.',
        intent: 'information',
      },
      db
    );
    expect(r.ok).toBe(true);

    const rows = store.loadForRanking(db, 'ws1');
    expect(rows).toHaveLength(1);
    expect(rows[0].output).toMatch(/3 dias úteis/);
    expect(rows[0].intent).toBe('information');
  });

  test('dedup: mesma pergunta (normalizada) faz UPDATE, não duplica — última correção vence', () => {
    const db = makeDb();
    store.captureFromEdit(
      {
        workspaceId: 'ws1',
        question: 'Qual o PREÇO?',
        correctedResponse: 'R$ 100',
        intent: 'pricing',
      },
      db
    );
    // mesma pergunta, acento/caixa diferentes + correção nova
    store.captureFromEdit(
      {
        workspaceId: 'ws1',
        question: 'qual o preco?',
        correctedResponse: 'R$ 120 (atualizado)',
        intent: 'pricing',
      },
      db
    );

    const rows = store.loadForRanking(db, 'ws1');
    expect(rows).toHaveLength(1); // dedup por pergunta normalizada
    expect(rows[0].output).toBe('R$ 120 (atualizado)'); // última vence
  });

  test('isolamento por workspace', () => {
    const db = makeDb();
    store.captureFromEdit(
      { workspaceId: 'ws1', question: 'oi', correctedResponse: 'Olá! Tudo bem?' },
      db
    );
    store.captureFromEdit(
      { workspaceId: 'ws2', question: 'oi', correctedResponse: 'Bom dia!' },
      db
    );
    expect(store.loadForRanking(db, 'ws1')).toHaveLength(1);
    expect(store.loadForRanking(db, 'ws2')).toHaveLength(1);
    expect(store.loadForRanking(db, 'ws1')[0].output).toBe('Olá! Tudo bem?');
  });

  test('reconstrói pergunta/intent/original de interaction_metadata via interactionId', () => {
    const db = makeDb();
    // simula o que o orquestrador grava
    db.exec(`CREATE TABLE interaction_metadata (
      interaction_id TEXT, workspace_id TEXT, chat_id TEXT, intent TEXT,
      question TEXT, response TEXT, response_goal TEXT, client_stage TEXT, variant TEXT
    );`);
    db.run(
      `INSERT INTO interaction_metadata (interaction_id, workspace_id, intent, question, response)
       VALUES (?, ?, ?, ?, ?)`,
      ['int-1', 'ws1', 'support', 'como troco minha senha?', 'Resposta original genérica.']
    );

    // cliente manda só interactionId + correção (sem question/intent)
    const r = store.captureFromEdit(
      {
        workspaceId: 'ws1',
        interactionId: 'int-1',
        correctedResponse: 'Vá em Configurações > Segurança > Trocar senha.',
      },
      db
    );
    expect(r.ok).toBe(true);

    const rows = store.loadForRanking(db, 'ws1');
    expect(rows).toHaveLength(1);
    expect(rows[0].input).toBe('como troco minha senha?');
    expect(rows[0].intent).toBe('support');
  });

  test('rejeita quando a "correção" é idêntica ao original (aprovação, não edição)', () => {
    const db = makeDb();
    const r = store.captureFromEdit(
      {
        workspaceId: 'ws1',
        question: 'oi',
        originalResponse: 'Olá! Como posso ajudar?',
        correctedResponse: '  Olá! Como posso ajudar?  ', // só espaços diferentes
      },
      db
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_an_edit');
    expect(store.loadForRanking(db, 'ws1')).toHaveLength(0);
  });

  test('rejeita entradas inválidas sem quebrar', () => {
    const db = makeDb();
    expect(
      store.captureFromEdit({ workspaceId: 'ws1', question: '', correctedResponse: 'x' }, db).ok
    ).toBe(false);
    expect(
      store.captureFromEdit({ workspaceId: 'ws1', question: 'oi', correctedResponse: '' }, db).ok
    ).toBe(false);
    expect(store.captureFromEdit({ correctedResponse: 'x', question: 'y' }, db).ok).toBe(false); // sem workspace
    expect(store.loadForRanking(db, 'ws1')).toHaveLength(0);
  });

  test('kill-switch WHL_LEARN_FROM_EDITS=0 → não captura', () => {
    const db = makeDb();
    withEnv('WHL_LEARN_FROM_EDITS', '0', () => {
      const r = store.captureFromEdit(
        { workspaceId: 'ws1', question: 'oi', correctedResponse: 'Olá!' },
        db
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('disabled');
    });
    // tabela nem precisa existir; loadForRanking tolera
    expect(store.loadForRanking(db, 'ws1')).toHaveLength(0);
  });

  test('caps de tamanho aplicados (input/output truncados)', () => {
    const db = makeDb();
    const longQ = 'q'.repeat(5000);
    const longA = 'a'.repeat(9000);
    store.captureFromEdit({ workspaceId: 'ws1', question: longQ, correctedResponse: longA }, db);
    const rows = store.loadForRanking(db, 'ws1');
    expect(rows[0].input.length).toBe(store.MAX_INPUT);
    expect(rows[0].output.length).toBe(store.MAX_OUTPUT);
  });
});
