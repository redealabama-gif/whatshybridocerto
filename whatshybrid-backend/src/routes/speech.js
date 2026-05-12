/**
 * 🗣️ WhatsHybrid - Speech API Routes
 * Rotas para Speech-to-Text e Text-to-Speech
 * 
 * @version 7.9.13
 */

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
// FIX HIGH: rotas de speech estavam SEM autenticação.
// /transcribe consome créditos da OpenAI Whisper API → vetor de financial DoS.
const { authenticate } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');

// FIX: aplica autenticação + rate limit (Whisper é caro: $0.006/min)
router.use(authenticate);
router.use(aiLimiter);

// Configurar multer para upload em memória
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max (limite do Whisper)
  fileFilter: (req, file, cb) => {
    // v9.4.2: whitelist estrita (antes aceitava QUALQUER audio/*).
    // Atacante podia mandar audio/x-evil com payload arbitrário —
    // Whisper rejeitava mas backend gastava CPU/memória processando upload.
    const allowed = [
      'audio/webm', 'audio/mp3', 'audio/mp4', 'audio/mpeg',
      'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/x-m4a',
      'audio/flac', 'audio/aac',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Formato de áudio não suportado: ${file.mimetype}`), false);
    }
  }
});

/**
 * POST /api/v1/speech/transcribe
 * Transcreve áudio para texto usando OpenAI Whisper
 */
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo de áudio enviado' });
    }

    const language = req.body.language || 'pt';
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'API Key OpenAI não configurada no servidor' });
    }

    // Preparar FormData para a API do Whisper
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: 'audio.webm',
      contentType: req.file.mimetype
    });
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');
    
    // Usar código de idioma de 2 letras
    const langCode = language.split('-')[0];
    if (langCode && langCode !== 'auto') {
      formData.append('language', langCode);
    }

    logger.info(`[Speech] Transcrevendo áudio: ${req.file.size} bytes, idioma: ${langCode}`);

    // v9.3.6: timeout de 90s — Whisper pra áudio até 25MB tipicamente <30s
    // Sem timeout, áudio corrompido podia travar o handler indefinidamente.
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        body: formData,
        signal: AbortSignal.timeout(90000),
      });
    } catch (fetchErr) {
      if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError') {
        logger.warn('[Speech] Whisper timeout após 90s');
        return res.status(504).json({ error: 'Transcrição demorou demais. Tente áudio menor.' });
      }
      logger.error('[Speech] Whisper network error:', fetchErr.message);
      return res.status(502).json({ error: 'Erro de conexão com serviço de transcrição.' });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      logger.error('[Speech] Erro Whisper:', error);
      return res.status(response.status).json({
        error: error.error?.message || `Erro na transcrição: ${response.status}`
      });
    }

    const data = await response.json();

    logger.info(`[Speech] Transcrição concluída: ${data.text?.length || 0} chars`);

    res.json({
      text: data.text || '',
      language: data.language || langCode,
      duration: data.duration,
      confidence: calculateConfidence(data),
      segments: data.segments?.map(s => ({
        text: s.text,
        start: s.start,
        end: s.end
      }))
    });

  } catch (error) {
    logger.error('[Speech] Erro na transcrição:', error);
    // v9.3.6: não vaza error.message cru — pode conter info sensível
    // (paths internos, fragmentos de API key em erros de auth, etc.)
    res.status(500).json({ error: 'Erro interno na transcrição' });
  }
});

/**
 * GET /api/v1/speech/languages
 * Lista idiomas suportados
 */
router.get('/languages', (req, res) => {
  res.json({
    languages: [
      { code: 'pt', name: 'Português', flag: '🇧🇷' },
      { code: 'en', name: 'English', flag: '🇺🇸' },
      { code: 'es', name: 'Español', flag: '🇪🇸' },
      { code: 'fr', name: 'Français', flag: '🇫🇷' },
      { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
      { code: 'it', name: 'Italiano', flag: '🇮🇹' },
      { code: 'ja', name: '日本語', flag: '🇯🇵' },
      { code: 'zh', name: '中文', flag: '🇨🇳' },
      { code: 'ar', name: 'العربية', flag: '🇸🇦' },
      { code: 'ru', name: 'Русский', flag: '🇷🇺' }
    ]
  });
});

/**
 * Calcula confiança baseado nos segmentos do Whisper
 */
function calculateConfidence(data) {
  if (!data.segments || data.segments.length === 0) return 0.9;
  
  // Whisper retorna avg_logprob nos segmentos
  const avgLogProb = data.segments.reduce((sum, seg) => {
    return sum + (seg.avg_logprob || -0.3);
  }, 0) / data.segments.length;
  
  // Converter log prob para confiança (0-1)
  // avg_logprob típico varia de -0.1 (alta confiança) a -1.0 (baixa)
  const confidence = Math.max(0, Math.min(1, 1 + avgLogProb));
  return Math.round(confidence * 100) / 100;
}

module.exports = router;
