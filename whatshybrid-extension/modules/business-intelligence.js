/**
 * BusinessIntelligence - Analytics, insights e detecção inteligente
 * Paridade com CERTO-WHATSAPPLITE
 */
class BusinessIntelligence {
  constructor() {
    this.insights = [];
    this.conversions = [];
    this.reports = new Map();
    
    // Keywords para detecção
    this.buyingIntentKeywords = {
      high: ['comprar', 'quero', 'vou levar', 'fechado', 'pode enviar', 'aceito', 'pago agora', 'manda o pix', 'quero esse'],
      medium: ['preço', 'valor', 'quanto custa', 'orçamento', 'parcela', 'desconto', 'promoção', 'tem disponível', 'como pago'],
      low: ['interessado', 'queria saber', 'informação', 'como funciona', 'entrega', 'prazo', 'frete']
    };
    
    this.painPointKeywords = {
      critical: ['não funciona', 'quebrou', 'defeito', 'procon', 'advogado', 'nunca mais', 'processo', 'reclame aqui'],
      high: ['problema', 'erro', 'demora', 'insatisfeito', 'péssimo', 'horrível', 'absurdo', 'descaso'],
      medium: ['reclamação', 'atraso', 'não gostei', 'decepcionado', 'esperava mais'],
      low: ['dúvida', 'não entendi', 'confuso', 'difícil']
    };
    
    this.upsellTriggers = {
      premium: ['melhor', 'qualidade', 'profissional', 'completo', 'top'],
      quantity: ['mais', 'quantidade', 'atacado', 'revenda', 'kit'],
      accessories: ['acessório', 'complemento', 'junto', 'combina'],
      warranty: ['garantia', 'proteção', 'seguro', 'durar']
    };
  }

  async initialize() {
    await this.loadData();
    console.log('[BI] ✅ Business Intelligence inicializado');
  }

  async init() {
    await this.initialize();
  }

  // ============================================================
  // DETECÇÃO DE INTENÇÃO DE COMPRA
  // ============================================================
  
  detectBuyingIntent(text, context = {}) {
    if (!text) return { hasBuyingIntent: false, score: 0, level: 'none', suggestion: null };
    
    const lowerText = text.toLowerCase();
    let score = 0;
    const matches = [];
    
    // Verificar keywords por nível
    for (const keyword of this.buyingIntentKeywords.high) {
      if (lowerText.includes(keyword)) {
        score += 30;
        matches.push({ keyword, weight: 'high' });
      }
    }
    
    for (const keyword of this.buyingIntentKeywords.medium) {
      if (lowerText.includes(keyword)) {
        score += 15;
        matches.push({ keyword, weight: 'medium' });
      }
    }
    
    for (const keyword of this.buyingIntentKeywords.low) {
      if (lowerText.includes(keyword)) {
        score += 5;
        matches.push({ keyword, weight: 'low' });
      }
    }
    
    // Sinais contextuais
    if (lowerText.match(/pix|cartão|boleto|transferência/)) score += 25;
    if (lowerText.match(/endereço|cep|entrega/)) score += 20;
    if (lowerText.match(/\d+/)) score += 5;
    if (context.isRecurringCustomer) score += 15;
    
    // Determinar nível
    let level = 'none';
    if (score >= 70) level = 'hot';
    else if (score >= 50) level = 'warm';
    else if (score >= 30) level = 'interested';
    else if (score >= 10) level = 'curious';
    
    // Gerar sugestão
    let suggestion = null;
    if (level === 'hot') {
      suggestion = '🔥 LEAD QUENTE! Feche a venda agora. Ofereça condição especial.';
    } else if (level === 'warm') {
      suggestion = '📈 Cliente aquecido! Apresente benefícios e facilidades de pagamento.';
    } else if (level === 'interested') {
      suggestion = '💡 Interesse detectado. Forneça mais detalhes proativamente.';
    }
    
    if (score >= 30) {
      this.addInsight('buying_intent', { score, level, matches });
    }
    
    return {
      hasBuyingIntent: score >= 30,
      score: Math.min(100, score),
      level,
      matches,
      suggestion
    };
  }

  // ============================================================
  // DETECÇÃO DE PAIN POINTS
  // ============================================================
  
