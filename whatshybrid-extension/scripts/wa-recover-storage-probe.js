/**
 * WARecoverStorage — o que o Recover REALMENTE guardou de cada mídia apagada.
 *
 * PARA QUE SERVE
 * Você viu a mensagem apagada no histórico, mas o download não funciona. Isso
 * tem duas causas possíveis e elas se resolvem de formas diferentes:
 *   (1) o registro existe SEM o arquivo  -> a captura falhou (bug WA-02)
 *   (2) o registro tem só a miniatura    -> captura parcial
 * Este script lê o armazenamento da extensão e diz qual dos dois é o seu caso.
 *
 * COMO RODAR  (contexto da EXTENSÃO, não da página do WhatsApp)
 * 1. Abra o painel lateral da extensão (ícone do WhatsHybrid).
 * 2. Clique com o botão direito DENTRO do painel -> "Inspecionar".
 * 3. Na janela que abrir: Console -> cole este arquivo -> Enter.
 * 4. Rode:  await WARecoverStorage.run()
 * 5. Copie o relatório e me manda.
 *
 * SEGURANCA: somente leitura. Não apaga nem altera nada. Não imprime o conteúdo
 * das mensagens — só tipo, tamanho e se o arquivo está lá.
 */
(function () {
    'use strict';

    const CHAVE = 'whl_recover_history';
    const linhas = [];
    const P = (s) => { linhas.push(s); console.log(s); };

    function temArquivo(v) {
        return typeof v === 'string' && v.length > 50 && v !== '__HAS_MEDIA__';
    }

    function kb(v) {
        return typeof v === 'string' ? Math.round((v.length * 3) / 4 / 1024) + ' KB' : '-';
    }

    function mimeDe(v) {
        const m = typeof v === 'string' ? v.match(/^data:([^;,]+)/) : null;
        return m ? m[1] : null;
    }

    async function run() {
        linhas.length = 0;
        P('========== RELATORIO WARecoverStorage ==========');

        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            P('BLOQUEIO: sem chrome.storage aqui. Você colou no console da PÁGINA do');
            P('           WhatsApp. Precisa ser no console do PAINEL da extensão');
            P('           (botão direito dentro do painel -> Inspecionar).');
            P('===============================================');
            return linhas.join('\n');
        }

        const res = await new Promise((r) => chrome.storage.local.get([CHAVE], r));
        const hist = res && res[CHAVE];
        if (!hist) {
            P('nenhum registro em ' + CHAVE + ' (histórico do Recover vazio)');
            P('===============================================');
            return linhas.join('\n');
        }

        // o histórico pode ser array de mensagens ou objeto indexado por id
        const itens = Array.isArray(hist) ? hist : Object.values(hist);
        P('registros no histórico: ' + itens.length);

        const comMidia = itens.filter((m) => m && (m.type && m.type !== 'chat' || m.mimetype || m.mediaData || m.mediaDataPreview));
        P('registros que são de mídia: ' + comMidia.length);
        P('');

        let semArquivo = 0;
        let soMiniatura = 0;
        let completos = 0;

        const recentes = comMidia.slice(-15);
        P('--- últimos ' + recentes.length + ' registros de mídia ---');
        for (const m of recentes) {
            const full = m.mediaData || m.mediaDataFull || null;
            const prev = m.mediaDataPreview || m.thumbnail || null;
            const temFull = temArquivo(full);
            const temPrev = temArquivo(prev);
            const ehThumb = !!m.isThumbnail || !!m.mediaIsThumbnail;

            let veredito;
            if (temFull && !ehThumb) { veredito = 'ARQUIVO OK'; completos++; }
            else if (temFull && ehThumb) { veredito = 'SO MINIATURA'; soMiniatura++; }
            else if (temPrev) { veredito = 'SO MINIATURA (preview)'; soMiniatura++; }
            else { veredito = 'SEM ARQUIVO  <-- download no histórico vai falhar'; semArquivo++; }

            P('  [' + veredito + ']');
            P('      type=' + (m.type || '?') + ' mimetype=' + (m.mimetype || mimeDe(full) || '?'));
            P('      mediaData=' + (full ? kb(full) : 'null') + ' | preview=' + (prev ? kb(prev) : 'null'));
            P('      mediaKey=' + (m.mediaKey ? 'sim' : 'NAO') + ' | directPath=' + (m.directPath ? 'sim' : 'NAO')
                + '  (sem os dois, nem o servidor consegue buscar depois)');
            P('      acao=' + (m.action || '?') + ' | quando=' + (m.timestamp ? new Date(Number(m.timestamp) > 1e12 ? Number(m.timestamp) : Number(m.timestamp) * 1000).toLocaleString('pt-BR') : '?'));
        }

        P('');
        P('--- resumo de TODOS os ' + comMidia.length + ' registros de mídia ---');
        let tSem = 0, tThumb = 0, tOk = 0;
        for (const m of comMidia) {
            const full = m.mediaData || m.mediaDataFull || null;
            const prev = m.mediaDataPreview || m.thumbnail || null;
            const ehThumb = !!m.isThumbnail || !!m.mediaIsThumbnail;
            if (temArquivo(full) && !ehThumb) tOk++;
            else if (temArquivo(full) || temArquivo(prev)) tThumb++;
            else tSem++;
        }
        P('  arquivo completo salvo : ' + tOk);
        P('  só miniatura           : ' + tThumb);
        P('  SEM arquivo nenhum     : ' + tSem);
        P('');
        P('LEITURA: se "SEM arquivo nenhum" for a maioria, o problema é a captura');
        P('         (WA-02) e não o botão de baixar.');
        P('===============================================');

        const txt = linhas.join('\n');
        window.__WHL_STORAGE_OUT = txt;
        try { if (typeof copy === 'function') { copy(txt); P('(copiado para a área de transferência)'); } } catch (_) { /* sem copy() */ }
        return txt;
    }

    window.WARecoverStorage = { run };
    console.log('%c[WARecoverStorage] pronto. Rode:  await WARecoverStorage.run()', 'color:#25D366;font-weight:bold');
})();
