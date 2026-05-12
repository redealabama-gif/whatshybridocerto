/**
 * Drip Campaign Service — v9.0.0
 *
 * Envia sequência de emails programada baseado em dias desde signup.
 * Roda dentro do billingCron diariamente.
 *
 * Sequência "trial":
 *   day 0: welcome (já enviado pelo signup)
 *   day 1: "Como configurar sua IA em 5 minutos"
 *   day 3: "Erros comuns e como evitar"
 *   day 5: "Veja como aumentar conversão em 30%"
 *   day 6: "Seu trial acaba amanhã — desconto de 20%"
 *   day 7: "Trial encerrou — manter acesso?"
 *
 * Sequência "engagement" (pós-pagamento):
 *   day 7: "Tirando mais da IA"
 *   day 30: "Suas métricas do mês"
 *   day 60: "Indique e ganhe tokens"
 */

const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const logger = require('../utils/logger');

const TRIAL_STEPS = [
  {
    day: 1,
    step: 'trial_day_1',
    subject: '🚀 Configure sua IA em 5 minutos',
    body: (user) => `
      <p>Olá ${escape(user.name)},</p>
      <p>Bem-vindo ao WhatsHybrid Pro. Pra tirar o máximo da plataforma, você
      precisa configurar a personalidade da sua IA — leva 5 minutos.</p>
      <p><strong>3 passos:</strong></p>
      <ol>
        <li>Defina o tom de voz (formal, casual, amigável)</li>
        <li>Cole sua FAQ na "Base de conhecimento"</li>
        <li>Teste com mensagens reais antes de ativar auto-resposta</li>
      </ol>
    `,
    cta: 'Configurar agora',
    ctaPath: '/dashboard.html#tab-ai',
  },
  {
    day: 3,
    step: 'trial_day_3',
    subject: '⚠️ 3 erros comuns que travam a IA',
    body: (user) => `
      <p>Olá ${escape(user.name)},</p>
      <p>Vimos que você ainda está testando. Pra evitar dor de cabeça:</p>
      <ol>
        <li><strong>Não deixe a Base de Conhecimento vazia</strong> — sem ela,
            a IA inventa respostas e clientes percebem.</li>
        <li><strong>Cuidado com o "auto-reply" antes de testar</strong> — sempre
            valide com 5-10 mensagens antes de ativar pra todos.</li>
        <li><strong>Limite de tokens</strong> — respostas curtas (250 tokens)
            economizam dinheiro e parecem mais humanas.</li>
      </ol>
    `,
    cta: 'Testar minha IA',
    ctaPath: '/dashboard.html#tab-ai',
  },
  {
    day: 5,
    step: 'trial_day_5',
    subject: '📈 Como uma loja aumentou conversão em 30%',
    body: (user) => `
      <p>Olá ${escape(user.name)},</p>
      <p>Caso real: uma loja de cosméticos (10 atendentes) ativou WhatsHybrid Pro.
      Resultado em 30 dias:</p>
      <ul>
        <li><strong>+30% conversão</strong> em mensagens fora do horário comercial</li>
        <li><strong>-65% tempo médio de primeira resposta</strong></li>
        <li><strong>+45% NPS</strong> (atendimento mais consistente)</li>
      </ul>
      <p>Quer um caso parecido pra sua área? Responda este email com seu nicho.</p>
    `,
    cta: 'Configurar',
    ctaPath: '/dashboard.html',
  },
  {
    day: 6,
    step: 'trial_day_6',
    subject: '⏰ Seu trial acaba amanhã — 20% off no primeiro mês',
    body: (user) => `
      <p>Olá ${escape(user.name)},</p>
      <p>Seu trial acaba amanhã. Pra continuar sem perder a configuração feita,
      ative agora seu plano com <strong>20% de desconto no primeiro mês</strong>:</p>
      <p>Use o código <strong>VOLTA20</strong> no checkout.</p>
      <p>Sem fidelidade. Cancela quando quiser.</p>
    `,
    cta: 'Assinar com desconto',
    ctaPath: '/dashboard.html#tab-billing',
  },
  {
    day: 7,
    step: 'trial_day_7',
    subject: '👋 Seu trial encerrou — manter o acesso?',
    body: (user) => `
      <p>Olá ${escape(user.name)},</p>
      <p>Seu trial gratuito encerrou. Sua conta foi pausada mas seus dados
      estão preservados por 30 dias.</p>
      <p>Pra reativar agora, escolha um plano:</p>
      <ul>
        <li><strong>Starter — R$ 97/mês:</strong> 100k tokens, 1 atendente</li>
        <li><strong>Pro — R$ 197/mês:</strong> 500k tokens, 5 atendentes</li>
        <li><strong>Business — R$ 397/mês:</strong> 1M tokens, 15 atendentes</li>
      </ul>
      <p>Qualquer dúvida, responde este email.</p>
    `,
    cta: 'Escolher plano',
    ctaPath: '/dashboard.html#tab-billing',
  },
];

