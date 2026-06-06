/**
 * 🗂️ CustomerDossier — memória de relacionamento (Camada 3)
 *
 * Monta um "dossiê" compacto do cliente para o prompt, de modo que a IA soe
 * pessoal e contínua ("ele lembra de mim"): nome, estágio, interesses e fatos
 * que o próprio cliente disse (necessidades, preferências, orçamento).
 *
 * Decisão de arquitetura: é STATELESS — deriva tudo do histórico AO VIVO
 * (recentMessages) + do profile que o ConversationMemory já mantém. Não cria
 * tabela nem persistência nova (zero risco de migração/schema). Como o histórico
 * ao vivo é relido a cada sugestão, os fatos ficam sempre atualizados.
 *
 * À prova de falha: retorna null se não houver nada útil.
 */

'use strict';

const cap = (s) => String(s || '').trim().replace(/^\w/, (c) => c.toUpperCase());
const clip = (s, n) => { const t = String(s || '').trim().replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// "meu nome é X", "me chamo X", "sou o/a X", "aqui é o/a X", "pode me chamar de X"
const NAME_PATTERNS = [
  /\bmeu nome (?:é|eh|e)\s+([a-zà-ú]{2,}(?:\s+[a-zà-ú]{2,})?)/i,
  /\bme chamo\s+([a-zà-ú]{2,}(?:\s+[a-zà-ú]{2,})?)/i,
  /\b(?:aqui (?:é|eh|e)|aqui quem fala (?:é|eh|e))\s+(?:o|a)?\s*([a-zà-ú]{2,})/i,
  /\bpode me chamar de\s+([a-zà-ú]{2,})/i,
  /\b(?:sou o|sou a)\s+([a-zà-ú]{2,})\b/i,
];

// Necessidades/preferências explícitas ditas pelo cliente.
const FACT_PATTERNS = [
  /\b(?:eu )?(?:quero|queria|preciso|procuro|gostaria de|tô querendo|to querendo|tenho interesse em|tô atrás de|to atras de)\s+([^.!?\n]{3,80})/i,
  /\b(?:meu or[çc]amento (?:é|eh|e)|posso (?:gastar|investir)(?: at[ée])?)\s+([^.!?\n]{2,40})/i,
  /\b(?:prefiro|gosto de|costumo)\s+([^.!?\n]{3,60})/i,
  /\b(?:é pra|e pra|seria pra|para (?:o meu|minha|meu))\s+([^.!?\n]{3,60})/i,
];

// Nomes que são, na verdade, saudações/ruído — evita "Sou o cliente", etc.
const NAME_STOPWORDS = new Set(['cliente', 'gerente', 'dono', 'responsavel', 'responsável', 'que', 'um', 'uma', 'seu', 'sua']);

class CustomerDossier {
  /**
   * @param {Object} profile - conversationContext.profile (pode ser undefined)
   * @param {Array<{role,content}>} recentMessages - histórico ao vivo
   * @param {Object} opts - { clientStage }
   * @returns {{ name, stage, tags, facts:string[] } | null}
   */
  build(profile = {}, recentMessages = [], opts = {}) {
    try {
      const clientMsgs = (Array.isArray(recentMessages) ? recentMessages : [])
        .filter((m) => m && m.role === 'user' && typeof m.content === 'string')
        .map((m) => m.content);

      const dossier = {
        name: this._extractName(clientMsgs),
        stage: opts.clientStage || profile?.stage || null,
        tags: Array.isArray(profile?.topicsDiscussed) ? profile.topicsDiscussed.slice(-4) : [],
        facts: this._extractFacts(clientMsgs),
      };

      const hasSomething = dossier.name || dossier.facts.length > 0 ||
        (dossier.tags && dossier.tags.length > 0);
      return hasSomething ? dossier : null;
    } catch (_) {
      return null;
    }
  }

  _extractName(clientMsgs) {
    for (const msg of clientMsgs) {
      for (const re of NAME_PATTERNS) {
        const m = re.exec(msg);
        if (m && m[1]) {
          const first = m[1].trim().split(/\s+/)[0];
          if (first && first.length >= 2 && !NAME_STOPWORDS.has(first.toLowerCase())) {
            return m[1].trim().split(/\s+/).slice(0, 2).map(cap).join(' ');
          }
        }
      }
    }
    return null;
  }

  _extractFacts(clientMsgs) {
    const facts = [];
    const seen = new Set();
    // Mais recentes primeiro (fatos atuais pesam mais).
    for (const msg of [...clientMsgs].reverse()) {
      for (const re of FACT_PATTERNS) {
        const m = re.exec(msg);
        if (m && m[1]) {
          const fact = clip(m[1], 80);
          const key = fact.toLowerCase();
          if (fact.length >= 3 && !seen.has(key)) {
            seen.add(key);
            facts.push(fact);
          }
        }
      }
      if (facts.length >= 4) break;
    }
    return facts.slice(0, 4);
  }
}

module.exports = CustomerDossier;
