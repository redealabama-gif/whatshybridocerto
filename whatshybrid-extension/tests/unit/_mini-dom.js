/**
 * Mini-DOM para testes em Node puro (sem jsdom): parser de HTML simples e
 * seletores CSS no nível que os módulos da extensão usam —
 *   tag, #id, .classe, [attr], [attr="v"], [attr^="v"], [attr*="v"], [attr$="v"]
 *   (com flag " i"), compostos (span.selectable-text), descendente (espaço),
 *   filho (>) e listas com vírgula.
 * O nome começa com "_" para o run-all.js não tratá-lo como arquivo de teste.
 */
'use strict';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

class Node {
  constructor(tagName, attrs, parent) {
    this.nodeType = 1;
    this.tagName = (tagName || '').toUpperCase();
    this.attrs = attrs || {};
    this.parentElement = parent || null;
    this.childNodes = [];
  }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get id() { return this.attrs.id || ''; }
  get textContent() {
    return this.childNodes.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join('');
  }
  get classList() {
    const list = String(this.attrs.class || '').split(/\s+/).filter(Boolean);
    return { contains: (c) => list.includes(c) };
  }
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  matches(sel) { return parseSelectorList(sel).some((complex) => matchComplex(this, complex)); }
  closest(sel) {
    const list = parseSelectorList(sel);
    for (let n = this; n && n.nodeType === 1; n = n.parentElement) {
      if (list.some((complex) => matchComplex(n, complex))) return n;
    }
    return null;
  }
  querySelectorAll(sel) {
    const list = parseSelectorList(sel);
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (list.some((complex) => matchComplex(c, complex))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

// ── seletores ────────────────────────────────────────────────────────────────
function splitTop(s, ch) {
  const parts = [];
  let depth = 0; let quote = null; let cur = '';
  for (const c of s) {
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '[' || c === '(') depth++;
    if (c === ']' || c === ')') depth--;
    if (c === ch && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseCompound(src) {
  const comp = { tag: null, id: null, classes: [], attrs: [] };
  const re = /^([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:([\^*$]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*(i)?)?\s*\]/g;
  let m; let pos = 0;
  while ((m = re.exec(src)) && m.index === pos) {
    pos = re.lastIndex;
    if (m[1] && m[1] !== '*') comp.tag = m[1].toUpperCase();
    else if (m[2]) comp.id = m[2];
    else if (m[3]) comp.classes.push(m[3]);
    else if (m[4]) comp.attrs.push({ name: m[4], op: m[5] || null, val: m[6] ?? m[7] ?? m[8] ?? null, ci: !!m[9] });
  }
  if (pos !== src.length) throw new Error(`mini-dom: seletor não suportado: "${src}"`);
  return comp;
}

function parseComplex(src) {
  // tokens: compostos separados por " " (descendente) ou ">" (filho)
  const tokens = src.replace(/\s*>\s*/g, ' > ').trim().split(/\s+/);
  const steps = [];
  let comb = ' ';
  for (const t of tokens) {
    if (t === '>') { comb = '>'; continue; }
    steps.push({ comb, comp: parseCompound(t) });
    comb = ' ';
  }
  return steps;
}

const cache = new Map();
function parseSelectorList(sel) {
  if (!cache.has(sel)) cache.set(sel, splitTop(String(sel), ',').map(parseComplex));
  return cache.get(sel);
}

function matchCompound(n, c) {
  if (c.tag && n.tagName !== c.tag) return false;
  if (c.id && n.attrs.id !== c.id) return false;
  for (const cl of c.classes) if (!n.classList.contains(cl)) return false;
  for (const a of c.attrs) {
    if (!n.hasAttribute(a.name)) return false;
    if (!a.op) continue;
    let v = String(n.attrs[a.name]); let w = String(a.val);
    if (a.ci) { v = v.toLowerCase(); w = w.toLowerCase(); }
    if (a.op === '=' && v !== w) return false;
    if (a.op === '^=' && !v.startsWith(w)) return false;
    if (a.op === '*=' && !v.includes(w)) return false;
    if (a.op === '$=' && !v.endsWith(w)) return false;
  }
  return true;
}

function matchComplex(n, steps, i = steps.length - 1) {
  if (!matchCompound(n, steps[i].comp)) return false;
  if (i === 0) return true;
  if (steps[i].comb === '>') return !!n.parentElement && n.parentElement.nodeType === 1 && matchComplex(n.parentElement, steps, i - 1);
  for (let p = n.parentElement; p && p.nodeType === 1; p = p.parentElement) {
    if (matchComplex(p, steps, i - 1)) return true;
  }
  return false;
}

// ── HTML ─────────────────────────────────────────────────────────────────────
function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function parseHTML(html) {
  const root = new Node('#root', {}, null);
  root.nodeType = 9;
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) { // fecha
      const tag = m[1].toUpperCase();
      for (let n = cur; n && n !== root; n = n.parentElement) {
        if (n.tagName === tag) { cur = n.parentElement; break; }
      }
    } else if (m[2]) { // abre
      const attrs = {};
      const ar = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = ar.exec(m[3] || ''))) attrs[a[1]] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      const node = new Node(m[2], attrs, cur.nodeType === 9 ? null : cur);
      cur.childNodes.push(node);
      if (!m[4] && !VOID.has(m[2].toLowerCase())) cur = node;
    } else if (m[5]) { // texto
      cur.childNodes.push({ nodeType: 3, text: decode(m[5]) });
    }
  }
  return root;
}

/** Documento mínimo a partir de um HTML. */
function createDocument(html) {
  const root = parseHTML(html);
  const doc = {
    readyState: 'complete',
    nodeType: 9,
    childNodes: root.childNodes,
    querySelectorAll: (sel) => Node.prototype.querySelectorAll.call(root, sel),
    querySelector: (sel) => Node.prototype.querySelector.call(root, sel),
    getElementById: (id) => Node.prototype.querySelector.call(root, `#${id}`),
    addEventListener() {},
    removeEventListener() {},
    createElement: (tag) => new Node(tag, {}, null),
  };
  doc.body = doc.querySelector('body');
  doc.head = doc.querySelector('head');
  return doc;
}

module.exports = { createDocument, parseHTML };
