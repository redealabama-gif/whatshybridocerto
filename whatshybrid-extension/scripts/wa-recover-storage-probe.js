/**
 * WARecoverStorage — o que o Recover REALMENTE guardou de cada mensagem apagada.
 *
 * Responde duas perguntas de uma vez:
 *
 * 1) MÍDIA — "aparece no histórico mas não baixa". O registro está sem arquivo,
 *    com só a miniatura, ou completo?
 *    CORREÇÃO (16/11/2026): a 1ª versão deste script olhava só a marca
 *    `mediaIsThumbnail` e chamou de "arquivo completo" registros de 4 KB que
 *    eram miniatura (imagem real do mesmo aparelho: 151 KB). Agora compara com
 *    o `size` guardado na mensagem e usa um piso por tipo.
 *
 * 2) ORIGEM — "aparece 'meu número → meu número' em mensagem que não é minha".
 *    Imprime from/to/chatId/fromMe e a origem do registro, para descobrir qual
 *    caminho de captura está preenchendo errado.
 *
 * COMO RODAR (console do PAINEL da extensão, não da página do WhatsApp)
 * 1. Abra o painel lateral do WhatsHybrid.
 * 2. Botão direito DENTRO do painel -> "Inspecionar".
 * 3. Console -> cole este arquivo -> Enter.
 * 4. Rode:  await WARecoverStorage.run()
 *
 * Somente leitura. Não apaga nem altera nada. Não imprime o conteúdo das
 * mensagens — só tipo, tamanho, origem e os números (que o dono já vê na tela).
 */
