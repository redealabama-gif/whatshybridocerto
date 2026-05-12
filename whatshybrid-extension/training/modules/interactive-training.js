/**
 * 💬 WhatsHybrid - Interactive Training
 * Chat interativo para treinamento de IA com suporte a áudio
 * @version 7.9.13
 */
(function() {
  'use strict';

  class InteractiveTraining {
    constructor(options = {}) {
      this.container = null;
      this.voiceRecorder = null;
      this.stt = null;
      this.conversation = [];
      this.isRecording = false;
      this.isProcessing = false;
      this.language = options.language || 'pt-BR';
      this.onExampleAdded = options.onExampleAdded || null;
      this.validationIndex = -1;
      this.stats = { messages: 0, validated: 0, examples: 0 };
    }

    async init(containerId) {
      this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
      if (!this.container) throw new Error('Container não encontrado');

      if (window.WHLVoiceRecorder?.isSupported()) {
        this.voiceRecorder = new window.WHLVoiceRecorder({
          maxDuration: 60000,
          onStop: (r) => this._onRecordingStop(r),
          onDurationUpdate: (d) => this._updateTimer(d),
          onError: (e) => this._toast('Erro: ' + e.message, 'error')
        });
      }

      if (window.WHLSpeechToText) {
        this.stt = new window.WHLSpeechToText({
          language: this.language,
          onProgress: (p) => this._showStatus(p.message)
        });
      }

      this._render();
      await this._loadConversation();
    }

    _render() {
      const t = window.t || (k => k.split('.').pop());
      this.container.innerHTML = `
        <div class="wit-container">
          <div class="wit-header">
            <h2>🎓 ${t('training.interactiveTitle') || 'Treinamento Interativo'}</h2>
            <p>${t('training.interactiveDesc') || 'Converse com a IA via texto ou áudio'}</p>
            <select id="wit-lang" class="wit-select">
              ${(window.WHLSpeechToText?.getLanguages() || []).map(l => 
                `<option value="${l.code}" ${l.code === this.language ? 'selected' : ''}>${l.flag} ${l.name}</option>`
              ).join('')}
            </select>
          </div>
          <div class="wit-messages" id="wit-messages"></div>
          <div class="wit-status" id="wit-status" style="display:none"><div class="wit-spinner"></div><span id="wit-status-text"></span></div>
          <div class="wit-validation" id="wit-validation" style="display:none">
            <h4>Validar Resposta</h4>
            <div class="wit-val-q" id="wit-val-q"></div>
            <div class="wit-val-a" id="wit-val-a"></div>
            <div class="wit-val-btns">
              <button id="wit-val-good" class="wit-btn wit-btn-success">✓ Boa</button>
              <button id="wit-val-edit" class="wit-btn wit-btn-warn">✏️ Editar</button>
              <button id="wit-val-bad" class="wit-btn wit-btn-danger">✗ Ruim</button>
            </div>
            <div id="wit-edit-area" style="display:none">
              <textarea id="wit-edit-text" class="wit-textarea"></textarea>
              <button id="wit-edit-save" class="wit-btn wit-btn-primary">Salvar</button>
            </div>
          </div>
          <div class="wit-input">
            <textarea id="wit-text" class="wit-textarea" placeholder="Digite ou use o microfone..." rows="2"></textarea>
            <div class="wit-controls">
              <button id="wit-mic" class="wit-mic-btn" ${!this.voiceRecorder ? 'disabled' : ''}>
                <span class="wit-mic-icon">🎤</span>
                <span class="wit-rec-time" id="wit-rec-time" style="display:none">00:00</span>
              </button>
              <button id="wit-send" class="wit-send-btn">➤</button>
            </div>
          </div>
          <div class="wit-stats">
            <div><span id="wit-stat-msg">${this.stats.messages}</span> msgs</div>
            <div><span id="wit-stat-val">${this.stats.validated}</span> validadas</div>
            <div><span id="wit-stat-ex">${this.stats.examples}</span> exemplos</div>
          </div>
        </div>
      `;
      this._injectStyles();
      this._setupEvents();

      // Hardening: treinamento por voz só fica ativo se recorder + STT estiverem disponíveis
      const micBtn = document.getElementById('wit-mic');
      const langSel = document.getElementById('wit-lang');
      const hasVoice = !!this.voiceRecorder;
      const hasStt = !!this.stt;

      if (langSel) {
        langSel.disabled = !hasStt;
        if (!hasStt) langSel.style.opacity = '0.6';
      }

      if (micBtn) {
        const enabled = hasVoice && hasStt;
        micBtn.disabled = !enabled;
        if (!enabled) {
          micBtn.title = !hasVoice
            ? 'Microfone não suportado neste navegador'
            : 'Speech-to-Text não carregado/configurado';
        }
      }
    }

    _setupEvents() {
      document.getElementById('wit-text')?.addEventListener('keypress', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); }
      });
      document.getElementById('wit-send')?.addEventListener('click', () => this._send());
      document.getElementById('wit-mic')?.addEventListener('click', () => this._toggleRecord());
      document.getElementById('wit-lang')?.addEventListener('change', e => {
        this.language = e.target.value;
        if (this.stt) this.stt.setLanguage(this.language);
      });
      document.getElementById('wit-val-good')?.addEventListener('click', () => this._validate(true));
      document.getElementById('wit-val-bad')?.addEventListener('click', () => this._validate(false));
      document.getElementById('wit-val-edit')?.addEventListener('click', () => {
        document.getElementById('wit-edit-text').value = this.conversation[this.validationIndex]?.content || '';
        document.getElementById('wit-edit-area').style.display = 'block';
      });
      document.getElementById('wit-edit-save')?.addEventListener('click', () => this._saveEdit());
      this.container.addEventListener('click', e => {
        if (e.target.closest('.wit-val-btn')) {
          this._showValidation(parseInt(e.target.closest('.wit-val-btn').dataset.idx));
        }
      });
    }

    async _send() {
      const textarea = document.getElementById('wit-text');
      const text = textarea?.value?.trim();
      if (!text || this.isProcessing) return;
      textarea.value = '';
      await this._processMessage(text);
    }

    async _processMessage(text, audioUrl = null) {
      this.isProcessing = true;
      this._addMessage('user', text, audioUrl);
      this._showTyping();

      try {
        const response = await this._generateResponse(text);
        this._hideTyping();
        this._addMessage('assistant', response);
        this.stats.messages += 2;
        this._updateStats();
        await this._saveConversation();
      } catch (e) {
        this._hideTyping();
        this._toast('Erro: ' + e.message, 'error');
      }
      this.isProcessing = false;
    }

    async _generateResponse(text) {
      const context = this.conversation.slice(-10).map(m => ({ role: m.role, content: m.content }));
      
      if (window.CopilotEngine?.generateResponse) {
        const r = await window.CopilotEngine.generateResponse({ messages: context, lastMessage: text });
        return r?.text || r?.content || r || this._fallback();
      }
      if (window.AIService?.complete) {
        // TrainingAIClient (ai-client.js) espera lastMessage para gerar resposta corretamente
        const r = await window.AIService.complete({ messages: context, lastMessage: text });
        return r?.text || r?.content || r || this._fallback();
      }
      return this._fallback();
    }

    _fallback() {
      const r = ['Entendi! Pode elaborar?', 'Interessante, me conte mais.', 'Certo, anotado!', 'Como posso ajudar?'];
      return r[Math.floor(Math.random() * r.length)];
    }

    _addMessage(role, content, audioUrl = null) {
      const msg = { role, content, timestamp: Date.now(), audioUrl };
      this.conversation.push(msg);
      this._renderMessages();
    }

    _renderMessages() {
      const el = document.getElementById('wit-messages');
      if (!el) return;
      if (this.conversation.length === 0) {
        el.innerHTML = '<div class="wit-empty">💬 Comece uma conversa!</div>';
        return;
      }
      el.innerHTML = this.conversation.map((m, i) => `
        <div class="wit-msg ${m.role === 'user' ? 'wit-msg-user' : 'wit-msg-ai'}">
          <div class="wit-msg-avatar">${m.role === 'user' ? '👤' : '🤖'}</div>
          <div class="wit-msg-content">
            <div class="wit-msg-text">${this._escape(m.content)}</div>
            ${m.audioUrl ? `<audio controls src="${m.audioUrl}" style="height:28px;max-width:200px"></audio>` : ''}
            <div class="wit-msg-meta">
              ${new Date(m.timestamp).toLocaleTimeString(this.language, {hour:'2-digit',minute:'2-digit'})}
              ${m.validated !== undefined ? `<span class="${m.validated ? 'wit-badge-ok' : 'wit-badge-bad'}">${m.validated ? '✓' : '✗'}</span>` : ''}
            </div>
          </div>
          ${m.role === 'assistant' && m.validated === undefined ? `<button class="wit-val-btn" data-idx="${i}">⚡</button>` : ''}
        </div>
      `).join('');
      el.scrollTop = el.scrollHeight;
    }

    async _toggleRecord() {
      if (!this.voiceRecorder) return;
      const btn = document.getElementById('wit-mic');
      const time = document.getElementById('wit-rec-time');
      
      if (this.isRecording) {
        this.voiceRecorder.stop();
        this.isRecording = false;
        btn?.classList.remove('recording');
        if (time) time.style.display = 'none';
      } else {
        const ok = await this.voiceRecorder.start();
        if (ok) {
          this.isRecording = true;
          btn?.classList.add('recording');
          if (time) { time.style.display = 'inline'; time.textContent = '00:00'; }
        }
      }
    }

    _updateTimer(ms) {
      const time = document.getElementById('wit-rec-time');
      if (time) {
        const s = Math.floor(ms / 1000);
        time.textContent = `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
      }
    }

    async _onRecordingStop(result) {
      document.getElementById('wit-mic')?.classList.remove('recording');
      document.getElementById('wit-rec-time').style.display = 'none';
      
      if (!result?.blob?.size) return this._toast('Gravação vazia', 'error');

      if (!this.stt || typeof this.stt.transcribe !== 'function') {
        return this._toast('Speech-to-Text indisponível. Verifique configuração/carregamento do módulo.', 'error');
      }
      
      this._showStatus('Transcrevendo...');
      try {
        const r = await this.stt.transcribe(result.blob, { language: this.language });
        this._hideStatus();
        if (!r.text) return this._toast('Não foi possível transcrever', 'error');
        await this._processMessage(r.text, result.url);
      } catch (e) {
        this._hideStatus();
        // v9.5.2: When the backend can't transcribe (e.g. OPENAI_API_KEY missing), offer Web Speech as a graceful fallback.
        const detail = e?.backendDetail || e?.message || '';
        const isOpenAIKeyMissing = /openai/i.test(detail) && /(key|chave)/i.test(detail);
        if ((isOpenAIKeyMissing || e?.status >= 500)
            && window.WHLSpeechToText
            && window.WHLSpeechToText.isWebSpeechAvailable
            && window.WHLSpeechToText.isWebSpeechAvailable()) {
          this._toast('Servidor indisponível. Tentando transcrição local (Web Speech)...', 'warning');
          this._showStatus('Aguardando fala (modo local)...');
          this.stt.transcribeLive({
            language: this.language,
            onResult: ({ final, isFinal }) => {
              if (isFinal && final) {
                this._hideStatus();
                this._processMessage(final, result.url);
              }
            },
            onError: (liveErr) => {
              this._hideStatus();
              this._toast('Web Speech: ' + liveErr.message, 'error');
            }
          });
          return;
        }
        this._toast('Erro: ' + e.message, 'error');
      }
    }

    _showValidation(idx) {
      const msg = this.conversation[idx];
      const prev = this.conversation[idx - 1];
      if (!msg || msg.role !== 'assistant') return;
      
      this.validationIndex = idx;
      document.getElementById('wit-val-q').textContent = prev?.content || '';
      document.getElementById('wit-val-a').textContent = msg.content;
      document.getElementById('wit-validation').style.display = 'block';
      document.getElementById('wit-edit-area').style.display = 'none';
    }

    async _validate(good) {
      const msg = this.conversation[this.validationIndex];
      const prev = this.conversation[this.validationIndex - 1];
      if (!msg) return;

      msg.validated = good;
      if (good) await this._addExample(prev?.content, msg.content);
      
      document.getElementById('wit-validation').style.display = 'none';
      this.stats.validated++;
      this._updateStats();
      this._renderMessages();
      await this._saveConversation();
    }

    async _saveEdit() {
      const text = document.getElementById('wit-edit-text')?.value?.trim();
      if (!text) return;
      
      const msg = this.conversation[this.validationIndex];
      const prev = this.conversation[this.validationIndex - 1];
      
      if (msg) {
        msg.content = text;
        msg.validated = true;
        msg.edited = true;
      }
      
      await this._addExample(prev?.content, text);
      document.getElementById('wit-validation').style.display = 'none';
      this.stats.validated++;
      this._updateStats();
      this._renderMessages();
      await this._saveConversation();
    }

    async _addExample(user, assistant) {
      if (!user || !assistant) return;
      const example = { id: Date.now().toString(), user, assistant, createdAt: Date.now(), source: 'voice_training' };
      
      if (window.fewShotLearning?.addExample) {
        await window.fewShotLearning.addExample(example);
      }
      
      await new Promise(r => {
        chrome.storage?.local.get(['whl_training_examples'], res => {
          const list = res.whl_training_examples || [];
          list.push(example);
          chrome.storage.local.set({ whl_training_examples: list.slice(-500) }, r);
        }) || r();
      });

      this.stats.examples++;
      this._updateStats();
      this._toast('Exemplo adicionado!', 'success');
      this.onExampleAdded?.(example);
    }

    _showTyping() {
      const el = document.getElementById('wit-messages');
      if (!el) return;
      const div = document.createElement('div');
      div.id = 'wit-typing';
      div.className = 'wit-msg wit-msg-ai';
      div.innerHTML = '<div class="wit-msg-avatar">🤖</div><div class="wit-typing"><span></span><span></span><span></span></div>';
      el.appendChild(div);
      el.scrollTop = el.scrollHeight;
    }

    _hideTyping() { document.getElementById('wit-typing')?.remove(); }

    _showStatus(text) {
      const el = document.getElementById('wit-status');
      const t = document.getElementById('wit-status-text');
      if (el) el.style.display = 'flex';
      if (t) t.textContent = text;
    }

    _hideStatus() {
      const el = document.getElementById('wit-status');
      if (el) el.style.display = 'none';
    }

    _updateStats() {
      document.getElementById('wit-stat-msg').textContent = this.stats.messages;
      document.getElementById('wit-stat-val').textContent = this.stats.validated;
      document.getElementById('wit-stat-ex').textContent = this.stats.examples;
    }

    async _saveConversation() {
      await new Promise(r => {
        chrome.storage?.local.set({ whl_voice_training_conv: this.conversation.slice(-50) }, r) || r();
      });
    }

    async _loadConversation() {
      await new Promise(r => {
        chrome.storage?.local.get(['whl_voice_training_conv', 'whl_training_examples'], res => {
          this.conversation = res.whl_voice_training_conv || [];
          this.stats.messages = this.conversation.length;
          this.stats.validated = this.conversation.filter(m => m.validated).length;
          this.stats.examples = (res.whl_training_examples || []).length;
          this._updateStats();
          this._renderMessages();
          r();
        }) || r();
      });
    }

    async clearConversation() {
      this.conversation = [];
      this.stats.messages = 0;
      this.stats.validated = 0;
      await this._saveConversation();
      this._updateStats();
      this._renderMessages();
    }

    _toast(msg, type = 'info') {
      window.WHLToast?.showToast?.(msg, type) || console.log(`[${type}]`, msg);
    }

    _escape(s) {
      if (!s) return '';
      return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    }

    _injectStyles() {
      if (document.getElementById('wit-styles')) return;
      const s = document.createElement('style');
      s.id = 'wit-styles';
      s.textContent = `
        .wit-container{display:flex;flex-direction:column;height:100%;background:#1F2937;border-radius:12px;overflow:hidden;font-family:system-ui,sans-serif}
        .wit-header{padding:16px;background:#374151;border-bottom:1px solid #4B5563}
        .wit-header h2{margin:0 0 4px;font-size:16px;color:#F3F4F6}
        .wit-header p{margin:0 0 10px;font-size:12px;color:#9CA3AF}
        .wit-select{padding:6px 10px;background:#1F2937;border:1px solid #4B5563;border-radius:6px;color:#F3F4F6;font-size:12px}
        .wit-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
        .wit-empty{text-align:center;color:#6B7280;padding:40px}
        .wit-msg{display:flex;gap:8px;max-width:85%}
        .wit-msg-user{align-self:flex-end;flex-direction:row-reverse}
        .wit-msg-ai{align-self:flex-start}
        .wit-msg-avatar{width:28px;height:28px;border-radius:50%;background:#374151;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
        .wit-msg-content{background:#374151;padding:8px 12px;border-radius:10px}
        .wit-msg-user .wit-msg-content{background:#3B82F6}
        .wit-msg-text{font-size:13px;color:#F3F4F6;line-height:1.4;white-space:pre-wrap}
        .wit-msg-meta{font-size:10px;color:#9CA3AF;margin-top:4px;display:flex;align-items:center;gap:6px}
        .wit-badge-ok{color:#10B981}.wit-badge-bad{color:#EF4444}
        .wit-val-btn{position:absolute;right:-6px;top:50%;transform:translateY(-50%);width:24px;height:24px;border-radius:50%;background:#3B82F6;border:none;color:#fff;cursor:pointer;font-size:10px;opacity:0;transition:opacity .2s}
        .wit-msg:hover .wit-val-btn{opacity:1}
        .wit-msg{position:relative}
        .wit-status{display:none;align-items:center;justify-content:center;gap:8px;padding:10px;background:#374151;color:#9CA3AF;font-size:12px}
        .wit-spinner{width:14px;height:14px;border:2px solid #4B5563;border-top-color:#3B82F6;border-radius:50%;animation:spin 1s linear infinite}
        .wit-validation{padding:14px;background:#374151;border-top:1px solid #4B5563}
        .wit-validation h4{margin:0 0 10px;font-size:13px;color:#F3F4F6}
        .wit-val-q,.wit-val-a{padding:8px;background:#1F2937;border-radius:6px;font-size:12px;color:#F3F4F6;margin-bottom:6px}
        .wit-val-q::before{content:'👤 '}.wit-val-a::before{content:'🤖 '}
        .wit-val-btns{display:flex;gap:6px;margin-top:10px}
        .wit-btn{padding:6px 12px;border:none;border-radius:6px;font-size:12px;cursor:pointer}
        .wit-btn-success{background:#10B981;color:#fff}
        .wit-btn-warn{background:#F59E0B;color:#fff}
        .wit-btn-danger{background:#EF4444;color:#fff}
        .wit-btn-primary{background:#3B82F6;color:#fff}
        .wit-input{padding:12px;background:#374151;border-top:1px solid #4B5563;display:flex;gap:10px;align-items:flex-end}
        .wit-textarea{flex:1;padding:8px 12px;background:#1F2937;border:1px solid #4B5563;border-radius:8px;color:#F3F4F6;font-size:13px;resize:none;font-family:inherit}
        .wit-textarea:focus{outline:none;border-color:#3B82F6}
        .wit-controls{display:flex;gap:6px}
        .wit-mic-btn,.wit-send-btn{width:38px;height:38px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center}
        .wit-mic-btn{background:#1F2937;color:#F3F4F6;font-size:16px}
        .wit-mic-btn:hover:not(:disabled){background:#4B5563}
        .wit-mic-btn.recording{background:#EF4444;animation:pulse 1.5s infinite}
        .wit-mic-btn:disabled{opacity:.5;cursor:not-allowed}
        .wit-mic-icon{display:block}.wit-mic-btn.recording .wit-mic-icon{display:none}
        .wit-rec-time{font-size:10px}
        .wit-send-btn{background:#3B82F6;color:#fff;font-size:14px}
        .wit-send-btn:hover{background:#2563EB}
        .wit-stats{display:flex;justify-content:space-around;padding:10px;background:#111827;font-size:11px;color:#9CA3AF}
        .wit-stats span{color:#3B82F6;font-weight:600}
        .wit-typing{display:flex;gap:4px;padding:4px}
        .wit-typing span{width:6px;height:6px;background:#9CA3AF;border-radius:50%;animation:typing 1.4s infinite ease-in-out both}
        .wit-typing span:nth-child(1){animation-delay:-.32s}
        .wit-typing span:nth-child(2){animation-delay:-.16s}
        @keyframes typing{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
      `;
      document.head.appendChild(s);
    }
  }

  window.WHLInteractiveTraining = InteractiveTraining;
})();
