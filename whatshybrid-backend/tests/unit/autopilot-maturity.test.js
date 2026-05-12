/**
 * Unit tests — AutopilotMaturityService
 *
 * Validate state machine: training → ready → live → paused → live → ...
 * Tests run with mocked db (no SQLite required).
 *
 * Run: node tests/unit/autopilot-maturity.test.js
 */

const assert = require('node:assert/strict');

// ═══ Test helpers ═════════════════════════════════════════════════════
const Module = require('module');
const orig = Module.prototype.require;

const mockDb = {
  rows: new Map(),
  exec() {},
  get(sql, args) { return mockDb.rows.get(args[0]) || null; },
  run(sql, args) {
    if (/INSERT INTO autopilot_maturity/i.test(sql)) {
      mockDb.rows.set(args[0], {
        workspace_id: args[0],
        stage: 'training',
        total_interactions: 0,
        approved_count: 0, edited_count: 0, rejected_count: 0,
        success_rate: 0,
        last_interactions: '[]',
        graduated_at: null, paused_at: null, paused_reason: null,
        config: '{}',
      });
      return { changes: 1 };
    }
    // promoteToLive / resumeLive
    if (/UPDATE autopilot_maturity SET stage = 'live'/i.test(sql)) {
      const wsId = args[0];
      const e = mockDb.rows.get(wsId) || {};
      mockDb.rows.set(wsId, { ...e, stage: 'live', paused_at: null, paused_reason: null });
      return { changes: 1 };
    }
    // reset
    if (/UPDATE autopilot_maturity SET\s*stage = 'training'/i.test(sql) && /paused_at = NULL/i.test(sql)) {
      const wsId = args[0];
      const e = mockDb.rows.get(wsId) || {};
      mockDb.rows.set(wsId, {
        ...e,
        stage: 'training',
        total_interactions: 0,
        approved_count: 0, edited_count: 0, rejected_count: 0,
        success_rate: 0,
        last_interactions: '[]',
        graduated_at: null, paused_at: null, paused_reason: null,
      });
      return { changes: 1 };
    }
    // recordInteraction (UPDATE com flags de paused)
    if (/UPDATE autopilot_maturity SET/i.test(sql)) {
      const wsId = args[args.length - 1];
      const existing = mockDb.rows.get(wsId) || {};
      const justEntered = args[8] === 1;
      const leftPaused = args[10] === 1;
      const justEnteredR = args[11] === 1;
      const reasonValue = args[12];
      const leftPausedR = args[14] === 1;

      let pausedAt = existing.paused_at;
      if (justEntered) pausedAt = new Date().toISOString();
      else if (leftPaused) pausedAt = null;

      let pausedReason = existing.paused_reason;
      if (justEnteredR) pausedReason = reasonValue;
      else if (leftPausedR) pausedReason = null;

      mockDb.rows.set(wsId, {
        ...existing,
        stage: args[0],
        total_interactions: args[1],
        approved_count: args[2],
        edited_count: args[3],
        rejected_count: args[4],
        success_rate: args[5],
        last_interactions: args[6],
        paused_at: pausedAt,
        paused_reason: pausedReason,
      });
      return { changes: 1 };
    }
    return { changes: 0 };
  },
};

Module.prototype.require = function(p) {
  if (p.endsWith('utils/logger') || p === '../../utils/logger') {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  }
  if (p.endsWith('utils/database') || p === '../../utils/database') return mockDb;
  return orig.apply(this, arguments);
};

const m = require('../../src/ai/services/AutopilotMaturityService');

// ═══ Tests ════════════════════════════════════════════════════════════
let pass = 0, fail = 0;
function test(label, fn) {
  try { fn(); pass++; console.log(`  ✅ ${label}`); }
  catch (e) { fail++; console.log(`  ❌ ${label}: ${e.message}`); }
}

console.log('\n=== AutopilotMaturityService — State Machine Tests ===\n');

test('initial state is training', () => {
  const ws = 'init-test';
  const s = m.getState(ws);
  assert.equal(s.stage, 'training');
  assert.equal(s.totalInteractions, 0);
  assert.equal(s.successRate, 0);
});

test('30 approveds → graduates to ready', () => {
  const ws = 'graduate-test';
  let s;
  for (let i = 0; i < 30; i++) s = m.recordInteraction(ws, 'approved');
  assert.equal(s.stage, 'ready');
  assert.equal(s.successRate, 1);
  assert.equal(s.approvedCount, 30);
});

test('29 approveds NOT enough to graduate', () => {
  const ws = 'edge-29';
  let s;
  for (let i = 0; i < 29; i++) s = m.recordInteraction(ws, 'approved');
  assert.equal(s.stage, 'training');
});

