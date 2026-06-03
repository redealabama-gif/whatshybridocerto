/**
 * WhatsHybrid TextToSpeechService v1.0.0
 * Serviço de síntese de voz para leitura de mensagens
 * 
 * Suporta:
 * - API nativa do navegador (Web Speech API)
 * - Azure Cognitive Services (opcional, para qualidade premium)
 * - Google Cloud Text-to-Speech (opcional)
 */
(function() {
  'use strict';

  // ============================================
  // CONFIGURAÇÃO
  // ============================================
  const CONFIG = {
    // Limites
    maxChars: 1000,
    
    // Velocidade padrão (0.5 a 2.0)
    defaultSpeed: 1.0,
    
    // Pitch padrão (0.5 a 2.0)
    defaultPitch: 1.0,
    
    // Volume padrão (0 a 1)
    defaultVolume: 1.0,
    
    // Idioma padrão
    defaultLang: 'pt-BR',
    
    // Provider padrão: 'browser', 'azure', 'google'
    defaultProvider: 'browser',
    
    // Vozes preferidas em português (em ordem de preferência)
    preferredVoices: [
      'Microsoft Francisca Online (Natural) - Portuguese (Brazil)',
      'Google português do Brasil',
      'Luciana',
      'pt-BR',
      'Portuguese'
    ],
    
    // Storage key para configurações
    storageKey: 'whl_tts_settings'
  };

  // ============================================
  // ESTADO
  // ============================================
  const state = {
    isPlaying: false,
    isPaused: false,
    currentUtterance: null,
    currentAudio: null,
    currentText: '',
    queue: [],
    voice: null,
    speed: CONFIG.defaultSpeed,
    pitch: CONFIG.defaultPitch,
    volume: CONFIG.defaultVolume,
    provider: CONFIG.defaultProvider,
    
    // Configurações de providers externos
    azureConfig: null,  // { key, region }
    googleConfig: null, // { apiKey }
    
    // Cache de vozes disponíveis
    availableVoices: [],
    
    // Estatísticas
    stats: {
      totalSpoken: 0,
      totalChars: 0,
      lastUsed: null
    }
  };

  // ============================================
  // SECURITY HELPERS
  // ============================================

  /**
   * SECURITY FIX P0-012: Sanitize objects to prevent Prototype Pollution
   * Recursively removes dangerous keys from untrusted objects
   */
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (dangerousKeys.includes(key)) {
          console.warn('[TTS Security] Blocked prototype pollution attempt:', key);
          continue;
        }

        if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          sanitized[key] = sanitizeObject(obj[key]);
        } else {
          sanitized[key] = obj[key];
        }
      }
    }

    return sanitized;
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  async function init() {
    console.log('[TTS] Inicializando...');

    // Carregar configurações salvas
    await loadSettings();

    // Carregar vozes disponíveis
    await loadVoices();

    // Selecionar melhor voz disponível
    selectBestVoice();

    console.log('[TTS] ✅ Inicializado -', state.availableVoices.length, 'vozes disponíveis');
  }

  async function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([CONFIG.storageKey], (result) => {
          if (result[CONFIG.storageKey]) {
            // SECURITY FIX P0-012: Sanitize all data from storage to prevent Prototype Pollution
            const saved = sanitizeObject(result[CONFIG.storageKey]);

            state.speed = saved.speed ?? CONFIG.defaultSpeed;
            state.pitch = saved.pitch ?? CONFIG.defaultPitch;
            state.volume = saved.volume ?? CONFIG.defaultVolume;
            state.provider = saved.provider ?? CONFIG.defaultProvider;

            // SECURITY NOTE P0-013: API keys stored in chrome.storage.local are NOT encrypted
            // RECOMMENDATION: Use chrome.storage.session (encrypted) or environment variables for production
            // Current implementation stores keys in plaintext - acceptable only for development/testing
            state.azureConfig = saved.azureConfig || null;
            state.googleConfig = saved.googleConfig || null;

            state.stats = saved.stats || state.stats;

            if (saved.azureConfig || saved.googleConfig) {
              console.warn('[TTS Security] API keys loaded from storage. Ensure proper access controls are in place.');
            }
          }
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  async function saveSettings() {
    return new Promise((resolve) => {
      try {
        const toSave = {
          speed: state.speed,
          pitch: state.pitch,
          volume: state.volume,
          provider: state.provider,
          azureConfig: state.azureConfig,
          googleConfig: state.googleConfig,
          stats: state.stats
        };
        chrome.storage.local.set({ [CONFIG.storageKey]: toSave }, resolve);
      } catch (e) {
        resolve();
      }
    });
  }

  async function loadVoices() {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        console.warn('[TTS] Web Speech API não suportada');
        resolve();
        return;
      }

      const loadVoiceList = () => {
        state.availableVoices = window.speechSynthesis.getVoices();
        if (state.availableVoices.length > 0) {
          resolve();
        }
      };

      // Tentar carregar imediatamente
      loadVoiceList();

      // Algumas browsers carregam assincronamente
      if (state.availableVoices.length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
          loadVoiceList();
          resolve();
        };
        
        // Timeout de segurança
        setTimeout(resolve, 2000);
      }
    });
  }

  function selectBestVoice() {
    if (state.availableVoices.length === 0) return;

    // Procurar voz preferida
    for (const preferred of CONFIG.preferredVoices) {
      const found = state.availableVoices.find(v => 
        v.name.includes(preferred) || v.lang.includes(preferred)
      );
      if (found) {
        state.voice = found;
        console.log('[TTS] Voz selecionada:', found.name);
        return;
      }
    }

    // Fallback: primeira voz em português
    const ptVoice = state.availableVoices.find(v => 
      v.lang.startsWith('pt') || v.lang.includes('Portuguese')
    );
    if (ptVoice) {
      state.voice = ptVoice;
      console.log('[TTS] Voz fallback (PT):', ptVoice.name);
      return;
    }

    // Último fallback: primeira voz disponível
    state.voice = state.availableVoices[0];
    console.log('[TTS] Voz fallback:', state.voice?.name);
  }

  // ============================================
  // FALAR TEXTO
  // ============================================

  /**
   * Fala um texto
   * @param {string} text - Texto a ser falado
   * @param {Object} options - Opções
   * @returns {Promise<void>}
   */
  async function speak(text, options = {}) {
    if (!text || typeof text !== 'string') return;

    // Truncar se muito longo
    const truncatedText = text.slice(0, CONFIG.maxChars);
    state.currentText = truncatedText;

    // Parar qualquer reprodução atual
    if (state.isPlaying) {
      stop();
    }

    try {
      switch (state.provider) {
        case 'azure':
          if (state.azureConfig?.key && state.azureConfig?.region) {
            await speakWithAzure(truncatedText, options);
          } else {
            await speakWithBrowser(truncatedText, options);
          }
          break;

        case 'google':
          if (state.googleConfig?.apiKey) {
            await speakWithGoogle(truncatedText, options);
          } else {
            await speakWithBrowser(truncatedText, options);
          }
          break;

        case 'browser':
        default:
          await speakWithBrowser(truncatedText, options);
          break;
      }

      // Atualizar estatísticas
      state.stats.totalSpoken++;
      state.stats.totalChars += truncatedText.length;
      state.stats.lastUsed = new Date().toISOString();
      await saveSettings();

    } catch (error) {
      console.error('[TTS] Erro ao falar:', error);
      // Fallback para browser API
      if (state.provider !== 'browser') {
        console.log('[TTS] Tentando fallback para Web Speech API...');
        await speakWithBrowser(truncatedText, options);
      }
    }
  }

  /**
   * Fala usando Web Speech API (nativa do browser)
   */
  async function speakWithBrowser(text, options = {}) {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error('Web Speech API não suportada'));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      
      // Configurações
      utterance.lang = options.lang || CONFIG.defaultLang;
      utterance.rate = options.speed ?? state.speed;
      utterance.pitch = options.pitch ?? state.pitch;
      utterance.volume = options.volume ?? state.volume;
      
      // Voz
      if (options.voice) {
        const voiceObj = state.availableVoices.find(v => 
          v.name === options.voice || v.voiceURI === options.voice
        );
        if (voiceObj) utterance.voice = voiceObj;
      } else if (state.voice) {
        utterance.voice = state.voice;
      }

      // Eventos
      utterance.onstart = () => {
        state.isPlaying = true;
        state.isPaused = false;
        state.currentUtterance = utterance;
        emitEvent('start', { text });
      };

      utterance.onend = () => {
        state.isPlaying = false;
        state.isPaused = false;
        state.currentUtterance = null;
        state.currentText = '';
        emitEvent('end', { text });
        resolve();
      };

      utterance.onerror = (event) => {
        state.isPlaying = false;
        state.isPaused = false;
        state.currentUtterance = null;
        emitEvent('error', { error: event.error });
        reject(new Error(event.error));
      };

      utterance.onpause = () => {
        state.isPaused = true;
        emitEvent('pause');
      };

      utterance.onresume = () => {
        state.isPaused = false;
        emitEvent('resume');
      };

      // Falar
      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Fala usando Azure Cognitive Services
   */
  async function speakWithAzure(text, options = {}) {
    const { key, region } = state.azureConfig;
    if (!key || !region) {
      throw new Error('Azure TTS não configurado');
    }

    const voice = options.azureVoice || 'pt-BR-FranciscaNeural';
    const speed = options.speed ?? state.speed;

    // Construir SSML
    const ssml = `
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-BR">
  <voice name="${voice}">
    <prosody rate="${speed}">
      ${escapeXml(text)}
    </prosody>
  </voice>
</speak>`.trim();

    const response = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3'
        },
        body: ssml
      }
    );

    if (!response.ok) {
      throw new Error(`Azure TTS error: ${response.status}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    
    await playAudio(url, text);
  }

  /**
   * Fala usando Google Cloud Text-to-Speech
   */
  async function speakWithGoogle(text, options = {}) {
    const { apiKey } = state.googleConfig;
    if (!apiKey) {
      throw new Error('Google TTS não configurado');
    }

    const voice = options.googleVoice || 'pt-BR-Standard-A';
    const speed = options.speed ?? state.speed;

    // SECURITY FIX P0-014: Move API key from URL to header
    // URL query parameters are logged, cached, and visible in browser history
    const response = await fetch(
      'https://texttospeech.googleapis.com/v1/text:synthesize',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey  // Use header instead of query parameter
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: 'pt-BR',
            name: voice
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: speed
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Google TTS error: ${response.status}`);
    }

    const data = await response.json();
    const audioContent = data.audioContent;
    const url = `data:audio/mp3;base64,${audioContent}`;
    
    await playAudio(url, text);
  }

  /**
   * Reproduz áudio de uma URL
   */
  function playAudio(url, text) {
    return new Promise((resolve, reject) => {
      // Limpar áudio anterior
      if (state.currentAudio) {
        state.currentAudio.pause();
        URL.revokeObjectURL(state.currentAudio.src);
      }

      const audio = new Audio(url);
      state.currentAudio = audio;

      audio.onplay = () => {
        state.isPlaying = true;
        state.isPaused = false;
        emitEvent('start', { text });
      };

      audio.onended = () => {
        state.isPlaying = false;
        state.isPaused = false;
        state.currentAudio = null;
        state.currentText = '';
        URL.revokeObjectURL(url);
        emitEvent('end', { text });
        resolve();
      };

      audio.onerror = (e) => {
        state.isPlaying = false;
        state.currentAudio = null;
        URL.revokeObjectURL(url);
        emitEvent('error', { error: e });
        reject(e);
      };

      audio.onpause = () => {
        state.isPaused = true;
        emitEvent('pause');
      };

      audio.play().catch(reject);
    });
  }

  // ============================================
  // CONTROLES
  // ============================================

  /**
   * Para a reprodução
   */
  function stop() {
    if (state.currentAudio) {
      state.currentAudio.pause();
      URL.revokeObjectURL(state.currentAudio.src);
      state.currentAudio = null;
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    state.isPlaying = false;
    state.isPaused = false;
    state.currentUtterance = null;
    state.currentText = '';

    emitEvent('stop');
  }

  /**
   * Pausa a reprodução
   */
  function pause() {
    if (!state.isPlaying) return;

    if (state.currentAudio) {
      state.currentAudio.pause();
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.pause();
    }

    state.isPaused = true;
    emitEvent('pause');
  }

  /**
   * Retoma a reprodução
   */
  function resume() {
    if (!state.isPaused) return;

    if (state.currentAudio) {
      state.currentAudio.play();
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.resume();
    }

    state.isPaused = false;
    emitEvent('resume');
  }

  /**
   * Toggle play/pause
   */
  function toggle() {
    if (state.isPlaying && !state.isPaused) {
      pause();
    } else if (state.isPaused) {
      resume();
    }
  }

  // ============================================
  // CONFIGURAÇÕES
  // ============================================

  /**
   * Define a velocidade de fala
   * @param {number} speed - 0.5 a 2.0
   */
  function setSpeed(speed) {
    state.speed = Math.max(0.5, Math.min(2.0, speed));
    saveSettings();
  }

  /**
   * Define o pitch (tom)
   * @param {number} pitch - 0.5 a 2.0
   */
  function setPitch(pitch) {
    state.pitch = Math.max(0.5, Math.min(2.0, pitch));
    saveSettings();
  }

  /**
   * Define o volume
   * @param {number} volume - 0 a 1
   */
  function setVolume(volume) {
    state.volume = Math.max(0, Math.min(1, volume));
    saveSettings();
  }

  /**
   * Define a voz
   * @param {string} voiceName - Nome da voz
   */
  function setVoice(voiceName) {
    const voice = state.availableVoices.find(v => 
      v.name === voiceName || v.voiceURI === voiceName
    );
    if (voice) {
      state.voice = voice;
    }
  }

  /**
   * Define o provider de TTS
   * @param {string} provider - 'browser', 'azure', 'google'
   */
  function setProvider(provider) {
    if (['browser', 'azure', 'google'].includes(provider)) {
      state.provider = provider;
      saveSettings();
    }
  }

  /**
   * Configura Azure Cognitive Services
   * @param {Object} config - { key, region }
   *
   * SECURITY WARNING P0-013: API keys are stored in plaintext in chrome.storage.local
   * For production use:
   * - Use environment variables or secure key management service
   * - Use chrome.storage.session (encrypted by browser) instead of local
   * - Implement proper access controls and key rotation
   */
  function configureAzure(config) {
    // SECURITY FIX P0-015: Sanitize config object before storing
    const sanitized = sanitizeObject(config);

    // Validate config structure
    if (!sanitized || typeof sanitized.key !== 'string' || typeof sanitized.region !== 'string') {
      throw new Error('Invalid Azure config: must have { key: string, region: string }');
    }

    state.azureConfig = sanitized;
    console.warn('[TTS Security] Azure API key configured. Stored in plaintext - use secure storage for production.');
    saveSettings();
  }

  /**
   * Configura Google Cloud TTS
   * @param {Object} config - { apiKey }
   *
   * SECURITY WARNING P0-013: API keys are stored in plaintext in chrome.storage.local
   * For production use:
   * - Use environment variables or secure key management service
   * - Use chrome.storage.session (encrypted by browser) instead of local
   * - Implement proper access controls and key rotation
   */
  function configureGoogle(config) {
    // SECURITY FIX P0-015: Sanitize config object before storing
    const sanitized = sanitizeObject(config);

    // Validate config structure
    if (!sanitized || typeof sanitized.apiKey !== 'string') {
      throw new Error('Invalid Google config: must have { apiKey: string }');
    }

    state.googleConfig = sanitized;
    console.warn('[TTS Security] Google API key configured. Stored in plaintext - use secure storage for production.');
    saveSettings();
  }

  // ============================================
  // EVENTOS
  // ============================================
  
  const eventListeners = new Map();

  function on(event, callback) {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, []);
    }
    eventListeners.get(event).push(callback);
    
    // Retorna função para remover listener
    return () => off(event, callback);
  }

  function off(event, callback) {
    const listeners = eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  function emitEvent(event, data = {}) {
    const listeners = eventListeners.get(event) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (e) {
        console.error('[TTS] Erro no event listener:', e);
      }
    });

    // Também emitir via EventBus se disponível
    if (window.EventBus) {
      window.EventBus.emit(`tts:${event}`, data);
    }
  }

  // ============================================
  // UTILITÁRIOS
  // ============================================

  /**
   * Obtém lista de vozes disponíveis
   * @returns {Object[]}
   */
  function getVoices() {
    return state.availableVoices.map(v => ({
      name: v.name,
      lang: v.lang,
      localService: v.localService,
      default: v.default
    }));
  }

  /**
   * Obtém vozes filtradas por idioma
   * @param {string} lang - Código do idioma (ex: 'pt-BR')
   * @returns {Object[]}
   */
  function getVoicesByLang(lang) {
    return getVoices().filter(v => v.lang.startsWith(lang));
  }

  /**
   * Obtém estado atual
   * @returns {Object}
   */
  function getState() {
    return {
      isPlaying: state.isPlaying,
      isPaused: state.isPaused,
      currentText: state.currentText,
      speed: state.speed,
      pitch: state.pitch,
      volume: state.volume,
      voice: state.voice?.name || null,
      provider: state.provider,
      stats: { ...state.stats }
    };
  }

  /**
   * Verifica se TTS está disponível
   * @returns {boolean}
   */
  function isAvailable() {
    return !!(window.speechSynthesis || state.azureConfig?.key || state.googleConfig?.apiKey);
  }

  /**
   * Escape para XML (SSML)
   */
  function escapeXml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ============================================
  // FUNÇÕES DE CONVENIÊNCIA
  // ============================================

  /**
   * Lê uma mensagem do WhatsApp
   * @param {Element} messageElement - Elemento da mensagem
   */
  async function readMessage(messageElement) {
    if (!messageElement) return;

    // Encontrar texto da mensagem
    const textEl = messageElement.querySelector('span.selectable-text, .copyable-text');
    const text = textEl?.textContent?.trim();

    if (text) {
      await speak(text);
    }
  }

  /**
   * Lê a última mensagem recebida
   */
  async function readLastMessage() {
    const messages = document.querySelectorAll('.message-in');
    const lastMessage = messages[messages.length - 1];
    await readMessage(lastMessage);
  }

  /**
   * Anuncia uma notificação
   * @param {string} title - Título
   * @param {string} body - Corpo da notificação
   */
  async function announceNotification(title, body) {
    const text = `${title}. ${body}`;
    await speak(text, { speed: 1.1 }); // Um pouco mais rápido para notificações
  }

  // ============================================
  // INICIALIZAÇÃO AUTOMÁTICA
  // ============================================
  
  // Inicializar quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ============================================
  // EXPORT
  // ============================================
  const api = {
    // Core
    speak,
    stop,
    pause,
    resume,
    toggle,

    // Configurações
    setSpeed,
    setPitch,
    setVolume,
    setVoice,
    setProvider,
    configureAzure,
    configureGoogle,

    // Eventos
    on,
    off,

    // Utilitários
    getVoices,
    getVoicesByLang,
    getState,
    isAvailable,

    // Conveniência
    readMessage,
    readLastMessage,
    announceNotification,

    // Reinicializar
    init
  };

  // Expor globalmente
  window.TextToSpeech = api;
  window.TTS = api; // Alias curto

})();
