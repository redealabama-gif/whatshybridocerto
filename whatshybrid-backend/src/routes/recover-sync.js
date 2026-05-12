/**
 * RECOVER SYNC ROUTES v7.5.0
 * Endpoints para sincronização do Recover
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticate } = require('../middleware/auth');

// FIX HIGH SECURITY: lógica anterior só autenticava em NODE_ENV=production.
// Significava que staging, qualquer ambiente sem NODE_ENV setado, ou deploy
// acidental ficava SEM autenticação — endpoints expõem OCR/Transcribe + storage.
// Agora: autenticado por padrão, relaxado APENAS em NODE_ENV=development explícito.
function recoverSyncAuth(req, res, next) {
  if (process.env.NODE_ENV === 'development') return next();
  return authenticate(req, res, next);
}

router.use(recoverSyncAuth);

// Armazenamento temporário (em produção usar MongoDB/PostgreSQL)
const recoverStorage = new Map();

/**
 * POST /api/recover/sync
 * Recebe mensagens do cliente para sincronizar
 */
router.post('/sync', async (req, res) => {
    try {
        const { userId, messages } = req.body;
        
        if (!userId || !Array.isArray(messages)) {
            return res.status(400).json({ 
                success: false, 
                error: 'userId e messages são obrigatórios' 
            });
        }
        
        // Obter mensagens existentes do usuário
        let userMessages = recoverStorage.get(userId) || [];
        
        // Mesclar novas mensagens (evitar duplicatas)
        const existingIds = new Set(userMessages.map(m => m.id));
        const newMessages = messages.filter(m => !existingIds.has(m.id));
        
        userMessages = [...userMessages, ...newMessages];
        
        // Limitar a 10000 mensagens por usuário
        if (userMessages.length > 10000) {
            userMessages = userMessages.slice(-10000);
        }
        
        recoverStorage.set(userId, userMessages);
        
        res.json({
            success: true,
            synced: newMessages.length,
            total: userMessages.length
        });
        
    } catch (error) {
        logger.error('[Recover Sync] Erro:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * GET /api/recover/messages
 * Retorna mensagens do usuário
 */
router.get('/messages', async (req, res) => {
    try {
        const { userId, since = 0, limit = 100 } = req.query;
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                error: 'userId é obrigatório' 
            });
        }
        
        const userMessages = recoverStorage.get(userId) || [];
        
        // Filtrar por timestamp
        let messages = userMessages.filter(m => m.timestamp > parseInt(since));
        
        // Ordenar por timestamp (mais recentes primeiro)
        messages.sort((a, b) => b.timestamp - a.timestamp);
        
        // Limitar
        messages = messages.slice(0, parseInt(limit));
        
        res.json({
            success: true,
            messages,
            total: userMessages.length
        });
        
    } catch (error) {
        logger.error('[Recover Sync] Erro:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * DELETE /api/recover/clear
 * Limpa mensagens do usuário
 */
router.delete('/clear', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                error: 'userId é obrigatório' 
            });
        }
        
        recoverStorage.delete(userId);
        
        res.json({
            success: true,
            message: 'Histórico limpo'
        });
        
    } catch (error) {
        logger.error('[Recover Sync] Erro:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * POST /api/recover/ai/transcribe
 * Transcreve áudio para texto usando OpenAI Whisper
 * 
 * Body:
 * - audioData: Base64 encoded audio
 * - format: (opcional) Formato do áudio - padrão 'ogg'
 * - language: (opcional) Idioma - padrão 'pt'
 */
// v9.3.3: handler compartilhado pra transcrição.
// Aliases:
//   POST /api/v1/recover/transcribe       (extensão chama assim em recover-advanced.js)
//   POST /api/v1/recover/ai/transcribe    (rota canônica original)
async function handleTranscribe(req, res) {
    try {
        // Aceita tanto `audioData` (formato antigo) quanto `audio` (formato novo da extensão)
        const audioData = req.body.audioData || req.body.audio;
        const format = req.body.format || 'ogg';
        const language = req.body.language || 'pt';

        if (!audioData) {
            return res.status(400).json({
                success: false,
                error: 'audioData ou audio é obrigatório'
            });
        }

        // v9.4.2 BUG #97/#98: validação rigorosa
        // Antes: format='../../etc/passwd' ia pro filename, language='<script>' ia
        // pra Whisper sem checagem, audioData de 9.9MB passava sem validar tamanho.
        if (typeof audioData !== 'string') {
            return res.status(400).json({ success: false, error: 'audioData deve ser string base64' });
        }
        // 9MB base64 ≈ 6.7MB binary — Whisper aceita até 25MB, mas pra recover-sync
        // (rota de auto-transcrição em background) limitamos pra evitar abuso.
        if (audioData.length > 9 * 1024 * 1024) {
            return res.status(413).json({
                success: false,
                error: 'Áudio muito grande (max 9MB em base64)',
            });
        }

        // format: whitelist estrita — só extensões de audio conhecidas
        const ALLOWED_FORMATS = ['ogg', 'mp3', 'mp4', 'wav', 'webm', 'm4a', 'flac', 'aac', 'mpeg'];
        const safeFormat = ALLOWED_FORMATS.includes(String(format).toLowerCase())
            ? String(format).toLowerCase()
            : 'ogg';

        // language: ISO 639-1 (2 letras) ou ISO 639-3 (3 letras) — sem espaços, sem path
        const safeLanguage = /^[a-z]{2,3}(-[A-Z]{2})?$/.test(String(language))
            ? String(language)
            : 'pt';

        const apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey) {
            return res.json({
                success: false,
                error: 'OPENAI_API_KEY não configurada no .env'
            });
        }

        const axios = require('axios');
        const FormData = require('form-data');

        const audioBuffer = Buffer.from(
            audioData.replace(/^data:audio\/\w+;base64,/, ''),
            'base64'
        );

        const formData = new FormData();
        formData.append('file', audioBuffer, {
            filename: `audio.${safeFormat}`,
            contentType: `audio/${safeFormat}`
        });
        formData.append('model', 'whisper-1');
        formData.append('language', safeLanguage);

        const response = await axios.post(
            'https://api.openai.com/v1/audio/transcriptions',
            formData,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    ...formData.getHeaders()
                },
                timeout: 60000
            }
        );

        res.json({
            success: true,
            text: response.data?.text || '',
            language: safeLanguage
        });

    } catch (error) {
        logger.error('[Recover AI] Erro transcrição:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data?.error?.message || error.message
        });
    }
}

