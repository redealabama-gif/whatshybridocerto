/**
 * 🎯 Trust System - Sistema de Confiança e Níveis de IA
 *
 * Sistema de gamificação que evolui a IA conforme o uso e feedback do usuário.
 *
 * Níveis:
 * - 🔴 Iniciante (0-69 pontos) - IA sugere respostas básicas
 * - 🟡 Aprendiz (70-199 pontos) - IA sugere respostas intermediárias
 * - 🟢 Copiloto (200-499 pontos) - Respostas automáticas quando confiante
 * - 🔵 Expert (500+ pontos) - IA totalmente autônoma
 *
 * Formas de ganhar pontos:
 * - Usar sugestão da IA: +5 pontos
 * - Feedback positivo: +10 pontos
 * - Editar e usar sugestão: +3 pontos
 * - IA responde automaticamente com sucesso: +15 pontos
 * - Conversa resolvida com sucesso: +20 pontos
 *
 * @version 1.0.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_trust_system_v1';

  // SECURITY FIX P0-035: Prevent Prototype Pollution from storage
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return {};

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key) && !dangerousKeys.includes(key)) {
        const value = obj[key];
        // Recursively sanitize nested objects
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          sanitized[key] = sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  }

  // Definição de níveis
  const LEVELS = {
    BEGINNER: {
      id: 'beginner',
      name: 'Iniciante',
      icon: '🔴',
      minPoints: 0,
      maxPoints: 69,
      description: 'IA apenas sugere respostas básicas',
      color: '#ef4444',
      features: {
        autoResponse: false,
        suggestions: true,
        maxSuggestions: 1,
        confidenceThreshold: 0.8
      }
    },
    LEARNER: {
      id: 'learner',
      name: 'Aprendiz',
      icon: '🟡',
      minPoints: 70,
      maxPoints: 199,
      description: 'IA sugere respostas intermediárias',
      color: '#f59e0b',
      features: {
        autoResponse: false,
        suggestions: true,
        maxSuggestions: 2,
        confidenceThreshold: 0.7
      }
    },
    COPILOT: {
      id: 'copilot',
      name: 'Copiloto',
      icon: '🟢',
      minPoints: 200,
      maxPoints: 499,
      description: 'Respostas automáticas quando confiante',
      color: '#10b981',
      features: {
        autoResponse: true,
        suggestions: true,
        maxSuggestions: 3,
        confidenceThreshold: 0.6
      }
    },
    EXPERT: {
      id: 'expert',
      name: 'Expert',
      icon: '🔵',
      minPoints: 500,
      maxPoints: Infinity,
      description: 'IA totalmente autônoma e confiável',
      color: '#3b82f6',
      features: {
        autoResponse: true,
        suggestions: true,
        maxSuggestions: 3,
        confidenceThreshold: 0.5
      }
    }
  };

  // Ações que geram pontos
  const POINT_ACTIONS = {
    USE_SUGGESTION: 5,
    POSITIVE_FEEDBACK: 10,
    EDIT_AND_USE: 3,
    AUTO_RESPONSE_SUCCESS: 15,
    CONVERSATION_RESOLVED: 20,
    NEGATIVE_FEEDBACK: -5,
    IGNORE_SUGGESTION: 0
  };

  // Estado do sistema
  let state = {
    totalPoints: 0,
    currentLevel: 'beginner',
    history: [],
    statistics: {
      suggestionsUsed: 0,
      suggestionsIgnored: 0,
      autoResponsesSuccess: 0,
      autoResponsesFailed: 0,
      conversationsResolved: 0,
      positiveFeedback: 0,
      negativeFeedback: 0
    },
    achievements: [],
    initialized: false
  };

  // Conquistas
  const ACHIEVEMENTS = {
    FIRST_SUGGESTION: { id: 'first_suggestion', name: 'Primeira Sugestão', icon: '🎯', points: 0, description: 'Use sua primeira sugestão' },
    LEVEL_UP: { id: 'level_up', name: 'Evoluindo', icon: '📈', points: 10, description: 'Alcance um novo nível' },
    COPILOT_REACHED: { id: 'copilot', name: 'Modo Copiloto', icon: '🤖', points: 50, description: 'Alcance o nível Copiloto' },
    EXPERT_REACHED: { id: 'expert', name: 'Especialista', icon: '🏆', points: 100, description: 'Alcance o nível Expert' },
    FEEDBACK_MASTER: { id: 'feedback_master', name: 'Mestre do Feedback', icon: '⭐', points: 25, description: 'Dê 50 feedbacks positivos' },
    AUTO_MASTER: { id: 'auto_master', name: 'Piloto Automático', icon: '✈️', points: 30, description: '100 respostas automáticas bem-sucedidas' }
  };

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  async function init() {
    if (state.initialized) return;

    console.log('[TrustSystem] 🎯 Inicializando Sistema de Confiança...');

    await loadState();
    updateCurrentLevel();

    // Integrar com outros módulos
    setupEventListeners();

    state.initialized = true;
    console.log('[TrustSystem] ✅ Inicializado - Nível:', state.currentLevel, 'Pontos:', state.totalPoints);

    // Emitir evento de inicialização
    if (window.EventBus) {
      window.EventBus.emit('trustsystem:initialized', {
        level: state.currentLevel,
        points: state.totalPoints
      });
    }
  }

  // ============================================================
  // PERSISTÊNCIA
  // ============================================================

  async function loadState() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        // SECURITY FIX P0-035: Sanitize before spreading to prevent Prototype Pollution
        const sanitized = sanitizeObject(result[STORAGE_KEY]);
        state = { ...state, ...sanitized };
        console.log('[TrustSystem] Estado carregado:', state.totalPoints, 'pontos');
      }
    } catch (e) {
      console.error('[TrustSystem] Erro ao carregar estado:', e);
    }
  }

  async function saveState() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    } catch (e) {
      console.error('[TrustSystem] Erro ao salvar estado:', e);
    }
  }

  // ============================================================
  // SISTEMA DE PONTOS
  // ============================================================

  function addPoints(action, customAmount = null) {
    const points = customAmount !== null ? customAmount : POINT_ACTIONS[action];
    if (points === undefined) return;

    const oldPoints = state.totalPoints;
    const oldLevel = state.currentLevel;

    state.totalPoints = Math.max(0, state.totalPoints + points);

    // Registrar no histórico
    state.history.push({
      action,
      points,
      timestamp: Date.now(),
      totalPoints: state.totalPoints
    });

    // Manter apenas últimas 100 ações
    if (state.history.length > 100) {
      state.history = state.history.slice(-100);
    }

    // Atualizar nível
    updateCurrentLevel();

    // Verificar se subiu de nível
    if (state.currentLevel !== oldLevel) {
      onLevelUp(oldLevel, state.currentLevel);
    }

    // Salvar
    saveState();

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('trustsystem:points_added', {
        action,
        points,
        totalPoints: state.totalPoints,
        level: state.currentLevel
      });
    }

    console.log(`[TrustSystem] +${points} pontos (${action}) - Total: ${state.totalPoints}`);

    return state.totalPoints;
  }

  function updateCurrentLevel() {
    const points = state.totalPoints;

    for (const [key, level] of Object.entries(LEVELS)) {
      if (points >= level.minPoints && points <= level.maxPoints) {
        state.currentLevel = level.id;
        return level;
      }
    }

    return LEVELS.BEGINNER;
  }

  function getCurrentLevel() {
    return LEVELS[state.currentLevel.toUpperCase()] || LEVELS.BEGINNER;
  }

  function getNextLevel() {
    const current = getCurrentLevel();
    const levelOrder = ['BEGINNER', 'LEARNER', 'COPILOT', 'EXPERT'];
    const currentIndex = levelOrder.indexOf(current.id.toUpperCase());

    if (currentIndex < levelOrder.length - 1) {
      return LEVELS[levelOrder[currentIndex + 1]];
    }

    return null; // Já está no nível máximo
  }

  function getProgress() {
    const current = getCurrentLevel();
    const points = state.totalPoints;

    const pointsInLevel = points - current.minPoints;
    const levelRange = current.maxPoints - current.minPoints;
    const percentage = Math.min(100, (pointsInLevel / levelRange) * 100);

    return {
      current: current,
      next: getNextLevel(),
      points: state.totalPoints,
      pointsInLevel: pointsInLevel,
      pointsToNext: current.maxPoints - points + 1,
      percentage: Math.round(percentage),
      levelRange: levelRange
    };
  }

  // ============================================================
  // EVENTOS DE NÍVEL
  // ============================================================

  function onLevelUp(oldLevel, newLevel) {
    console.log(`[TrustSystem] 🎉 LEVEL UP! ${oldLevel} → ${newLevel}`);

    // Adicionar conquista
    unlockAchievement('LEVEL_UP');

    if (newLevel === 'copilot') {
      unlockAchievement('COPILOT_REACHED');
    } else if (newLevel === 'expert') {
      unlockAchievement('EXPERT_REACHED');
    }

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('trustsystem:level_up', {
        oldLevel,
        newLevel,
        points: state.totalPoints
      });
    }

    // Notificar usuário
    if (window.NotificationsModule) {
      const level = LEVELS[newLevel.toUpperCase()];
      window.NotificationsModule.success(
        `${level.icon} Nível ${level.name} alcançado!`,
        { duration: 5000 }
      );
    }
  }

  // ============================================================
  // CONQUISTAS
  // ============================================================

  function unlockAchievement(achievementId) {
    if (state.achievements.includes(achievementId)) return false;

    const achievement = ACHIEVEMENTS[achievementId];
    if (!achievement) return false;

    state.achievements.push(achievementId);

    // Adicionar pontos bônus
    if (achievement.points > 0) {
      addPoints('ACHIEVEMENT', achievement.points);
    }

    saveState();

    console.log(`[TrustSystem] 🏆 Conquista desbloqueada: ${achievement.name}`);

    // Notificar
    if (window.NotificationsModule) {
      window.NotificationsModule.toast(
        `🏆 ${achievement.name} - ${achievement.description}`,
        'success',
        4000
      );
    }

    return true;
  }

  function checkAchievements() {
    const stats = state.statistics;

    // Feedback Master
    if (stats.positiveFeedback >= 50) {
      unlockAchievement('FEEDBACK_MASTER');
    }

    // Auto Master
    if (stats.autoResponsesSuccess >= 100) {
      unlockAchievement('AUTO_MASTER');
    }
  }

  // ============================================================
  // INTEGRAÇÃO COM OUTROS MÓDULOS
  // ============================================================

  function setupEventListeners() {
    if (!window.EventBus) return;

    // Quando sugestão é usada
    window.EventBus.on('suggestion:used', (data) => {
      state.statistics.suggestionsUsed++;
      addPoints('USE_SUGGESTION');

      if (state.statistics.suggestionsUsed === 1) {
        unlockAchievement('FIRST_SUGGESTION');
      }
    });

    // Quando sugestão é editada e usada
    window.EventBus.on('suggestion:edited_and_used', () => {
      state.statistics.suggestionsUsed++;
      addPoints('EDIT_AND_USE');
    });

    // Quando sugestão é ignorada
    window.EventBus.on('suggestion:ignored', () => {
      state.statistics.suggestionsIgnored++;
      addPoints('IGNORE_SUGGESTION');
    });

    // Feedback positivo
    window.EventBus.on('suggestion:feedback_positive', () => {
      state.statistics.positiveFeedback++;
      addPoints('POSITIVE_FEEDBACK');
      checkAchievements();
    });

    // Feedback negativo
    window.EventBus.on('suggestion:feedback_negative', () => {
      state.statistics.negativeFeedback++;
      addPoints('NEGATIVE_FEEDBACK');
    });

    // Resposta automática bem-sucedida
    window.EventBus.on('auto_response:success', () => {
      state.statistics.autoResponsesSuccess++;
      addPoints('AUTO_RESPONSE_SUCCESS');
      checkAchievements();
    });

    // Resposta automática falhou
    window.EventBus.on('auto_response:failed', () => {
      state.statistics.autoResponsesFailed++;
    });

    // Conversa resolvida
    window.EventBus.on('conversation:resolved', () => {
      state.statistics.conversationsResolved++;
      addPoints('CONVERSATION_RESOLVED');
    });
  }

  // ============================================================
  // UI - RENDERIZAÇÃO
  // ============================================================

  function renderTrustWidget(container) {
    const progress = getProgress();
    const current = progress.current;
    const next = progress.next;

    container.innerHTML = `
      <div class="trust-widget">
        <div class="trust-header">
          <span class="trust-icon">${current.icon}</span>
          <div class="trust-info">
            <div class="trust-level">${current.name}</div>
            <div class="trust-description">${current.description}</div>
          </div>
        </div>

        <div class="trust-progress-container">
          <div class="trust-progress-bar">
            <div class="trust-progress-fill" style="width: ${progress.percentage}%; background: ${current.color}"></div>
          </div>
          <div class="trust-progress-text">
            <span>${progress.percentage}% Progresso</span>
            <span>${progress.points} / ${current.maxPoints}</span>
          </div>
        </div>

        ${next ? `
          <div class="trust-next-level">
            <span>Faltam <strong>${progress.pointsToNext}</strong> pontos para <strong>${next.icon} ${next.name}</strong></span>
          </div>
        ` : `
          <div class="trust-max-level">
            🏆 Nível máximo alcançado!
          </div>
        `}

        <div class="trust-features">
          <div class="trust-feature">
            ${current.features.autoResponse ? '✅' : '🔒'} Respostas Automáticas
          </div>
          <div class="trust-feature">
            ✅ ${current.features.maxSuggestions} Sugestão(ões)
          </div>
        </div>
      </div>
    `;

    // Adicionar estilos
    if (!document.getElementById('trust-system-styles')) {
      const styles = document.createElement('style');
      styles.id = 'trust-system-styles';
      styles.textContent = `
        .trust-widget {
          background: rgba(26, 26, 46, 0.95);
          border-radius: 12px;
          padding: 16px;
          color: white;
        }

        .trust-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }

        .trust-icon {
          font-size: 32px;
        }

        .trust-info {
          flex: 1;
        }

        .trust-level {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 4px;
        }

        .trust-description {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.7);
        }

        .trust-progress-container {
          margin-bottom: 12px;
        }

        .trust-progress-bar {
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 8px;
        }

        .trust-progress-fill {
          height: 100%;
          transition: width 0.3s ease, background 0.3s ease;
          border-radius: 4px;
        }

        .trust-progress-text {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.6);
        }

        .trust-next-level {
          background: rgba(139, 92, 246, 0.2);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 12px;
          margin-bottom: 12px;
          text-align: center;
        }

        .trust-max-level {
          background: linear-gradient(135deg, #f59e0b, #d97706);
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 12px;
          margin-bottom: 12px;
          text-align: center;
          font-weight: 600;
        }

        .trust-features {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .trust-feature {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.8);
          padding: 6px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
        }
      `;
      document.head.appendChild(styles);
    }
  }

  function renderStatistics(container) {
    const stats = state.statistics;
    const totalActions = stats.suggestionsUsed + stats.suggestionsIgnored;
    const successRate = totalActions > 0 ? Math.round((stats.suggestionsUsed / totalActions) * 100) : 0;

    container.innerHTML = `
      <div class="trust-stats">
        <h3>📊 Estatísticas</h3>

        <div class="stat-row">
          <span>Sugestões Usadas</span>
          <strong>${stats.suggestionsUsed}</strong>
        </div>

        <div class="stat-row">
          <span>Sugestões Ignoradas</span>
          <strong>${stats.suggestionsIgnored}</strong>
        </div>

        <div class="stat-row">
          <span>Taxa de Sucesso</span>
          <strong>${successRate}%</strong>
        </div>

        <div class="stat-row">
          <span>Respostas Automáticas</span>
          <strong>${stats.autoResponsesSuccess}</strong>
        </div>

        <div class="stat-row">
          <span>Conversas Resolvidas</span>
          <strong>${stats.conversationsResolved}</strong>
        </div>

        <div class="stat-row">
          <span>Feedbacks Positivos</span>
          <strong>${stats.positiveFeedback}</strong>
        </div>
      </div>
    `;
  }

  // ============================================================
  // API PÚBLICA
  // ============================================================

  window.TrustSystem = {
    init,
    addPoints,
    getCurrentLevel,
    getNextLevel,
    getProgress,
    getTotalPoints: () => state.totalPoints,
    getStatistics: () => ({ ...state.statistics }),
    getAchievements: () => [...state.achievements],
    unlockAchievement,
    renderTrustWidget,
    renderStatistics,
    LEVELS,
    POINT_ACTIONS,
    ACHIEVEMENTS
  };

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
  } else {
    setTimeout(init, 500);
  }

})();
