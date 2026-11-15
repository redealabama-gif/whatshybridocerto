/**
 * WAMediaProbe — diagnóstico de download de mídia no WhatsApp Web real.
 *
 * PARA QUE SERVE
 * O Recover salva a mídia da mensagem apagada chamando o módulo interno do
 * WhatsApp `downloadManager.downloadAndMaybeDecrypt({...})`. Em 2026 ele passou
 * a recusar o par type x mimetype:
 *   "Unexpected mimetype application/octet-stream for media type ptt"
 * Sem o arquivo salvo, a mensagem aparece no histórico do Recover mas o botão
 * de baixar não tem o que entregar.
 *
 * Este script NÃO depende da extensão. Ele pega o módulo do WhatsApp, escolhe
 * mídias REAIS da conversa aberta e testa 6 variantes de parâmetros, dizendo
 * qual delas devolve bytes. Assim a correção sai da medição, não do chute.
 *
 * COMO RODAR
 * 1. Abra uma conversa que tenha um ÁUDIO e uma IMAGEM (podem ser normais, nao
 *    precisam estar apagados) e role até eles aparecerem.
 * 2. F12 -> Console -> cole TODO este arquivo -> Enter.
 * 3. Rode:  await WAMediaProbe.run()
 * 4. Copie o bloco "RELATORIO" inteiro e me manda.
 *
 * SEGURANCA: só lê e baixa mídia (o mesmo que o WhatsApp faz ao abrir o
 * arquivo). Não envia, não apaga e não altera nenhuma mensagem.
 */