router.post('/transcribe', handleTranscribe);
router.post('/ai/transcribe', handleTranscribe);

/**
 * POST /api/recover/ai/ocr
 * Extrai texto de imagem usando Tesseract.js ou Google Vision
 * 
 * Body:
 * - imageData: Base64 encoded image
 * - language: (opcional) Idioma - padrão 'por' (português)
 */
// v9.3.3: handler compartilhado pra OCR.
// Aliases:
//   POST /api/v1/recover/ocr       (extensão chama assim em recover-advanced.js)
//   POST /api/v1/recover/ai/ocr    (rota canônica original)
async function handleOcr(req, res) {
    try {
        // Aceita tanto `imageData` quanto `image` (formato da extensão)
        const imageData = req.body.imageData || req.body.image;
        const language = req.body.language || 'por';

        if (!imageData) {
            return res.status(400).json({
                success: false,
                error: 'imageData ou image é obrigatório'
            });
        }

        // v9.4.2 BUG #99: validação de tamanho e linguagem
        if (typeof imageData !== 'string') {
            return res.status(400).json({ success: false, error: 'imageData deve ser string base64' });
        }
        // 8MB base64 ≈ 6MB binary — limite generoso pra OCR (Tesseract trava com imagens >20MB)
        if (imageData.length > 8 * 1024 * 1024) {
            return res.status(413).json({
                success: false,
                error: 'Imagem muito grande (max 8MB em base64)',
            });
        }

        // Tesseract language packs — whitelist comum + combinações tipo 'por+eng'
        // Permite letras, '+' pra combinar, max 50 chars (defensivo)
        const safeLanguage = (typeof language === 'string'
            && /^[a-z]{2,4}(\+[a-z]{2,4}){0,3}$/.test(language)
            && language.length <= 50)
            ? language
            : 'por';

        // Tentar Tesseract.js primeiro
        let Tesseract = null;
        try {
            Tesseract = require('tesseract.js');
        } catch (e) {
            // Tesseract não instalado
        }

        if (Tesseract) {
            const imageBuffer = Buffer.from(
                imageData.replace(/^data:image\/\w+;base64,/, ''),
                'base64'
            );

            const { data: { text, confidence } } = await Tesseract.recognize(
                imageBuffer,
                safeLanguage
            );

            return res.json({
                success: true,
                text: text.trim(),
                confidence: confidence / 100,
                provider: 'tesseract'
            });
        }

        // Tentar Google Vision como fallback
        const googleApiKey = process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_API_KEY;

        if (googleApiKey) {
            const axios = require('axios');
            const imageContent = imageData.replace(/^data:image\/\w+;base64,/, '');

            const response = await axios.post(
                `https://vision.googleapis.com/v1/images:annotate?key=${googleApiKey}`,
                {
                    requests: [{
                        image: { content: imageContent },
                        features: [{ type: 'TEXT_DETECTION', maxResults: 1 }]
                    }]
                },
                { timeout: 30000 }
            );

            const annotations = response.data?.responses?.[0]?.textAnnotations;
            const text = annotations?.[0]?.description || '';

            return res.json({
                success: true,
                text: text.trim(),
                provider: 'google_vision'
            });
        }

        // Nenhum serviço disponível
        res.json({
            success: false,
            error: 'Nenhum serviço de OCR disponível. Instale tesseract.js ou configure GOOGLE_VISION_API_KEY.'
        });

    } catch (error) {
        logger.error('[Recover AI] Erro OCR:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

router.post('/ocr', handleOcr);
router.post('/ai/ocr', handleOcr);

/**
 * POST /api/recover/ai/sentiment
 * Analisa sentimento do texto
 */
router.post('/ai/sentiment', async (req, res) => {
    try {
        const { text } = req.body;
        
        if (!text) {
            return res.status(400).json({ 
                success: false, 
                error: 'text é obrigatório' 
            });
        }
        
        // Análise simples de sentimento (sem API externa)
        const positiveWords = ['bom', 'ótimo', 'excelente', 'feliz', 'obrigado', 'parabéns', 'amor', 'adorei', 'top', 'show', 'maravilhoso', 'incrível'];
        const negativeWords = ['ruim', 'péssimo', 'horrível', 'triste', 'chato', 'raiva', 'ódio', 'problema', 'erro', 'nunca', 'não'];
        
        const textLower = text.toLowerCase();
        let score = 0;
        
        positiveWords.forEach(word => {
            if (textLower.includes(word)) score += 0.2;
        });
        
        negativeWords.forEach(word => {
            if (textLower.includes(word)) score -= 0.2;
        });
        
        // Normalizar score entre -1 e 1
        score = Math.max(-1, Math.min(1, score));
        
        let label = 'neutro';
        if (score > 0.1) label = 'positivo';
        else if (score < -0.1) label = 'negativo';
        
        res.json({
            success: true,
            score,
            label,
            confidence: Math.abs(score)
        });
        
    } catch (error) {
        logger.error('[Recover AI] Erro sentimento:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * POST /api/recover/media/download
 * FIX PEND-MED-005: Downloads media from WhatsApp servers
 *
 * Body:
 * - mediaKey: Media encryption key
 * - directPath: WhatsApp CDN direct path
 * - mimetype: Media mimetype
 *
 * Returns:
 * - success: true/false
 * - base64: Media data in base64 format
 * - error: Error message if failed
 */
router.post('/media/download', async (req, res) => {
    try {
        const { mediaKey, directPath, mimetype } = req.body;

        if (!mediaKey || !directPath) {
            return res.status(400).json({
                success: false,
                error: 'mediaKey and directPath are required'
            });
        }

        // FIX PEND-MED-005: Implement media download from WhatsApp CDN
        // NOTE: This is a simplified implementation. Full implementation would require:
        // 1. WhatsApp media decryption (AES-256-CBC with mediaKey)
        // 2. CDN URL construction from directPath
        // 3. Proper error handling for expired/revoked media

        logger.info('[Recover Media] Download request:', {
            directPath: directPath.substring(0, 20) + '...',
            mimetype
        });

        // For now, return error indicating this feature needs WhatsApp Web API integration
        // In production, this would:
        // 1. Construct CDN URL: https://mmg.whatsapp.net${directPath}
        // 2. Download encrypted media
        // 3. Decrypt using mediaKey
        // 4. Return base64 encoded result

        return res.status(501).json({
            success: false,
            error: 'Media download from WhatsApp CDN not yet implemented. ' +
                   'This requires WhatsApp Web API integration for media decryption. ' +
                   'Use client-side Store.DownloadManager.downloadMedia() instead.',
            recommendation: 'Enable proactive media caching in extension settings'
        });

    } catch (error) {
        logger.error('[Recover Media] Download error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
