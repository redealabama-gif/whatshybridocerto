/**
 * FeedbackAnalyzer
 * @file Extraído de SmartBotExtendedService.js (refactor v9)
 */


class FeedbackAnalyzer {
  constructor() {
    this.feedbacks = [];
    this.aggregates = {
      totalCount: 0, avgRating: 0,
      sentimentDistribution: { positive: 0, neutral: 0, negative: 0 },
      topIssues: [], topPraises: [], nps: 0
    };
    this.keywords = {
      positive: ['ótimo', 'excelente', 'perfeito', 'rápido', 'atencioso', 'resolveu', 'recomendo', 'parabéns'],
      negative: ['ruim', 'péssimo', 'demorou', 'não resolveu', 'problema', 'decepcionado', 'horrível'],
      issues: ['demora', 'erro', 'bug', 'lento', 'confuso', 'difícil', 'complicado'],
      praises: ['rápido', 'fácil', 'claro', 'eficiente', 'educado', 'prestativo']
    };
  }

  addFeedback(feedback) {
    const analysis = this._analyzeFeedback(feedback);
    const entry = {
      id: `fb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      rating: feedback.rating, text: feedback.text || '', source: feedback.source || 'direct',
      context: feedback.context || {}, analysis, createdAt: Date.now()
    };
    this.feedbacks.push(entry);
    this._updateAggregates(entry);
    return entry;
  }

  _analyzeFeedback(feedback) {
    const text = (feedback.text || '').toLowerCase();
    let sentimentScore = feedback.rating ? feedback.rating / 5 : 0.5;

    this.keywords.positive.forEach(kw => { if (text.includes(kw)) sentimentScore += 0.1; });
    this.keywords.negative.forEach(kw => { if (text.includes(kw)) sentimentScore -= 0.1; });
    sentimentScore = Math.max(0, Math.min(1, sentimentScore));

    const issues = this.keywords.issues.filter(kw => text.includes(kw));
    const praises = this.keywords.praises.filter(kw => text.includes(kw));
    const extractedKeywords = this._extractKeywords(text);

    let category = 'general';
    if (issues.length > praises.length) category = 'complaint';
    else if (praises.length > issues.length) category = 'praise';
    else if (text.includes('?')) category = 'question';
    else if (text.includes('sugestão') || text.includes('sugiro')) category = 'suggestion';

    return {
      sentiment: { score: sentimentScore, label: sentimentScore > 0.6 ? 'positive' : sentimentScore < 0.4 ? 'negative' : 'neutral' },
      issues, praises, keywords: extractedKeywords, category, wordCount: text.split(/\s+/).filter(w => w.length > 0).length
    };
  }

  _extractKeywords(text) {
    const stopwords = new Set(['a', 'o', 'e', 'de', 'da', 'do', 'em', 'um', 'uma', 'para', 'com', 'não', 'que', 'se', 'na', 'no', 'por', 'mais', 'as', 'os', 'como', 'mas', 'foi', 'ao', 'ele', 'das', 'tem', 'à', 'seu', 'sua', 'ou', 'ser', 'quando', 'muito', 'há', 'nos', 'já', 'está', 'eu', 'também', 'só', 'pelo', 'pela', 'até', 'isso', 'ela', 'entre', 'era', 'depois', 'sem', 'mesmo', 'aos', 'ter', 'seus', 'quem', 'nas', 'me', 'esse', 'eles', 'estão', 'você', 'tinha', 'foram', 'essa', 'num', 'nem', 'suas', 'meu', 'às', 'minha', 'têm', 'numa', 'pelos', 'elas', 'havia', 'seja', 'qual', 'será', 'nós', 'tenho', 'lhe', 'deles', 'essas', 'esses', 'pelas', 'este', 'fosse', 'dele']);
    const words = text.toLowerCase().replace(/[^\w\sáéíóúâêôãõç]/g, '').split(/\s+/).filter(w => w.length > 3 && !stopwords.has(w));
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([word, count]) => ({ word, count }));
  }

  _updateAggregates(entry) {
    this.aggregates.totalCount++;
    if (entry.rating) this.aggregates.avgRating = ((this.aggregates.avgRating * (this.aggregates.totalCount - 1) + entry.rating) / this.aggregates.totalCount);
    this.aggregates.sentimentDistribution[entry.analysis.sentiment.label]++;

    entry.analysis.issues.forEach(issue => {
      const existing = this.aggregates.topIssues.find(i => i.issue === issue);
      if (existing) existing.count++;
      else this.aggregates.topIssues.push({ issue, count: 1 });
    });
    this.aggregates.topIssues.sort((a, b) => b.count - a.count);
    this.aggregates.topIssues = this.aggregates.topIssues.slice(0, 10);

    entry.analysis.praises.forEach(praise => {
      const existing = this.aggregates.topPraises.find(p => p.praise === praise);
      if (existing) existing.count++;
      else this.aggregates.topPraises.push({ praise, count: 1 });
    });
    this.aggregates.topPraises.sort((a, b) => b.count - a.count);
    this.aggregates.topPraises = this.aggregates.topPraises.slice(0, 10);

    this._calculateNPS();
  }

  _calculateNPS() {
    const withRating = this.feedbacks.filter(f => f.rating !== undefined);
    if (withRating.length === 0) { this.aggregates.nps = 0; return; }
    const promoters = withRating.filter(f => f.rating >= 4.5).length;
    const detractors = withRating.filter(f => f.rating <= 2.5).length;
    this.aggregates.nps = Math.round(((promoters - detractors) / withRating.length) * 100);
  }

  getAnalysis() {
    return {
      ...this.aggregates,
      sentimentPercentages: {
        positive: this.aggregates.totalCount > 0 ? (this.aggregates.sentimentDistribution.positive / this.aggregates.totalCount * 100).toFixed(1) : 0,
        neutral: this.aggregates.totalCount > 0 ? (this.aggregates.sentimentDistribution.neutral / this.aggregates.totalCount * 100).toFixed(1) : 0,
        negative: this.aggregates.totalCount > 0 ? (this.aggregates.sentimentDistribution.negative / this.aggregates.totalCount * 100).toFixed(1) : 0
      }
    };
  }

  search(criteria = {}) {
    return this.feedbacks.filter(f => {
      if (criteria.minRating && f.rating < criteria.minRating) return false;
      if (criteria.maxRating && f.rating > criteria.maxRating) return false;
      if (criteria.sentiment && f.analysis.sentiment.label !== criteria.sentiment) return false;
      if (criteria.category && f.analysis.category !== criteria.category) return false;
      if (criteria.keyword && !f.text.toLowerCase().includes(criteria.keyword.toLowerCase())) return false;
      if (criteria.since && f.createdAt < criteria.since) return false;
      if (criteria.until && f.createdAt > criteria.until) return false;
      return true;
    });
  }

  getTrends(days = 7) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const recent = this.feedbacks.filter(f => f.createdAt >= cutoff);
    const byDay = {};
    recent.forEach(f => {
      const day = new Date(f.createdAt).toISOString().split('T')[0];
      if (!byDay[day]) byDay[day] = { count: 0, totalRating: 0, sentiments: { positive: 0, neutral: 0, negative: 0 } };
      byDay[day].count++;
      if (f.rating) byDay[day].totalRating += f.rating;
      byDay[day].sentiments[f.analysis.sentiment.label]++;
    });
    return Object.entries(byDay).map(([day, data]) => ({
      day, count: data.count, avgRating: data.totalRating / data.count || 0, sentiments: data.sentiments
    })).sort((a, b) => a.day.localeCompare(b.day));
  }

  generateReport() {
    const analysis = this.getAnalysis();
    const trends = this.getTrends(30);
    return {
      summary: { totalFeedbacks: analysis.totalCount, averageRating: analysis.avgRating.toFixed(2), nps: analysis.nps, sentimentDistribution: analysis.sentimentPercentages },
      issues: analysis.topIssues.slice(0, 5), praises: analysis.topPraises.slice(0, 5), trends, generatedAt: new Date().toISOString()
    };
  }

  reset() {
    this.feedbacks = [];
    this.aggregates = { totalCount: 0, avgRating: 0, sentimentDistribution: { positive: 0, neutral: 0, negative: 0 }, topIssues: [], topPraises: [], nps: 0 };
  }
}

// ============================================================
// SMARTBOT EXTENDED SERVICE - MAIN CLASS
// ============================================================

module.exports = FeedbackAnalyzer;
