/**
 * 🎨 AI System UI Handlers - Sidepanel
 * WhatsHybrid v7.6.0
 * 
 * Handlers para as novas UIs de:
 * - Knowledge Base (treinamento)
 * - Confidence System (copilot mode)
 * - Training Stats
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const WHL_DEBUG = (typeof localStorage !== 'undefined' && localStorage.getItem('whl_debug') === 'true');
  let statsInterval = null;

  // Sanitização centralizada (fallback local caso o util não esteja carregado)
  const escapeHtml = window.WHLHtmlUtils?.escapeHtml || function (str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  if (WHL_DEBUG) console.log('[AI UI Handlers] Carregando...');

  // ============================================
  // KNOWLEDGE BASE UI
  // ============================================

  // Salvar Informações do Negócio
  document.getElementById('kb_save_business')?.addEventListener('click', async () => {
    const business = {
      name: document.getElementById('kb_business_name').value,
      description: document.getElementById('kb_business_description').value,
      segment: document.getElementById('kb_business_segment').value,
      hours: document.getElementById('kb_business_hours').value
    };

    if (window.knowledgeBase) {
      await window.knowledgeBase.updateBusiness(business);
      alert('✅ Informações do negócio salvas!');
    }
  });

  // Salvar Políticas
  document.getElementById('kb_save_policies')?.addEventListener('click', async () => {
    const policies = {
      payment: document.getElementById('kb_policy_payment').value,
      delivery: document.getElementById('kb_policy_delivery').value,
      returns: document.getElementById('kb_policy_returns').value
    };

    if (window.knowledgeBase) {
      await window.knowledgeBase.updatePolicies(policies);
      alert('✅ Políticas salvas!');
    }
  });

  // Salvar Tom de Voz
  document.getElementById('kb_save_tone')?.addEventListener('click', async () => {
    const tone = {
      style: document.getElementById('kb_tone_style').value,
      useEmojis: document.getElementById('kb_tone_emojis').checked,
      greeting: document.getElementById('kb_tone_greeting').value,
      closing: document.getElementById('kb_tone_closing').value
    };

    if (window.knowledgeBase) {
      await window.knowledgeBase.updateTone(tone);
      alert('✅ Tom de voz salvo!');
    }
  });

  // Adicionar FAQ
  document.getElementById('kb_add_btn')?.addEventListener('click', async () => {
    const question = document.getElementById('kb_question').value;
    const answer = document.getElementById('kb_answer').value;

    if (!question || !answer) {
      alert('❌ Preencha pergunta e resposta');
      return;
    }

    if (window.knowledgeBase) {
      await window.knowledgeBase.addFAQ(question, answer);
      document.getElementById('kb_question').value = '';
      document.getElementById('kb_answer').value = '';
      
      if (window.confidenceSystem) {
        await window.confidenceSystem.recordFAQAdded();
      }
      
      loadFAQs();
      updateStats();
      alert('✅ FAQ adicionada!');
    }
  });

  // Adicionar Resposta Rápida
  document.getElementById('kb_add_canned')?.addEventListener('click', async () => {
    const triggersText = document.getElementById('kb_canned_triggers').value;
    const reply = document.getElementById('kb_canned_reply').value;

    if (!triggersText || !reply) {
      alert('❌ Preencha palavras-chave e resposta');
      return;
    }

    const triggers = triggersText.split(',').map(t => t.trim()).filter(t => t);

    if (window.knowledgeBase) {
      await window.knowledgeBase.addCannedReply(triggers, reply);
      document.getElementById('kb_canned_triggers').value = '';
      document.getElementById('kb_canned_reply').value = '';
      loadCannedReplies();
      alert('✅ Resposta rápida adicionada!');
    }
  });

  // Importar CSV de Produtos
  document.getElementById('kb_import_csv')?.addEventListener('click', () => {
    document.getElementById('kb_products_csv').click();
  });

  document.getElementById('kb_products_csv')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvText = event.target.result;
      
      if (window.knowledgeBase) {
        const products = window.knowledgeBase.parseProductsCSV(csvText);
        
        if (products.length > 0) {
          window.knowledgeBase.knowledge.products = products;
          await window.knowledgeBase.save();
          
          if (window.confidenceSystem) {
            for (let i = 0; i < products.length; i++) {
              await window.confidenceSystem.recordProductAdded();
            }
          }
          
          loadProducts();
          updateStats();
          alert(`✅ ${products.length} produtos importados!`);
        } else {
          alert('❌ Nenhum produto encontrado no CSV');
        }
      }
    };
    reader.readAsText(file);
  });

  // Adicionar Produto Manual
  document.getElementById('kb_add_product_manual')?.addEventListener('click', () => {
    const name = prompt('Nome do produto:');
    if (!name) return;

    const price = parseFloat(prompt('Preço (opcional):') || '0');
    const stock = parseInt(prompt('Estoque (opcional):') || '0');
    const description = prompt('Descrição (opcional):') || '';

    if (window.knowledgeBase) {
      window.knowledgeBase.addProduct({ name, price, stock, description });
      
      if (window.confidenceSystem) {
        window.confidenceSystem.recordProductAdded();
      }
      
      loadProducts();
      updateStats();
    }
  });

  // Exportar JSON
  document.getElementById('kb_export')?.addEventListener('click', () => {
    if (window.knowledgeBase) {
      const json = window.knowledgeBase.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `knowledge-base-${Date.now()}.json`;
      a.click();
    }
  });

  // Importar JSON
  document.getElementById('kb_import')?.addEventListener('click', () => {
    document.getElementById('kb_import_file').click();
  });

  document.getElementById('kb_import_file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const json = event.target.result;
      
      if (window.knowledgeBase) {
        const success = await window.knowledgeBase.importJSON(json);
        if (success) {
          loadKnowledgeBase();
          alert('✅ Conhecimento importado!');
        } else {
          alert('❌ Erro ao importar JSON');
        }
      }
    };
    reader.readAsText(file);
  });

  // Testar IA
  document.getElementById('kb_test_ia')?.addEventListener('click', async () => {
    const question = prompt('Digite uma pergunta para testar:');
    if (!question) return;

    if (window.knowledgeBase) {
      // Testa busca de FAQ
      const faqMatch = window.knowledgeBase.findFAQMatch(question);
      if (faqMatch) {
        alert(`📝 FAQ Encontrada:\n\nPergunta: ${faqMatch.question}\n\nResposta: ${faqMatch.answer}`);
        return;
      }

      // Testa resposta rápida
      const cannedMatch = window.knowledgeBase.checkCannedReply(question);
      if (cannedMatch) {
        alert(`⚡ Resposta Rápida:\n\n${cannedMatch.reply}`);
        return;
      }

      // Testa produto
      const productMatch = window.knowledgeBase.findProductMatch(question);
      if (productMatch) {
        alert(`📦 Produto Encontrado:\n\n${productMatch.name}\nPreço: R$ ${productMatch.price}\nEstoque: ${productMatch.stock}`);
        return;
      }

      alert('❓ Nenhuma correspondência encontrada. Adicione mais conteúdo à base de conhecimento.');
    }
  });

  // Limpar Tudo
  document.getElementById('kb_clear')?.addEventListener('click', async () => {
    if (!confirm('⚠️ Tem certeza? Isso irá apagar TODA a base de conhecimento!')) return;

    if (window.knowledgeBase) {
      await window.knowledgeBase.clear();
      loadKnowledgeBase();
      alert('✅ Base de conhecimento limpa!');
    }
  });

  // ============================================
  // CONFIDENCE SYSTEM UI
  // ============================================

  // Toggle Copilot Mode
  document.getElementById('copilot_auto_enabled')?.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    
    if (window.confidenceSystem) {
      await window.confidenceSystem.toggleCopilot(enabled);
      console.log('[AI UI] Copilot mode:', enabled);
    }
  });

  // Threshold Slider
  document.getElementById('copilot_threshold_slider')?.addEventListener('input', (e) => {
    const value = e.target.value;
    document.getElementById('copilot_threshold_value').textContent = value;
  });

  document.getElementById('copilot_threshold_slider')?.addEventListener('change', async (e) => {
    const value = parseInt(e.target.value);
    
    if (window.confidenceSystem) {
      await window.confidenceSystem.setThreshold(value);
      console.log('[AI UI] Threshold atualizado:', value);
    }
  });

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  function loadKnowledgeBase() {
    if (!window.knowledgeBase) return;

    const kb = window.knowledgeBase.knowledge;

    // Negócio
    document.getElementById('kb_business_name').value = kb.business.name || '';
    document.getElementById('kb_business_description').value = kb.business.description || '';
    document.getElementById('kb_business_segment').value = kb.business.segment || '';
    document.getElementById('kb_business_hours').value = kb.business.hours || '';

    // Políticas
    document.getElementById('kb_policy_payment').value = kb.policies.payment || '';
    document.getElementById('kb_policy_delivery').value = kb.policies.delivery || '';
    document.getElementById('kb_policy_returns').value = kb.policies.returns || '';

    // Tom de voz
    document.getElementById('kb_tone_style').value = kb.tone.style || 'professional';
    document.getElementById('kb_tone_emojis').checked = kb.tone.useEmojis !== false;
    document.getElementById('kb_tone_greeting').value = kb.tone.greeting || '';
    document.getElementById('kb_tone_closing').value = kb.tone.closing || '';

    loadFAQs();
    loadProducts();
    loadCannedReplies();
  }

  function loadFAQs() {
    if (!window.knowledgeBase) return;

    const faqs = window.knowledgeBase.knowledge.faq;
    const list = document.getElementById('kb_list');
    
    if (faqs.length === 0) {
      list.innerHTML = '<div class="sp-muted">Nenhuma FAQ cadastrada.</div>';
      return;
    }

    list.innerHTML = faqs.map(faq => `
      <div class="mod-card" style="padding: 12px; margin-bottom: 8px;">
        <div style="font-weight: 600; margin-bottom: 4px;">${escapeHtml(faq.question)}</div>
        <div style="font-size: 13px; color: var(--mod-text-muted);">${escapeHtml(faq.answer)}</div>
        <button class="mod-btn mod-btn-danger" onclick="removeFAQ(${faq.id})" style="margin-top: 8px; padding: 4px 12px; font-size: 11px;">🗑️ Remover</button>
      </div>
    `).join('');
  }

  window.removeFAQ = async function(id) {
    if (window.knowledgeBase) {
      await window.knowledgeBase.removeFAQ(id);
      loadFAQs();
      updateStats();
    }
  };

  function loadProducts() {
    if (!window.knowledgeBase) return;

    const products = window.knowledgeBase.knowledge.products;
    const list = document.getElementById('kb_products_list');
    
    if (products.length === 0) {
      list.innerHTML = '<div class="sp-muted">Nenhum produto cadastrado.</div>';
    } else {
      list.innerHTML = products.slice(0, 10).map(product => `
        <div class="mod-card" style="padding: 8px; margin-bottom: 6px; font-size: 12px;">
          <div style="font-weight: 600;">${escapeHtml(product.name)}</div>
          <div style="color: var(--mod-text-muted); font-size: 11px;">
            ${product.price > 0 ? `R$ ${product.price.toFixed(2)}` : ''} 
            ${product.stock !== undefined ? ` • Estoque: ${product.stock}` : ''}
          </div>
        </div>
      `).join('');
      
      if (products.length > 10) {
        list.innerHTML += `<div class="sp-muted" style="font-size: 11px; margin-top: 8px;">E mais ${products.length - 10} produtos...</div>`;
      }
    }

    document.getElementById('kb_products_count').textContent = products.length;
    document.getElementById('kb_products_count_stat').textContent = products.length;
  }

  function loadCannedReplies() {
    if (!window.knowledgeBase) return;

    const replies = window.knowledgeBase.knowledge.cannedReplies;
    const list = document.getElementById('kb_canned_list');
    
    if (replies.length === 0) {
      list.innerHTML = '<div class="sp-muted">Nenhuma resposta rápida cadastrada.</div>';
      return;
    }

    list.innerHTML = replies.map(reply => `
      <div class="mod-card" style="padding: 12px; margin-bottom: 8px;">
        <div style="font-size: 11px; color: var(--mod-text-muted); margin-bottom: 4px;">
          🔑 ${reply.triggers.map(t => escapeHtml(t)).join(', ')}
        </div>
        <div style="font-size: 13px;">${escapeHtml(reply.reply)}</div>
        <button class="mod-btn mod-btn-danger" onclick="removeCannedReply(${reply.id})" style="margin-top: 8px; padding: 4px 12px; font-size: 11px;">🗑️ Remover</button>
      </div>
    `).join('');
  }

  window.removeCannedReply = async function(id) {
    if (window.knowledgeBase) {
      await window.knowledgeBase.removeCannedReply(id);
      loadCannedReplies();
    }
  };

  function updateConfidenceUI() {
    if (!window.confidenceSystem) return;

    const level = window.confidenceSystem.getConfidenceLevel();
    const score = window.confidenceSystem.score;
    const metrics = window.confidenceSystem.metrics;
    const nextLevel = window.confidenceSystem.getPointsToNextLevel();

    // Atualiza card de nível
    document.getElementById('confidence_emoji').textContent = level.emoji;
    document.getElementById('confidence_label').textContent = level.label;
    document.getElementById('confidence_description').textContent = level.description;
    document.getElementById('confidence_score').textContent = `${Math.round(score)}%`;

    // Atualiza barra de progresso
    const threshold = window.confidenceSystem.threshold;
    const progress = Math.min((score / threshold) * 100, 100);
    document.getElementById('confidence_progress_bar').style.width = `${progress}%`;
    document.getElementById('confidence_progress_text').textContent = `${Math.round(score)} / ${threshold}`;
    document.getElementById('confidence_next_level').textContent = nextLevel.message;

    // Atualiza toggle
    document.getElementById('copilot_auto_enabled').checked = window.confidenceSystem.copilotEnabled;
    
    // Atualiza threshold
    document.getElementById('copilot_threshold_slider').value = threshold;
    document.getElementById('copilot_threshold_value').textContent = threshold;

    // Atualiza estatísticas de feedback
    document.getElementById('confidence_feedback_good').textContent = metrics.feedbackGood;
    document.getElementById('confidence_feedback_bad').textContent = metrics.feedbackBad;
    document.getElementById('confidence_corrections').textContent = metrics.feedbackCorrections;
  }

  function updateStats() {
    if (window.trainingStats) {
      window.trainingStats.updateUI();
    }

    if (window.knowledgeBase) {
      const stats = window.knowledgeBase.getStats();
      document.getElementById('kb_faqs_count').textContent = stats.faqs;
      document.getElementById('kb_products_count_stat').textContent = stats.products;
    }

    if (window.fewShotLearning) {
      const stats = window.fewShotLearning.getStats();
      document.getElementById('kb_examples_count').textContent = stats.totalExamples;
    }

    updateConfidenceUI();
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  // Carrega dados quando a página carregar
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      loadKnowledgeBase();
      updateStats();
      console.log('[AI UI Handlers] ✅ Inicializado');
    }, 1000);
  });

  // Atualiza stats periodicamente
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(updateStats, 5000);

  // Escuta eventos do sistema
  if (window.EventBus) {
    window.EventBus.on('confidence:level-changed', updateConfidenceUI);
    window.EventBus.on('confidence:feedback', updateStats);
    window.EventBus.on('training-stats:updated', updateStats);
    window.EventBus.on('knowledge-base:updated', () => {
      loadKnowledgeBase();
      updateStats();
    });

    // Indicadores visuais quando backend de IA falhar (evita "fallback silencioso")
    window.EventBus.on('ai:backend:error', (data) => {
      const msg = data?.message ? `IA indisponível: ${data.message}` : 'IA indisponível (backend)';
      if (window.NotificationsModule?.warning) {
        window.NotificationsModule.warning(`⚠️ ${msg}`);
      }
    });

    window.EventBus.on('copilot:backend:error', (data) => {
      const msg = data?.message ? `Copilot indisponível: ${data.message}` : 'Copilot indisponível (backend)';
      if (window.NotificationsModule?.warning) {
        window.NotificationsModule.warning(`⚠️ ${msg}`);
      }
    });

    window.EventBus.on('copilot:context:failed', () => {
      if (window.NotificationsModule?.warning) {
        window.NotificationsModule.warning('⚠️ Não foi possível ler o histórico do chat (sem contexto).');
      }
    });
  }

  window.addEventListener('beforeunload', () => {
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }
  });

  // ── btnOpenTrainingFullscreen ──────────────────────────────────────────────
  // Abre o treinamento de IA em nova aba ao clicar no botão da aba Knowledge
  document.getElementById('btnOpenTrainingFullscreen')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      action: 'WHL_OPEN_POPUP_TAB',
      url: 'training/training.html'
    }).catch(() => {
      // Fallback direto se o background não responder
      const url = chrome.runtime.getURL('training/training.html');
      window.open(url, '_blank');
    });
  });

})();
