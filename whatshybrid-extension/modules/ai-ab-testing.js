/**
 * AI A/B Testing Module - Thompson Sampling for response variants
 * @module ai-ab-testing
 */

(function() {
  'use strict';

  /**
   * Thompson Sampling A/B Tester for response variants
   */
  class ResponseABTester {
    constructor() {
      this.experiments = new Map();
    }

    /**
     * Create a new A/B test experiment
     * @param {string} experimentId - Unique experiment identifier
     * @param {Array<string>} variants - Array of variant names
     * @param {Object} config - Experiment configuration
     * @returns {Object} Created experiment
     */
    createExperiment(experimentId, variants, config = {}) {
      if (this.experiments.has(experimentId)) {
        throw new Error(`Experiment ${experimentId} already exists`);
      }

      const experiment = {
        id: experimentId,
        variants: variants.map(name => ({
          name,
          alpha: 1,
          beta: 1,
          samples: 0,
          successRate: 0
        })),
        config: {
          minSamples: config.minSamples || 100,
          confidenceThreshold: config.confidenceThreshold || 0.95,
          ...config
        },
        createdAt: new Date(),
        status: 'active'
      };

      this.experiments.set(experimentId, experiment);
      console.log(`[ABTester] Created experiment: ${experimentId}`);
      return experiment;
    }

    /**
     * Select a variant using Thompson Sampling
     * @param {string} experimentId - Experiment identifier
     * @returns {string} Selected variant name
     */
    selectVariant(experimentId) {
      const experiment = this.experiments.get(experimentId);
      if (!experiment || experiment.status !== 'active') {
        throw new Error(`Experiment ${experimentId} not found or inactive`);
      }

      const samples = experiment.variants.map(variant => ({
        name: variant.name,
        sample: this._sampleBeta(variant.alpha, variant.beta)
      }));

      const selected = samples.reduce((max, curr) => 
        curr.sample > max.sample ? curr : max
      );

      return selected.name;
    }

    /**
     * Record result for a variant
     * @param {string} experimentId - Experiment identifier
     * @param {string} variantName - Variant that was shown
     * @param {boolean} success - Whether the variant succeeded
     * @returns {Object} Updated variant stats
     */
    recordResult(experimentId, variantName, success) {
      const experiment = this.experiments.get(experimentId);
      if (!experiment) {
        throw new Error(`Experiment ${experimentId} not found`);
      }

      const variant = experiment.variants.find(v => v.name === variantName);
      if (!variant) {
        throw new Error(`Variant ${variantName} not found`);
      }

      if (success) {
        variant.alpha += 1;
      } else {
        variant.beta += 1;
      }

      variant.samples += 1;
      variant.successRate = (variant.alpha - 1) / variant.samples;

      return {
        variant: variantName,
        samples: variant.samples,
        successRate: variant.successRate
      };
    }

    /**
     * Get experiment statistics
     * @param {string} experimentId - Experiment identifier
     * @returns {Object} Experiment statistics
     */
    getExperimentStats(experimentId) {
      const experiment = this.experiments.get(experimentId);
      if (!experiment) {
        throw new Error(`Experiment ${experimentId} not found`);
      }

      const totalSamples = experiment.variants.reduce((sum, v) => sum + v.samples, 0);
      
      const stats = experiment.variants.map(variant => ({
        name: variant.name,
        samples: variant.samples,
        successRate: variant.successRate,
        alpha: variant.alpha,
        beta: variant.beta,
        credibleInterval: this._credibleInterval(variant.alpha, variant.beta)
      }));

      stats.sort((a, b) => b.successRate - a.successRate);

      return {
        experimentId,
        status: experiment.status,
        totalSamples,
        variants: stats,
        winner: totalSamples >= experiment.config.minSamples ? stats[0].name : null,
        createdAt: experiment.createdAt
      };
    }

    /**
     * Conclude an experiment
     * @param {string} experimentId - Experiment identifier
     * @returns {Object} Final experiment results
     */
    concludeExperiment(experimentId) {
      const experiment = this.experiments.get(experimentId);
      if (!experiment) {
        throw new Error(`Experiment ${experimentId} not found`);
      }

      experiment.status = 'concluded';
      experiment.concludedAt = new Date();

      const stats = this.getExperimentStats(experimentId);
      console.log(`[ABTester] Concluded experiment ${experimentId}, winner: ${stats.winner}`);
      
      return stats;
    }

    _sampleBeta(alpha, beta) {
      const gammaA = this._sampleGamma(alpha, 1);
      const gammaB = this._sampleGamma(beta, 1);
      return gammaA / (gammaA + gammaB);
    }

    _sampleGamma(shape, scale) {
      if (shape < 1) {
        return this._sampleGamma(shape + 1, scale) * Math.pow(Math.random(), 1 / shape);
      }

      const d = shape - 1 / 3;
      const c = 1 / Math.sqrt(9 * d);

      while (true) {
        let x, v;
        do {
          x = this._normalRandom();
          v = 1 + c * x;
        } while (v <= 0);

        v = v * v * v;
        const u = Math.random();
        
        if (u < 1 - 0.0331 * x * x * x * x) {
          return d * v * scale;
        }
        
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
          return d * v * scale;
        }
      }
    }

    _normalRandom() {
      const u1 = Math.random();
      const u2 = Math.random();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    _credibleInterval(alpha, beta) {
      const mean = alpha / (alpha + beta);
      const variance = (alpha * beta) / ((alpha + beta) * (alpha + beta) * (alpha + beta + 1));
      const stdDev = Math.sqrt(variance);
      
      return {
        lower: Math.max(0, mean - 1.96 * stdDev),
        upper: Math.min(1, mean + 1.96 * stdDev)
      };
    }
  }

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ResponseABTester;
  } else {
    window.ResponseABTester = ResponseABTester;
  }
})();
