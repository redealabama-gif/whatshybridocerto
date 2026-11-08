#!/usr/bin/env node
/**
 * Auditoria IA — HybridIntentClassifier.classifyWithRegex com as mensagens do
 * cenário S1. Mostra, por intenção, o "score" usado no ranking (soma do
 * comprimento do TEXTO da regex, pattern.source.length) e a confiança final.
 * Uso (na raiz): node audit/scripts/classificador-intencao.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const BE = path.resolve(__dirname, '../../whatshybrid-backend');
const C = require(path.join(BE, 'src/ai/classifiers/HybridIntentClassifier.js'));
const c = new C({});
const src = fs.readFileSync(path.join(BE, 'src/ai/classifiers/HybridIntentClassifier.js'), 'utf8');
// reconstrói REGEX_PATTERNS do arquivo para mostrar o score por intenção
const block = src.slice(src.indexOf('const REGEX_PATTERNS = {'), src.indexOf('};', src.indexOf('const REGEX_PATTERNS = {')) + 2);
const REGEX_PATTERNS = new Function(block.replace('const REGEX_PATTERNS =', 'return'))();
const MSGS = [
  ['preco', 'Oi, quanto custa o plano mensal de vocês? Tem desconto no anual?'],
  ['preco sem "Oi"', 'Quanto custa o plano mensal de vocês? Tem desconto no anual?'],
  ['entrega', 'Bom dia! Vocês entregam em Campinas? Qual o prazo?'],
  ['reclamacao', 'Comprei semana passada e até agora não chegou, estou bem chateado'],
  ['reembolso', 'Quero meu dinheiro de volta, vou no Procon'],
  ['saude', 'Esse suplemento cura diabetes? Posso parar o remédio?'],
];
const out = ['# HybridIntentClassifier.classifyWithRegex — por que preço vira "greeting"', '',
  `limiar para pular o LLM: confidence > ${c.confidenceThreshold} (HybridIntentClassifier.js:400)`, ''];
for (const [k, m] of MSGS) {
  const r = c.classifyWithRegex(m);
  const scores = Object.entries(REGEX_PATTERNS).map(([intent, pats]) => {
    const hit = pats.filter((p) => p.test(m));
    return { intent, score: hit.reduce((s, p) => s + p.source.length, 0), matches: hit.length };
  }).filter((x) => x.matches).sort((a, b) => b.score - a.score);
  out.push(`- **${k}**: "${m}" → intent=**${r.intent}** conf=${r.confidence} ${r.confidence > c.confidenceThreshold ? '(LLM NÃO consultado)' : '(vai ao LLM se houver chave)'}`);
  out.push(`  scores (soma de pattern.source.length): ${scores.map((s) => `${s.intent}=${s.score}/${s.matches}m`).join(' · ')}`);
}
fs.writeFileSync(path.resolve(__dirname, '../evidencias/23-classificador-intencao.md'), out.join('\n') + '\n');
console.log(out.join('\n'));