(function () {
    'use strict';

    const MEDIA_TYPES = ['ptt', 'audio', 'image', 'video', 'document', 'sticker'];
    const linhas = [];
    const P = (s) => { linhas.push(s); console.log(s); };

    // ---------- acesso aos módulos do WhatsApp ----------
    function getWpRequire() {
        try {
            if (window.webpackChunkwhatsapp_web_client) {
                return window.webpackChunkwhatsapp_web_client.push([['__whl_probe'], {}, (r) => r]);
            }
        } catch (_) { /* segue */ }
        try {
            if (window.webpackJsonp) {
                let r;
                window.webpackJsonp.push([['__whl_probe'], { __whl_probe: (m, e, rq) => { r = rq; } }, ['__whl_probe']]);
                return r;
            }
        } catch (_) { /* segue */ }
        return null;
    }

    function req(name) {
        for (const fn of [typeof require === 'function' ? require : null,
                          typeof window.require === 'function' ? window.require : null,
                          getWpRequire()]) {
            if (typeof fn !== 'function') continue;
            try { const m = fn(name); if (m) return m; } catch (_) { /* tenta o próximo */ }
        }
        return null;
    }

    function findModule(filtro) {
        const wp = getWpRequire();
        if (!wp || !wp.c) return null;
        for (const id of Object.keys(wp.c)) {
            const m = wp.c[id] && wp.c[id].exports;
            if (!m) continue;
            try {
                if (filtro(m)) return m;
                if (m.default && filtro(m.default)) return m.default;
            } catch (_) { /* módulo com getter que explode: ignora */ }
        }
        return null;
    }

    function getDownloadManager() {
        const mod = req('WAWebDownloadManager');
        const direto = mod && (mod.downloadManager || (mod.default && mod.default.downloadManager));
        if (direto && typeof direto.downloadAndMaybeDecrypt === 'function') {
            return { dm: direto, via: "require('WAWebDownloadManager').downloadManager" };
        }
        const v1 = findModule((m) => m.downloadManager && typeof m.downloadManager.downloadAndMaybeDecrypt === 'function');
        if (v1) return { dm: v1.downloadManager, via: 'varredura webpack (.downloadManager)' };
        const v2 = findModule((m) => typeof m.downloadAndMaybeDecrypt === 'function');
        if (v2) return { dm: v2, via: 'varredura webpack (export direto)' };
        return { dm: null, via: null };
    }

    function getMensagens() {
        // conversa aberta primeiro; se não achar mídia, varre as conversas carregadas
        const cc = req('WAWebChatCollection');
        const C = (cc && (cc.ChatCollection || cc.default)) || (window.Store && window.Store.Chat) || null;
        const chats = C && typeof C.getModelsArray === 'function' ? C.getModelsArray() : [];
        const msgsDo = (chat) => {
            try {
                const col = chat && chat.msgs;
                if (col && typeof col.getModelsArray === 'function') return col.getModelsArray();
            } catch (_) { /* chat sem mensagens carregadas */ }
            return [];
        };
        const ativo = chats.find((c) => c && c.active);
        const ordenados = ativo ? [ativo, ...chats.filter((c) => c !== ativo)] : chats;
        const out = [];
        for (const c of ordenados) {
            out.push(...msgsDo(c).map((m) => ({ m, chat: c, ativo: c === ativo })));
            if (out.length > 4000) break;
        }
        return { total: chats.length, temAtivo: !!ativo, msgs: out };
    }

    // mesma extração de campos que a extensão usa (content/wpp-hooks-parts/01-init-debug.js)
    function camposDeMidia(msg) {
        if (!msg) return null;
        const md = msg.mediaData && typeof msg.mediaData === 'object' ? msg.mediaData : {};
        return {
            type: msg.type || null,
            mimetype: msg.mimetype || md.mimetype || null,
            size: typeof msg.size === 'number' ? msg.size : (typeof md.size === 'number' ? md.size : null),
            directPath: msg.directPath || null,
            mediaKey: msg.mediaKey || null,
            mediaKeyTimestamp: msg.mediaKeyTimestamp || null,
            filehash: msg.filehash || null,
            encFilehash: msg.encFilehash || null
        };
    }

    // ---------- variantes testadas ----------
    const VARIANTES = [
        ['A', '{type, mimetype}        correção atual, 1a tentativa', (f) => ({ type: f.type, mimetype: f.mimetype || undefined })],
        ['B', '{mimetype}              correção atual, 2a tentativa', (f) => ({ mimetype: f.mimetype || undefined })],
        ['C', '{type}                  como era ANTES (deve falhar)', (f) => ({ type: f.type })],
        ['D', '{} (nem type nem mime)                             ', () => ({})],
        ['E', '{type:"document", mime}                            ', (f) => ({ type: 'document', mimetype: f.mimetype || undefined })],
        ['F', '{type, mime, mediaKeyTimestamp numérico}           ', (f) => ({ type: f.type, mimetype: f.mimetype || undefined, mediaKeyTimestamp: Number(f.mediaKeyTimestamp) || undefined })]
    ];

    function tamanhoDe(r) {
        if (!r) return 0;
        if (typeof r === 'string') return r.length;
        if (typeof r.size === 'number') return r.size;
        if (typeof r.byteLength === 'number') return r.byteLength;
        if (r.buffer && typeof r.buffer.byteLength === 'number') return r.buffer.byteLength;
        return -1;
    }

    function tipoDe(r) {
        if (!r) return 'null';
        if (typeof r === 'string') return 'string';
        if (typeof r.arrayBuffer === 'function') return 'Blob' + (r.type ? ' (' + r.type + ')' : '');
        if (Object.prototype.toString.call(r) === '[object ArrayBuffer]') return 'ArrayBuffer';
        if (ArrayBuffer.isView(r)) return r.constructor && r.constructor.name;
        return Object.prototype.toString.call(r);
    }

    async function testar(dm, f) {
        const noopQpl = { addAnnotations() { return this; }, addPoint() { return this; } };
        const base = {
            directPath: f.directPath,
            encFilehash: f.encFilehash,
            filehash: f.filehash,
            mediaKey: f.mediaKey,
            mediaKeyTimestamp: f.mediaKeyTimestamp,
            signal: typeof AbortController === 'function' ? new AbortController().signal : undefined,
            downloadQpl: noopQpl
        };
        const res = [];
        for (const [id, rotulo, montar] of VARIANTES) {
            try {
                const r = await dm.downloadAndMaybeDecrypt({ ...base, ...montar(f) });
                const n = tamanhoDe(r);
                res.push({ id, rotulo, ok: n > 0, detalhe: n > 0 ? (tipoDe(r) + ', ' + n + ' bytes') : ('VAZIO (' + tipoDe(r) + ')') });
            } catch (e) {
                const msg = String((e && (e.message || e.status || e.name)) || e).slice(0, 180);
                res.push({ id, rotulo, ok: false, detalhe: 'ERRO: ' + msg });
            }
        }
        return res;
    }

    async function run() {
        linhas.length = 0;
        P('================ RELATORIO WAMediaProbe ================');
        P('WhatsApp Web: ' + (document.querySelector('meta[name="version"]')?.content || window.Debug?.VERSION || 'desconhecida'));

        const { dm, via } = getDownloadManager();
        if (!dm) {
            P('BLOQUEIO: nao achei downloadAndMaybeDecrypt neste WhatsApp.');
            P('           O modulo mudou de nome -> a correcao precisa ser outra.');
            P('=======================================================');
            window.__WHL_PROBE_OUT = linhas.join('\n');
            return linhas.join('\n');
        }
        P('downloadManager: OK  via ' + via);
        P('  assinatura: downloadAndMaybeDecrypt espera ' + dm.downloadAndMaybeDecrypt.length + ' argumento(s)');
        try {
            const chaves = Object.keys(dm).filter((k) => typeof dm[k] === 'function');
            P('  outras funcoes no modulo: ' + (chaves.join(', ') || '(nenhuma enumeravel)'));
        } catch (_) { /* proxy */ }

        const { total, temAtivo, msgs } = getMensagens();
        P('conversas carregadas: ' + total + ' | conversa aberta detectada: ' + (temAtivo ? 'sim' : 'NAO'));

        const cand = msgs
            .map((x) => ({ ...x, f: camposDeMidia(x.m) }))
            .filter((x) => x.f && x.f.directPath && x.f.mediaKey && MEDIA_TYPES.includes(String(x.f.type)));

        if (!cand.length) {
            P('BLOQUEIO: nenhuma midia com directPath+mediaKey carregada.');
            P('           Abra uma conversa com audio e imagem, role ate eles e rode de novo.');
            P('=======================================================');
            window.__WHL_PROBE_OUT = linhas.join('\n');
            return linhas.join('\n');
        }

        // um exemplo por tipo, priorizando a conversa aberta
        const escolhidos = [];
        for (const t of MEDIA_TYPES) {
            const c = cand.find((x) => String(x.f.type) === t && x.ativo) || cand.find((x) => String(x.f.type) === t);
            if (c) escolhidos.push(c);
        }
        P('midias encontradas: ' + cand.length + ' | testando ' + escolhidos.length + ' (uma por tipo)');

        for (const c of escolhidos) {
            const f = c.f;
            P('');
            P('--- tipo "' + f.type + '" ' + (c.ativo ? '(conversa aberta)' : '(outra conversa)') + ' ---');
            P('  mimetype guardado na mensagem: ' + (f.mimetype || 'NULO  <-- atencao, sem isso a correcao nao tem o que mandar'));
            P('  size=' + f.size + ' | mediaKeyTimestamp=' + f.mediaKeyTimestamp + ' (' + typeof f.mediaKeyTimestamp + ')');
            P('  filehash=' + (f.filehash ? 'sim' : 'NAO') + ' | encFilehash=' + (f.encFilehash ? 'sim' : 'NAO'));
            const res = await testar(dm, f);
            for (const r of res) P('  [' + (r.ok ? 'OK  ' : 'FALHA') + '] ' + r.id + ' ' + r.rotulo + ' -> ' + r.detalhe);
            const vencedoras = res.filter((r) => r.ok).map((r) => r.id);
            P('  >> funcionam para "' + f.type + '": ' + (vencedoras.length ? vencedoras.join(', ') : 'NENHUMA'));
        }

        P('');
        P('================ FIM DO RELATORIO =====================');
        const txt = linhas.join('\n');
        window.__WHL_PROBE_OUT = txt;
        try { if (typeof copy === 'function') { copy(txt); P('(relatorio copiado para a area de transferencia)'); } } catch (_) { /* sem copy() */ }
        return txt;
    }

    window.WAMediaProbe = { run, getDownloadManager, camposDeMidia, VARIANTES };
    console.log('%c[WAMediaProbe] pronto. Rode:  await WAMediaProbe.run()', 'color:#25D366;font-weight:bold');
})();