const ENGAGEMENT_STEPS = [
  {
    day: 7,
    step: 'engagement_day_7',
    subject: '✨ Tirando mais da IA — dicas avançadas',
    body: (user) => `
      <p>Olá ${escape(user.name)},</p>
      <p>Já uma semana de WhatsHybrid Pro 🎉. Algumas dicas que clientes adoram:</p>
      <ul>
        <li>Use <strong>tags</strong> em contatos pra segmentar campanhas</li>
        <li>Configure <strong>respostas variadas</strong> (Variant A/B testing já está rodando)</li>
        <li>Veja a aba "Métricas" pra entender padrões dos seus clientes</li>
      </ul>
    `,
    cta: 'Explorar métricas',
    ctaPath: '/dashboard.html',
  },
  {
    day: 30,
    step: 'engagement_day_30',
    subject: '📊 Suas métricas do mês',
    body: (user, ctx) => `
      <p>Olá ${escape(user.name)},</p>
      <p>Resumo dos seus últimos 30 dias:</p>
      <ul>
        <li><strong>Mensagens processadas:</strong> ${ctx.messages || 0}</li>
        <li><strong>Tokens consumidos:</strong> ${ctx.tokens?.toLocaleString('pt-BR') || 0}</li>
        <li><strong>Taxa de resposta automática:</strong> ${ctx.autoReplyRate || 0}%</li>
      </ul>
      <p>Se quiser otimizar, dá uma olhada na aba "Tokens & Uso".</p>
    `,
    cta: 'Ver detalhes',
    ctaPath: '/dashboard.html#tab-tokens',
  },
  {
    day: 60,
    step: 'engagement_day_60',
    subject: '💸 Indique e ganhe 50.000 tokens grátis',
    body: (user) => `
      <p>Olá ${escape(user.name)},</p>
      <p>Já são 2 meses 🎉. Que tal indicar pra um amigo dono de empresa?</p>
      <p>Você ganha <strong>50.000 tokens (≈ R$ 100)</strong> quando ele virar cliente pagante.</p>
      <p>Sem limite de indicações.</p>
    `,
    cta: 'Pegar meu link de indicação',
    ctaPath: '/dashboard.html#referrals',
  },
];