test('promoteToLive: ready → live', () => {
  const ws = 'promote-test';
  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'approved');
  const r = m.promoteToLive(ws);
  assert.equal(r.ok, true);
  assert.equal(r.stage, 'live');
});

test('promoteToLive fails if not in ready', () => {
  const ws = 'promote-fail';
  const r = m.promoteToLive(ws);
  assert.equal(r.ok, false);
});

test('live + many rejections → paused', () => {
  const ws = 'paused-test';
  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'approved');
  m.promoteToLive(ws);
  let s;
  for (let i = 0; i < 30; i++) s = m.recordInteraction(ws, 'rejected');
  assert.equal(s.stage, 'paused');
  assert.ok(s.pausedReason);
});

test('FIX paused_at preserved across interactions while paused', () => {
  const ws = 'paused-at-fix';
  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'approved');
  m.promoteToLive(ws);
  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'rejected');

  const pausedAt1 = mockDb.rows.get(ws).paused_at;
  assert.ok(pausedAt1, 'should have paused_at');

  // Wait then record another
  const start = Date.now();
  while (Date.now() - start < 10) {} // busy wait 10ms
  m.recordInteraction(ws, 'rejected');
  const pausedAt2 = mockDb.rows.get(ws).paused_at;

  assert.equal(pausedAt1, pausedAt2, 'paused_at should NOT be overwritten');
});

test('FIX paused_reason preserved while paused', () => {
  const ws = 'reason-preserve';
  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'approved');
  m.promoteToLive(ws);
  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'rejected');

  const reason1 = mockDb.rows.get(ws).paused_reason;
  assert.ok(reason1);

  m.recordInteraction(ws, 'rejected');
  m.recordInteraction(ws, 'approved'); // approved doesn't unpaused

  const reason2 = mockDb.rows.get(ws).paused_reason;
  assert.equal(reason1, reason2, 'paused_reason should NOT be overwritten');
});

test('resumeLive: paused → live, paused fields cleared', () => {
  const ws = 'resume-test';
  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'approved');
  m.promoteToLive(ws);
  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'rejected');

  const r = m.resumeLive(ws);
  assert.equal(r.ok, true);
  assert.equal(r.stage, 'live');

  const row = mockDb.rows.get(ws);
  assert.equal(row.paused_at, null, 'paused_at should be null after resume');
  assert.equal(row.paused_reason, null, 'paused_reason should be null after resume');
});

test('paused → live → paused: new paused_at registered', () => {
  const ws = 'pause-cycle';
  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'approved');
  m.promoteToLive(ws);
  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'rejected');
  const pausedAt1 = mockDb.rows.get(ws).paused_at;

  m.resumeLive(ws);

  const start = Date.now();
  while (Date.now() - start < 10) {}

  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'rejected');
  const pausedAt2 = mockDb.rows.get(ws).paused_at;

  assert.ok(pausedAt2);
  assert.notEqual(pausedAt1, pausedAt2, 'should have new paused_at on second pause');
});

test('reset clears everything', () => {
  const ws = 'reset-test';
  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'approved');
  m.promoteToLive(ws);

  m.reset(ws);
  const s = m.getState(ws);
  assert.equal(s.stage, 'training');
  assert.equal(s.totalInteractions, 0);
  assert.equal(s.lastInteractions.length, 0);
  assert.equal(s.approvedCount, 0);
});

test('edited counts as success', () => {
  const ws = 'edited-test';
  let s;
  for (let i = 0; i < 30; i++) s = m.recordInteraction(ws, 'edited');
  assert.equal(s.stage, 'ready', 'edited should graduate');
  assert.equal(s.successRate, 1);
  assert.equal(s.approvedCount, 0);
  assert.equal(s.editedCount, 30);
});

test('invalid outcome throws', () => {
  const ws = 'invalid-test';
  assert.throws(() => m.recordInteraction(ws, 'foo'), /outcome inválido/);
});

test('canAutoSend: false unless live', () => {
  const ws = 'canauto-1';
  assert.equal(m.canAutoSend(ws), false, 'training → false');

  for (let i = 0; i < 30; i++) m.recordInteraction(ws, 'approved');
  assert.equal(m.canAutoSend(ws), false, 'ready → false');

  m.promoteToLive(ws);
  assert.equal(m.canAutoSend(ws), true, 'live → true');
});

test('rolling window caps at ROLLING_WINDOW (50)', () => {
  const ws = 'rolling-test';
  for (let i = 0; i < 80; i++) m.recordInteraction(ws, 'approved');
  const s = m.getState(ws);
  assert.equal(s.lastInteractions.length, 50);
  assert.equal(s.totalInteractions, 80);
  assert.equal(s.approvedCount, 80);
});

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Result: ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? '✅ All tests passed' : '❌ Tests failed');
process.exit(fail > 0 ? 1 : 0);