  identifyPainPoints(text) {
    if (!text) return { hasPainPoints: false, painPoints: [], severity: 'none', suggestion: null, escalate: false };
    
    const lowerText = text.toLowerCase();
    const painPoints = [];
    let severityScore = 0;
    
    for (const keyword of this.painPointKeywords.critical) {
      if (lowerText.includes(keyword)) {
        painPoints.push({ keyword, severity: 'critical' });
        severityScore += 40;
      }
    }
    
    for (const keyword of this.painPointKeywords.high) {
      if (lowerText.includes(keyword)) {
        painPoints.push({ keyword, severity: 'high' });
        severityScore += 25;
      }
    }
    
    for (const keyword of this.painPointKeywords.medium) {
      if (lowerText.includes(keyword)) {
        painPoints.push({ keyword, severity: 'medium' });
        severityScore += 15;
      }
    }
    
    for (const keyword of this.painPointKeywords.low) {
      if (lowerText.includes(keyword)) {
        painPoints.push({ keyword, severity: 'low' });
        severityScore += 5;
      }
    }
    
    // Sinais adicionais
    if (lowerText.match(/!{2,}/)) severityScore += 10;
    if (lowerText === lowerText.toUpperCase() && lowerText.length > 20) severityScore += 15;
    
    let severity = 'none';
    if (severityScore >= 60) severity = 'critical';
    else if (severityScore >= 40) severity = 'high';
    else if (severityScore >= 20) severity = 'medium';
    else if (severityScore > 0) severity = 'low';
    
    let suggestion = null;
    let escalate = false;
    
    if (severity === 'critical') {
      suggestion = '🚨 CRÍTICO! Escalonar imediatamente. Prioridade máxima!';
      escalate = true;
    } else if (severity === 'high') {
      suggestion = '⚠️ URGENTE! Cliente muito insatisfeito. Ofereça solução imediata.';
      escalate = true;
    } else if (severity === 'medium') {
      suggestion = '📋 Problema detectado. Resolva antes de tentar vender.';
    }
    
    if (painPoints.length > 0) {
      this.addInsight('pain_point', { severity, painPoints, escalate });
    }
    
    return { hasPainPoints: painPoints.length > 0, painPoints, severity, severityScore, suggestion, escalate };
  }

  // ============================================================
  // SUGESTÃO DE UPSELL
  // ============================================================
  
  suggestUpsell(context = {}) {
    const suggestions = [];
    const text = (context.lastMessage || '').toLowerCase();
    
    for (const trigger of this.upsellTriggers.premium) {
      if (text.includes(trigger)) {
        suggestions.push({
          type: 'premium',
          priority: 'high',
          message: '💎 Cliente busca qualidade! Ofereça versão premium.',
          script: '"Temos uma versão premium com benefícios extras. O investimento é X% maior, mas você ganha..."'
        });
        break;
      }
    }
    
    for (const trigger of this.upsellTriggers.quantity) {
      if (text.includes(trigger)) {
        suggestions.push({
          type: 'quantity',
          priority: 'high',
          message: '📦 Interesse em quantidade! Ofereça pacotes ou descontos progressivos.',
          script: '"Para quantidades maiores, temos condições especiais: 3 unidades com 10% off, 5+ com 20% off."'
        });
        break;
      }
    }
    
    for (const trigger of this.upsellTriggers.accessories) {
      if (text.includes(trigger)) {
        suggestions.push({
          type: 'cross_sell',
          priority: 'medium',
          message: '🎁 Oportunidade de cross-sell! Sugira produtos complementares.',
          script: '"Clientes que levaram esse produto também adoraram [acessório]. Quer que eu inclua?"'
        });
        break;
      }
    }
    
    for (const trigger of this.upsellTriggers.warranty) {
      if (text.includes(trigger)) {
        suggestions.push({
          type: 'warranty',
          priority: 'medium',
          message: '🛡️ Cliente preocupado com durabilidade! Ofereça garantia estendida.',
          script: '"Oferecemos garantia estendida por apenas R$ [valor]. Tranquilidade total!"'
        });
        break;
      }
    }
    
    if (context.isRecurringCustomer) {
      suggestions.push({
        type: 'loyalty',
        priority: 'high',
        message: '🌟 Cliente recorrente! Ofereça programa de fidelidade.',
        script: '"Como você é cliente especial, preparei uma condição exclusiva..."'
      });
    }
    
    return {
      hasUpsellOpportunity: suggestions.length > 0,
      suggestions: suggestions.sort((a, b) => a.priority === 'high' ? -1 : 1),
      topSuggestion: suggestions[0] || null
    };
  }