function escape(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function daysSince(date) {
  const ms = Date.now() - new Date(date).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

async function processDripCampaigns() {
  const db = require('../utils/database');
  const emailService = require('./EmailService');
  const baseUrl = process.env.PUBLIC_BASE_URL || 'https://whatshybrid.com.br';

  let processed = 0, sent = 0, errors = 0;

  // ── Trial sequence ──
  try {
    const trialUsers = db.all(`
      SELECT u.id, u.email, u.name, u.created_at, w.subscription_status
      FROM users u
      JOIN workspaces w ON w.id = u.workspace_id
      WHERE w.subscription_status IN ('trialing', 'trial_expired', 'inactive')
        AND u.status = 'active'
        AND u.created_at >= datetime('now', '-15 days')
    `);

    for (const user of trialUsers) {
      const days = daysSince(user.created_at);
      const matchingStep = TRIAL_STEPS.find(s => s.day === days);
      if (!matchingStep) continue;

      // Verifica se já enviou
      const already = db.get(
        `SELECT id FROM email_drip_log WHERE user_id = ? AND step = ?`,
        [user.id, matchingStep.step]
      );
      if (already) continue;

      processed++;

      const html = emailService._wrap({
        title: matchingStep.subject.replace(/^[^\s]+\s/, ''),
        preheader: '',
        body: matchingStep.body(user),
        ctaLabel: matchingStep.cta,
        ctaUrl: baseUrl + matchingStep.ctaPath,
      });

      const result = await emailService.send({
        to: user.email, subject: matchingStep.subject, html,
      });

      if (result.sent) {
        sent++;
        db.run(
          `INSERT OR IGNORE INTO email_drip_log (id, user_id, campaign, step)
           VALUES (?, ?, 'trial', ?)`,
          [require('../utils/uuid-wrapper').v4(), user.id, matchingStep.step]
        );
      } else {
        errors++;
      }
    }
  } catch (err) {
    logger.error(`[DripCampaign] Trial error: ${err.message}`);
  }

  // ── Engagement sequence (pra paid users) ──
  try {
    const paidUsers = db.all(`
      SELECT u.id, u.email, u.name, w.id AS workspace_id,
             w.subscription_started_at AS paid_since
      FROM users u
      JOIN workspaces w ON w.id = u.workspace_id
      WHERE w.subscription_status = 'active'
        AND w.subscription_started_at IS NOT NULL
        AND u.status = 'active'
    `);

    for (const user of paidUsers) {
      if (!user.paid_since) continue;
      const days = daysSince(user.paid_since);
      const matchingStep = ENGAGEMENT_STEPS.find(s => s.day === days);
      if (!matchingStep) continue;

      const already = db.get(
        `SELECT id FROM email_drip_log WHERE user_id = ? AND step = ?`,
        [user.id, matchingStep.step]
      );
      if (already) continue;

      processed++;

      // Context para day 30 (métricas)
      let ctx = {};
      if (matchingStep.day === 30) {
        try {
          const m = db.get(
            `SELECT COUNT(*) AS c FROM ai_requests WHERE workspace_id = ? AND created_at >= datetime('now', '-30 days')`,
            [user.workspace_id]
          );
          ctx.messages = m?.c || 0;
          const t = db.get(
            `SELECT SUM(ABS(amount)) AS t FROM token_transactions
             WHERE workspace_id = ? AND type = 'consume' AND created_at >= datetime('now', '-30 days')`,
            [user.workspace_id]
          );
          ctx.tokens = t?.t || 0;
        } catch (_) {}
      }

      const html = emailService._wrap({
        title: matchingStep.subject.replace(/^[^\s]+\s/, ''),
        preheader: '',
        body: matchingStep.body(user, ctx),
        ctaLabel: matchingStep.cta,
        ctaUrl: baseUrl + matchingStep.ctaPath,
      });

      const result = await emailService.send({
        to: user.email, subject: matchingStep.subject, html,
      });

      if (result.sent) {
        sent++;
        db.run(
          `INSERT OR IGNORE INTO email_drip_log (id, user_id, campaign, step)
           VALUES (?, ?, 'engagement', ?)`,
          [require('../utils/uuid-wrapper').v4(), user.id, matchingStep.step]
        );
      } else {
        errors++;
      }
    }
  } catch (err) {
    logger.error(`[DripCampaign] Engagement error: ${err.message}`);
  }

  if (processed > 0) {
    logger.info(`[DripCampaign] Processed=${processed} sent=${sent} errors=${errors}`);
  }
  return { processed, sent, errors };
}

module.exports = { processDripCampaigns, TRIAL_STEPS, ENGAGEMENT_STEPS };
