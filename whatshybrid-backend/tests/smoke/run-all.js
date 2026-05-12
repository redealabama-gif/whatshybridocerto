#!/usr/bin/env node
/**
 * Test runner para todos os smoke tests.
 *
 * Roda cada teste em sequência, retorna 0 se todos passaram.
 * Pré-requisito: servidor rodando em $TEST_BASE_URL (default localhost:3000)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

const tests = [
  'auth-flow.test.js',
  'tokens-flow.test.js',
  'tenant-isolation.test.js',
  'v9-features.test.js',
];

async function checkServer() {
  try {
    const r = await fetch(`${BASE_URL}/health`);
    return r.ok;
  } catch (e) {
    return false;
  }
}

function runTest(file) {
  return new Promise((resolve) => {
    const fullPath = path.join(__dirname, file);
    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️  Test file não encontrado: ${file}`);
      return resolve(true);
    }
    const proc = spawn('node', [fullPath], {
      env: { ...process.env, TEST_BASE_URL: BASE_URL },
      stdio: 'inherit',
    });
    proc.on('close', (code) => resolve(code === 0));
  });
}

async function main() {
  console.log(`╔══════════════════════════════════════════════════╗`);
  console.log(`║  WhatsHybrid Pro — Smoke Test Suite              ║`);
  console.log(`║  Target: ${BASE_URL.padEnd(40)}║`);
  console.log(`╚══════════════════════════════════════════════════╝`);

  if (!(await checkServer())) {
    console.error(`\n❌ Server unreachable at ${BASE_URL}`);
    console.error(`   Inicie o backend e rode novamente.\n`);
    process.exit(2);
  }

  console.log(`\n✅ Server is up\n`);

  let allOk = true;
  for (const t of tests) {
    const ok = await runTest(t);
    if (!ok) allOk = false;
  }

  console.log(`\n${allOk ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}\n`);
  process.exit(allOk ? 0 : 1);
}

main();