  // ============================================================
  // RELATÓRIOS
  // ============================================================
  
  generateReport(period = 'week') {
    const periodMs = { day: 86400000, week: 604800000, month: 2592000000 }[period] || 604800000;
    const since = Date.now() - periodMs;
    const periodInsights = this.insights.filter(i => i.timestamp >= since);
    
    const buyingIntents = periodInsights.filter(i => i.type === 'buying_intent');
    const painPoints = periodInsights.filter(i => i.type === 'pain_point');
    
    const report = {
      id: `report_${Date.now()}`,
      period,
      generatedAt: Date.now(),
      metrics: {
        totalInteractions: periodInsights.length,
        buyingIntentsDetected: buyingIntents.length,
        hotLeads: buyingIntents.filter(i => i.data.level === 'hot').length,
        warmLeads: buyingIntents.filter(i => i.data.level === 'warm').length,
        painPointsDetected: painPoints.length,
        criticalIssues: painPoints.filter(i => i.data.severity === 'critical').length,
        escalations: painPoints.filter(i => i.data.escalate).length
      },
      recommendations: this.generateRecommendations(buyingIntents, painPoints)
    };
    
    this.reports.set(report.id, report);
    this.saveData();
    return report;
  }
  
  generateRecommendations(buyingIntents, painPoints) {
    const recommendations = [];
    
    const hotRate = buyingIntents.filter(i => i.data.level === 'hot').length / (buyingIntents.length || 1);
    if (hotRate < 0.1) {
      recommendations.push({
        priority: 'high',
        message: '📉 Poucos leads quentes. Revise a qualificação e melhore as ofertas.'
      });
    }
    
    const criticalRate = painPoints.filter(i => i.data.severity === 'critical').length / (painPoints.length || 1);
    if (criticalRate > 0.2) {
      recommendations.push({
        priority: 'urgent',
        message: '🚨 Alto índice de problemas críticos! Revise processos e qualidade.'
      });
    }
    
    if (buyingIntents.length > painPoints.length * 3) {
      recommendations.push({
        priority: 'medium',
        message: '🚀 Boa taxa de interesse! Momento ideal para escalar marketing.'
      });
    }
    
    return recommendations;
  }

  // ============================================================
  // CONVERSÕES
  // ============================================================
  
  trackConversion(data) {
    const conversion = {
      id: `conv_${Date.now()}`,
      timestamp: Date.now(),
      phone: data.phone,
      value: data.value || 0,
      product: data.product || '',
      source: data.source || 'chat'
    };
    
    this.conversions.push(conversion);
    this.addInsight('conversion', conversion);
    this.saveData();
    return conversion;
  }
  
  getConversionInsights(period = 'week') {
    const periodMs = { day: 86400000, week: 604800000, month: 2592000000 }[period] || 604800000;
    const since = Date.now() - periodMs;
    const recentConversions = this.conversions.filter(c => c.timestamp >= since);
    const totalValue = recentConversions.reduce((sum, c) => sum + (c.value || 0), 0);
    
    return {
      totalConversions: recentConversions.length,
      totalValue,
      avgTicket: recentConversions.length > 0 ? totalValue / recentConversions.length : 0
    };
  }

  // ============================================================
  // INSIGHTS E PERSISTÊNCIA
  // ============================================================
  
  addInsight(type, data) {
    this.insights.push({
      id: `insight_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type,
      data,
      timestamp: Date.now()
    });
    if (this.insights.length > 1000) this.insights = this.insights.slice(-500);
  }
  
  getInsights(filter = {}) {
    let insights = [...this.insights];
    if (filter.type) insights = insights.filter(i => i.type === filter.type);
    if (filter.since) insights = insights.filter(i => i.timestamp >= filter.since);
    return insights.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  async saveData() {
    await chrome.storage.local.set({
      bi_insights: this.insights.slice(-500),
      bi_conversions: this.conversions.slice(-500),
      bi_reports: Object.fromEntries(this.reports)
    });
  }
  
  async loadData() {
    return new Promise(r => {
      chrome.storage.local.get(['bi_insights', 'bi_conversions', 'bi_reports'], res => {
        if (res.bi_insights) this.insights = res.bi_insights;
        if (res.bi_conversions) this.conversions = res.bi_conversions;
        if (res.bi_reports) this.reports = new Map(Object.entries(res.bi_reports));
        r();
      });
    });
  }
}

window.BusinessIntelligence = new BusinessIntelligence();