(function () {
    'use strict';

    const CHAVE = 'whl_recover_history';
    const linhas = [];
    const P = (s) => { linhas.push(s); console.log(s); };

    // Piso abaixo do qual o que está guardado só pode ser miniatura.
    const PISO_BYTES = { image: 20 * 1024, video: 40 * 1024, sticker: 8 * 1024, document: 20 * 1024, ptt: 3 * 1024, audio: 3 * 1024 };

    const bytesDe = (v) => (typeof v === 'string' ? Math.round((v.replace(/^data:[^,]+,/, '').length * 3) / 4) : 0);
    const kb = (v) => (typeof v === 'string' ? Math.round(bytesDe(v) / 1024) + ' KB' : '-');
    const temArquivo = (v) => typeof v === 'string' && v.length > 50 && v !== '__HAS_MEDIA__';
    const mimeDe = (v) => { const m = typeof v === 'string' ? v.match(/^data:([^;,]+)/) : null; return m ? m[1] : null; };

    /** Classifica o registro usando a marca, o tamanho original e o piso por tipo. */
    function classificar(m) {
        const full = m.mediaData || m.mediaDataFull || null;
        const prev = m.mediaDataPreview || m.thumbnail || null;
        const marcadoThumb = !!m.isThumbnail || !!m.mediaIsThumbnail;
        if (!temArquivo(full) && !temArquivo(prev)) return { v: 'SEM ARQUIVO', full, prev, motivo: 'nada guardado' };

        const alvo = temArquivo(full) ? full : prev;
        const bytes = bytesDe(alvo);
        const piso = PISO_BYTES[String(m.type)] || 10 * 1024;
        const original = typeof m.size === 'number' && m.size > 0 ? m.size : null;

        if (marcadoThumb) return { v: 'SO MINIATURA', full, prev, motivo: 'marcado como miniatura' };
        if (bytes < piso) return { v: 'SO MINIATURA', full, prev, motivo: `${Math.round(bytes / 1024)} KB < piso de ${Math.round(piso / 1024)} KB para "${m.type}"` };
        if (original && bytes < original * 0.5) return { v: 'SO MINIATURA', full, prev, motivo: `${Math.round(bytes / 1024)} KB x ${Math.round(original / 1024)} KB do original` };
        return { v: 'ARQUIVO OK', full, prev, motivo: original ? `${Math.round(bytes / 1024)} KB ~ ${Math.round(original / 1024)} KB do original` : `${Math.round(bytes / 1024)} KB` };
    }

    async function run() {
        linhas.length = 0;
        P('========== RELATORIO WARecoverStorage ==========');

        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            P('BLOQUEIO: sem chrome.storage aqui. Você colou no console da PÁGINA do');
            P('           WhatsApp. Precisa ser no console do PAINEL da extensão');
            P('           (botão direito dentro do painel -> Inspecionar).');
            return linhas.join('\n');
        }

        const res = await new Promise((r) => chrome.storage.local.get([CHAVE], r));
        const hist = res && res[CHAVE];
        if (!hist) { P('histórico vazio (' + CHAVE + ' não existe)'); return linhas.join('\n'); }

        const itens = Array.isArray(hist) ? hist : Object.values(hist);
        const mid = itens.filter((m) => m && ((m.type && m.type !== 'chat') || m.mimetype || m.mediaData || m.mediaDataPreview));
        P('registros=' + itens.length + ' | de mídia=' + mid.length);

        P('');
        P('--- 1. MÍDIA: últimos ' + Math.min(15, mid.length) + ' registros ---');
        for (const m of mid.slice(-15)) {
            const c = classificar(m);
            P('  [' + c.v + ']  ' + c.motivo);
            P('      type=' + (m.type || '?') + ' mimetype=' + (m.mimetype || mimeDe(c.full) || '?')
                + ' size_original=' + (m.size != null ? Math.round(m.size / 1024) + ' KB' : '?'));
            P('      mediaData=' + (c.full ? kb(c.full) : 'null') + ' preview=' + (c.prev ? kb(c.prev) : 'null')
                + ' marcaThumb=' + (!!m.isThumbnail || !!m.mediaIsThumbnail));
            P('      mediaKey=' + (m.mediaKey ? 'sim' : 'NAO') + ' directPath=' + (m.directPath ? 'sim' : 'NAO'));
        }

        let ok = 0, th = 0, sem = 0;
        for (const m of mid) { const v = classificar(m).v; if (v === 'ARQUIVO OK') ok++; else if (v === 'SO MINIATURA') th++; else sem++; }
        P('');
        P('  resumo dos ' + mid.length + ': arquivo completo=' + ok + ' | só miniatura=' + th + ' | SEM arquivo=' + sem);

        // ── 2. ORIGEM (WA-04) ────────────────────────────────────────────────
        P('');
        P('--- 2. ORIGEM: de quem veio cada registro (últimos 15) ---');
        const iguais = [];
        for (const m of itens.slice(-15)) {
            if (!m) continue;
            const mesmo = m.from && m.to && String(m.from) === String(m.to);
            if (mesmo) iguais.push(m);
            P('  ' + (mesmo ? '[MESMO NUMERO DOS 2 LADOS] ' : '') + String(m.from) + ' -> ' + String(m.to));
            P('      acao=' + (m.action || '?') + ' type=' + (m.type || '?') + ' fromMe=' + m.fromMe
                + ' chatId=' + JSON.stringify(m.chatId || null));
            P('      origem=' + (m.source || m.extractedFrom || m.origin || '?')
                + ' contentCaptured=' + m.contentCaptured
                + ' quando=' + (m.timestamp ? new Date(Number(m.timestamp) > 1e12 ? Number(m.timestamp) : Number(m.timestamp) * 1000).toLocaleString('pt-BR') : '?'));
        }
        const todosIguais = itens.filter((m) => m && m.from && m.to && String(m.from) === String(m.to));
        P('');
        P('  registros com o mesmo número dos 2 lados: ' + todosIguais.length + ' de ' + itens.length);
        if (todosIguais.length) {
            const porOrigem = {};
            todosIguais.forEach((m) => { const k = m.source || m.extractedFrom || m.origin || '?'; porOrigem[k] = (porOrigem[k] || 0) + 1; });
            P('  por origem: ' + JSON.stringify(porOrigem));
            const porAcao = {};
            todosIguais.forEach((m) => { const k = m.action || '?'; porAcao[k] = (porAcao[k] || 0) + 1; });
            P('  por ação: ' + JSON.stringify(porAcao));
        }

        P('');
        P('LEITURA');
        P('  "SEM arquivo" na maioria  => o problema é a captura da mídia (WA-02).');
        P('  "só miniatura" na maioria => o original não chegou a ser baixado (WA-03).');
        P('  "mesmo número dos 2 lados" => a origem do campo acima diz qual caminho');
        P('                                de captura preencheu errado (WA-04).');
        P('===============================================');

        const txt = linhas.join('\n');
        window.__WHL_STORAGE_OUT = txt;
        try { if (typeof copy === 'function') { copy(txt); P('(copiado para a área de transferência)'); } } catch (_) { /* sem copy() */ }
        return txt;
    }

    window.WARecoverStorage = { run, classificar };
    console.log('%c[WARecoverStorage] pronto. Rode:  await WARecoverStorage.run()', 'color:#25D366;font-weight:bold');
})();
