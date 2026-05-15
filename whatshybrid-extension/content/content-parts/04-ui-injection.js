/**
 * @file content/content-parts/04-ui-injection.js
 * @description Slice 4501-6161 do content.js original (refactor v9.0.0)
 * @lines 1661
 */

      // Método 2: Limpar diretamente (backup)
      input.innerHTML = '';
      input.textContent = '';
      
      // Disparar evento de input para garantir que o WhatsApp detecte a limpeza
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      
      // Pequena pausa para garantir que a limpeza foi processada
      await new Promise(r => setTimeout(r, 100));
      
      // Focar novamente
      input.focus();
      
      // Inserir texto preservando quebras de linha
      // IMPORTANTE: Processar linha por linha para preservar \n
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) {
          // Inserir quebra de linha com Shift+Enter
          input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            shiftKey: true,
            bubbles: true,
            cancelable: true
          }));
          await new Promise(r => setTimeout(r, 50));
        }
        
        if (lines[i]) {
          document.execCommand('insertText', false, lines[i]);
        }
      }
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      
      // Aguardar texto ser processado
      await new Promise(r => setTimeout(r, 300));
      
      // Simular Enter para enviar
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true
      });
      input.dispatchEvent(enterEvent);
      
      // Aguardar envio processar
      await new Promise(r => setTimeout(r, 1000));
      
      console.log('[WHL] ✅ Mensagem enviada via Input + Enter');
      return { success: true };
    } catch (e) {
      console.error('[WHL] ❌ Erro ao enviar:', e.message);
      return { success: false, error: e.message };
    }
  }
  
  // ===== DIRECT API CAMPAIGN PROCESSING (NO RELOAD) =====
  
  // PR #78: Function to replace dynamic variables in messages
  function substituirVariaveis(mensagem, contato) {
    if (!mensagem) return '';
    
    // Extract contact info from phone number or contact object
    let nome = '';
    let firstName = '';
    let lastName = '';
    let phone = '';
    let email = '';
    
    if (typeof contato === 'object' && contato !== null) {
      nome = contato.name || contato.pushname || contato.nome || '';
      phone = contato.phone || contato.number || contato.telefone || '';
      email = contato.email || '';
    } else {
      // If just a phone string
      phone = String(contato || '');
    }
    
    // Split name into first and last
    if (nome) {
      const partes = nome.split(' ').filter(p => p.length > 0);
      firstName = partes[0] || '';
      lastName = partes.slice(1).join(' ') || '';
    }
    
    // Calcular saudação baseada na hora
    const hour = new Date().getHours();
    let saudacao = 'Olá';
    if (hour >= 5 && hour < 12) {
      saudacao = 'Bom dia';
    } else if (hour >= 12 && hour < 18) {
      saudacao = 'Boa tarde';
    } else {
      saudacao = 'Boa noite';
    }
    
    // Data e hora formatadas
    const now = new Date();
    const data = now.toLocaleDateString('pt-BR');
    const hora = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    // Criar regex que aceita tanto {var} quanto {{var}}
    const replaceVar = (str, varName, value) => {
      // Aceitar {var}, {{var}}, {VAR}, {{VAR}}, etc.
      const regex1 = new RegExp(`\\{\\{${varName}\\}\\}`, 'gi');
      const regex2 = new RegExp(`\\{${varName}\\}`, 'gi');
      return str.replace(regex1, value).replace(regex2, value);
    };
    
    // Replace all variables (aceita {var} e {{var}})
    let result = mensagem;
    result = replaceVar(result, 'nome', nome);
    result = replaceVar(result, 'name', nome);
    result = replaceVar(result, 'first_name', firstName);
    result = replaceVar(result, 'primeiro_nome', firstName);
    result = replaceVar(result, 'last_name', lastName);
    result = replaceVar(result, 'sobrenome', lastName);
    result = replaceVar(result, 'phone', phone);
    result = replaceVar(result, 'telefone', phone);
    result = replaceVar(result, 'numero', phone);
    result = replaceVar(result, 'email', email);
    result = replaceVar(result, 'saudacao', saudacao);
    result = replaceVar(result, 'greeting', saudacao);
    result = replaceVar(result, 'data', data);
    result = replaceVar(result, 'date', data);
    result = replaceVar(result, 'hora', hora);
    result = replaceVar(result, 'time', hora);
    
    return result;
  }
  
  /**
   * Helper function to check for invalid phone number error
   * Returns true if the current page shows an invalid number error
   */
  function checkForInvalidNumber() {
    const bodyText = document.body.innerText || document.body.textContent || '';
    if (bodyText.includes('O número de telefone compartilhado por url é inválido')) {
      console.log('[WHL] ❌ Número inexistente detectado');
      return true;
    }
    return false;
  }

  // v9.6.x — safety net para mídia. O page-world às vezes consegue enviar
  // a mídia (cliente vê chegar no celular) mas a função retorna false ou o
  // RESULT event não chega de volta no handler. Antes a campanha ficava
  // travada em "pendentes". Agora, depois de 30s sem result, marcamos como
  // sent e avançamos — o WhatsApp já entregou de qualquer forma.
  const _mediaSafetyNets = new Map(); // requestId → timeoutId
  function _scheduleMediaSafetyNet(kind, requestId, phone) {
    if (!requestId) return;
    if (_mediaSafetyNets.has(requestId)) clearTimeout(_mediaSafetyNets.get(requestId));
    const tid = setTimeout(async () => {
      _mediaSafetyNets.delete(requestId);
      try {
        const st = await getState();
        if (!st.isRunning) return;
        const cur = st.queue[st.index];
        if (!cur || cur.requestId !== requestId) return;
        if (cur.status === 'sent' || cur.status === 'failed') return;
        console.warn(`[WHL] ⏱️ Safety net (${kind}): nenhum result em 30s para ${phone}, assumindo sucesso`);
        cur.status = 'sent';
        st.stats.sent++;
        st.stats.pending--;
        st.index++;
        await incrementAntiBanCounter();
        await setState(st);
        await render();
        if (st.isRunning && !st.isPaused && st.index < st.queue.length) {
          const delay = getRandomDelay(st.delayMin, st.delayMax);
          setTimeout(() => processCampaignStepDirect(), delay);
        } else if (st.index >= st.queue.length) {
          st.isRunning = false;
          await setState(st);
          await render();
        }
      } catch (e) {
        console.warn('[WHL] Safety net falhou:', e);
      }
    }, 30000);
    _mediaSafetyNets.set(requestId, tid);
  }
  function _clearMediaSafetyNet(requestId) {
    if (!requestId) return;
    const tid = _mediaSafetyNets.get(requestId);
    if (tid) { clearTimeout(tid); _mediaSafetyNets.delete(requestId); }
  }

  /**
   * Processa campanha usando API direta (sem reload)
   * Envia mensagens via postMessage para wpp-hooks.js
   */
  async function processCampaignStepDirect() {
    const st = await getState();
    
    if (!st.isRunning || st.isPaused) {
      console.log('[WHL] Campanha parada ou pausada');
      return;
    }
    
    if (st.index >= st.queue.length) {
      console.log('[WHL] 🎉 Campanha finalizada!');
      st.isRunning = false;
      await setState(st);
      await render();
      return;
    }
    
    // VERIFICAÇÃO ANTI-BAN: Checar limite antes de enviar
    const antiBanCheck = await canSendAntiBan();
    if (!antiBanCheck.allowed) {
      console.warn('[WHL] ⛔ ANTI-BAN: ' + antiBanCheck.message);
      st.isRunning = false;
      st.isPaused = true;
      await setState(st);
      await render();
      
      // Notificar usuário
      try {
        alert(`⛔ ANTI-BAN: ${antiBanCheck.message}\n\nA campanha foi pausada automaticamente para proteger sua conta.`);
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      return;
    }
    
    const cur = st.queue[st.index];
    
    // Pular números inválidos
    if (cur && cur.valid === false) {
      console.log('[WHL] ⚠️ Número inválido, pulando:', cur.phone);
      cur.status = 'failed';
      cur.errorReason = 'Número inválido';
      st.index++;
      st.stats.failed++;
      st.stats.pending--;
      await setState(st);
      await render();
      scheduleCampaignStepDirect();
      return;
    }
    
    // Pular se não existe
    if (!cur) {
      st.index++;
      await setState(st);
      scheduleCampaignStepDirect();
      return;
    }
    
    // Pular números já processados
    if (cur.status === 'sent') {
      st.index++;
      await setState(st);
      scheduleCampaignStepDirect();
      return;
    }
    
    // Se já falhou e não é para retry, pular
    if (cur.status === 'failed' && !cur.retryPending) {
      st.index++;
      await setState(st);
      scheduleCampaignStepDirect();
      return;
    }
    
    console.log(`[WHL] 📨 Enviando via API validada: ${st.index + 1}/${st.queue.length} - ${cur.phone}`);
    cur.status = 'opened';
    await setState(st);
    await render();
    
    // PR #78: Apply variable substitution - passar objeto completo para ter acesso ao nome
    const messageToSend = substituirVariaveis(st.message || '', cur);
    
    // ATUALIZADO: Usar métodos testados e validados (WHL_SEND_MESSAGE_API e WHL_SEND_IMAGE_DOM)
    const requestId = Date.now().toString();
    
    // CORREÇÃO CRÍTICA: Armazenar requestId e phone no contato para validação posterior
    cur.requestId = requestId;
    cur.targetPhone = cur.phone;
    await setState(st);
    
    if (st.audioData) {
      // Áudio (mensagem de voz) - via WPP Hooks (sem DOM/Store)
      console.log('[WHL] 🎤 Enviando áudio para número específico (via WHL_SEND_AUDIO_DIRECT)...');
      window.postMessage({
        type: 'WHL_SEND_AUDIO_DIRECT',
        phone: cur.phone,
        audioData: st.audioData,
        filename: st.audioFilename || 'voice.ogg',
        // ✅ Quando há texto junto do áudio, enviamos como mensagem separada (antes do PTT)
        text: messageToSend || '',
        requestId
      }, window.location.origin);
      _scheduleMediaSafetyNet('audio', requestId, cur.phone);
    } else if (st.fileData) {
      // Arquivo/Documento - via WPP Hooks (sem DOM/Store)
      console.log('[WHL] 📁 Enviando arquivo para número específico (via WHL_SEND_FILE_DIRECT)...');
      window.postMessage({
        type: 'WHL_SEND_FILE_DIRECT',
        phone: cur.phone,
        fileData: st.fileData,
        filename: st.fileName || 'document',
        // ✅ Para arquivo, o WhatsApp nem sempre mantém "caption". Enviamos o texto como mensagem separada
        // (mesma lógica do áudio) e deixamos a mídia seguir sem legenda.
        text: messageToSend || '',
        caption: '',
        requestId
      }, window.location.origin);
      _scheduleMediaSafetyNet('file', requestId, cur.phone);
    } else if (st.imageData) {
      // Imagem - abre chat e envia via DOM (confirm. visual)
      console.log('[WHL] 📸 Enviando imagem para número específico (via WHL_SEND_IMAGE_TO_NUMBER)...');
      _scheduleMediaSafetyNet('image', requestId, cur.phone);
      window.postMessage({
        type: 'WHL_SEND_IMAGE_TO_NUMBER',
        phone: cur.phone,
        image: st.imageData,
        caption: messageToSend,
        requestId: requestId
      }, window.location.origin);
    } else {
      // Só texto - usar API direta
      console.log('[WHL] 💬 Enviando texto via API interna...');
      window.postMessage({
        type: 'WHL_SEND_MESSAGE_API',
        phone: cur.phone,
        message: messageToSend,
        requestId: requestId
      }, window.location.origin);
    }

// Nota: O resultado será recebido via listener WHL_SEND_MESSAGE_API_RESULT ou WHL_SEND_IMAGE_DOM_RESULT
    // e continuará a campanha automaticamente
  }
  
  function scheduleCampaignStepDirect() {
    if (campaignInterval) clearTimeout(campaignInterval);
    campaignInterval = setTimeout(() => {
      processCampaignStepDirect();
    }, 100);
  }
  
  // ===== INPUT + ENTER CAMPAIGN PROCESSING =====
  
  /**
   * Processa campanha usando método Input + Enter (TESTADO E FUNCIONANDO)
   * Este é o método confirmado pelo usuário que funciona corretamente
   */
  async function processCampaignStepViaInput() {
    const st = await getState();
    
    if (!st.isRunning || st.isPaused) {
      console.log('[WHL] Campanha parada ou pausada');
      return;
    }
    
    if (st.index >= st.queue.length) {
      console.log('[WHL] 🎉 Campanha finalizada!');
      st.isRunning = false;
      await setState(st);
      await render();
      return;
    }
    
    // VERIFICAÇÃO ANTI-BAN: Checar limite antes de enviar
    const antiBanCheck = await canSendAntiBan();
    if (!antiBanCheck.allowed) {
      console.warn('[WHL] ⛔ ANTI-BAN: ' + antiBanCheck.message);
      st.isRunning = false;
      st.isPaused = true;
      await setState(st);
      await render();
      
      // Notificar usuário
      try {
        alert(`⛔ ANTI-BAN: ${antiBanCheck.message}\n\nA campanha foi pausada automaticamente para proteger sua conta.`);
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      return;
    }
    
    const cur = st.queue[st.index];
    
    // Pular números inválidos
    if (cur && cur.valid === false) {
      console.log('[WHL] ⚠️ Número inválido, pulando:', cur.phone);
      cur.status = 'failed';
      cur.errorReason = 'Número inválido';
      st.index++;
      st.stats.failed++;
      st.stats.pending--;
      await setState(st);
      await render();
      scheduleCampaignStepViaInput();
      return;
    }
    
    // Pular se não existe
    if (!cur) {
      st.index++;
      await setState(st);
      scheduleCampaignStepViaInput();
      return;
    }
    
    // Pular números já processados
    if (cur.status === 'sent') {
      st.index++;
      await setState(st);
      scheduleCampaignStepViaInput();
      return;
    }
    
    // Se já falhou e não é para retry, pular
    if (cur.status === 'failed' && !cur.retryPending) {
      st.index++;
      await setState(st);
      scheduleCampaignStepViaInput();
      return;
    }
    
    console.log(`[WHL] 📨 Enviando via Input + Enter: ${st.index + 1}/${st.queue.length} - ${cur.phone}`);
    cur.status = 'opened';
    await setState(st);
    await render();
    
    // Aplicar substituição de variáveis
    const messageToSend = substituirVariaveis(st.message || '', cur);
    
    // Enviar via Input + Enter
    const result = await sendMessageViaInput(cur.phone, messageToSend);
    
    if (result.success) {
      // Sucesso!
      console.log('[WHL] ✅ Mensagem enviada com sucesso para', cur.phone);
      cur.status = 'sent';
      st.stats.sent++;
      st.stats.pending--;
      
      // Incrementar contador do Anti-Ban
      await incrementAntiBanCounter();
    } else {
      // Falha
      console.log('[WHL] ❌ Falha ao enviar para', cur.phone, ':', result.error);
      cur.status = 'failed';
      
      // BUG FIX 1: Categorizar erro - número inexistente vs outros erros
      if (result.errorType === 'INVALID_NUMBER' || result.errorType === 'WRONG_CHAT') {
        cur.errorReason = 'Número inexistente';
      } else {
        cur.errorReason = result.error;
      }
      
      st.stats.failed++;
      st.stats.pending--;
    }
    
    st.index++;
    await setState(st);
    await render();
    
    // Continuar campanha após delay
    if (st.isRunning && !st.isPaused && st.index < st.queue.length) {
      const delay = getRandomDelay(st.delayMin, st.delayMax);
      console.log(`[WHL] ⏳ Aguardando ${(delay/1000).toFixed(1)}s antes do próximo envio...`);
      setTimeout(() => processCampaignStepViaInput(), delay);
    } else if (st.index >= st.queue.length) {
      // Campanha finalizada
      st.isRunning = false;
      await setState(st);
      await render();
      console.log('[WHL] 🎉 Campanha finalizada!');
    }
  }
  
  function scheduleCampaignStepViaInput() {
    if (campaignInterval) clearTimeout(campaignInterval);
    campaignInterval = setTimeout(() => {
      processCampaignStepViaInput();
    }, 100);
  }
  
  // Listener para resultados de envio direto
  // CORREÇÃO MÉDIO: Validação de origem + whitelist de tipos para prevenir XSS via postMessage
  const _ALLOWED_MESSAGE_TYPES = new Set([
    'WHL_SEND_MESSAGE_API_RESULT',
    'WHL_MESSAGE_SENT',
    'WHL_MESSAGE_FAILED',
    'WHL_CAMPAIGN_STATUS',
    'WHL_WORKER_READY',
    'WHL_INIT_RESPONSE',
    'WHL_AI_RESPONSE',
    'WHL_SEND_RESULT',
  ]);

  window.addEventListener('message', async (e) => {
    // CORREÇÃO MÉDIO: Validar origem E tipo — dupla barreira contra XSS via postMessage
    if (!e.origin || e.origin !== window.location.origin) return;
    if (!e.data || typeof e.data !== 'object') return;
    if (!e.data.type || !_ALLOWED_MESSAGE_TYPES.has(e.data.type)) return;

    const { type } = e.data;
    
    // RESULTADO de envio via API validada (WHL_SEND_MESSAGE_API)
    if (type === 'WHL_SEND_MESSAGE_API_RESULT') {
      const st = await getState();
      
      // Verificar se ainda está em uma campanha ativa
      if (!st.isRunning) return;
      
      const cur = st.queue[st.index];
      
      // CORREÇÃO CRÍTICA: Validar requestId para evitar processar resultado de envio antigo
      if (cur && cur.requestId && e.data.requestId && cur.requestId !== e.data.requestId) {
        console.warn('[WHL] ⚠️ RequestId não corresponde - ignorando resultado antigo', {
          expected: cur.requestId,
          received: e.data.requestId,
          currentPhone: cur.phone
        });
        return;
      }
      
      if (cur) {
        if (e.data.success) {
          // API authoritative: sendTextMsgToChat / sendMsgRecord retornaram
          // sem erro, então a mensagem está no Store. Pular o probe visual
          // (10s timeout) — o delay configurado da campanha já espaça envios.
          console.log('[WHL] ✅ Texto enviado (API).');
          cur.status = 'sent';
          st.stats.sent++;
          st.stats.pending--;
          st.index++;
          await incrementAntiBanCounter();
          await setState(st);
          await render();

          if (st.isRunning && !st.isPaused && st.index < st.queue.length) {
            const delay = getRandomDelay(st.delayMin, st.delayMax);
            console.log(`[WHL] ⏳ Aguardando ${(delay/1000).toFixed(1)}s antes do próximo envio...`);
            setTimeout(() => processCampaignStepDirect(), delay);
          } else if (st.index >= st.queue.length) {
            console.log('[WHL] 🎉 Campanha finalizada!');
            st.isRunning = false;
            await setState(st);
            await render();
          }
          return;
        } else {
          // Falha - verificar retry
          console.log('[WHL] ❌ Falha ao enviar texto via API para', cur.phone, ':', e.data.error);
          cur.retries = (cur.retries || 0) + 1;
          
          if (cur.retries >= (st.retryMax || 0)) {
            // Máximo de retries atingido
            cur.status = 'failed';
            cur.errorReason = e.data.error || 'Falha no envio via API';
            cur.retryPending = false;
            st.stats.failed++;
            st.stats.pending--;
            st.index++;
            
            // Se não continuar em erros, parar campanha
            if (!st.continueOnError) {
              console.log('[WHL] ⚠️ Parando campanha devido a erro');
              st.isRunning = false;
              await setState(st);
              await render();
              return;
            }
          } else {
            // Ainda pode tentar novamente
            cur.retryPending = true;
            console.log(`[WHL] 🔄 Tentando novamente (${cur.retries}/${st.retryMax})...`);
          }
        }
        
        await setState(st);
        await render();
        
        // ATUALIZADO: Continuar campanha apenas em caso de FALHA
        // Sucesso agora aguarda confirmação visual antes de continuar
        if (!e.data.success && st.isRunning && !st.isPaused) {
          if (st.index < st.queue.length) {
            const delay = getRandomDelay(st.delayMin, st.delayMax);
            console.log(`[WHL] ⏳ Aguardando ${(delay/1000).toFixed(1)}s antes do próximo envio...`);
            setTimeout(() => processCampaignStepDirect(), delay);
          } else {
            // Campanha finalizada
            console.log('[WHL] 🎉 Campanha finalizada!');
            st.isRunning = false;
            await setState(st);
            await render();
          }
        }
      }
    }
    
    // RESULTADO de envio via DOM (WHL_SEND_IMAGE_DOM)
    if (type === 'WHL_SEND_IMAGE_DOM_RESULT') {
      const st = await getState();
      
      // Verificar se ainda está em uma campanha ativa
      if (!st.isRunning) return;
      
      const cur = st.queue[st.index];
      
      // CORREÇÃO CRÍTICA: Validar requestId para evitar processar resultado de envio antigo
      if (cur && cur.requestId && e.data.requestId && cur.requestId !== e.data.requestId) {
        console.warn('[WHL] ⚠️ RequestId não corresponde - ignorando resultado antigo de imagem', {
          expected: cur.requestId,
          received: e.data.requestId,
          currentPhone: cur.phone
        });
        return;
      }
      
      if (cur) {
        if (e.data.success) {
          // Imagem enviada via DOM (paste+enter já confirma a entrega na UI).
          // Avança direto — o delay da campanha cuida do espaçamento.
          console.log('[WHL] ✅ Imagem enviada (DOM).');
          cur.status = 'sent';
          st.stats.sent++;
          st.stats.pending--;
          st.index++;
          await incrementAntiBanCounter();
          await setState(st);
          await render();

          if (st.isRunning && !st.isPaused && st.index < st.queue.length) {
            const delay = getRandomDelay(st.delayMin, st.delayMax);
            console.log(`[WHL] ⏳ Aguardando ${(delay/1000).toFixed(1)}s antes do próximo envio...`);
            setTimeout(() => processCampaignStepDirect(), delay);
          } else if (st.index >= st.queue.length) {
            console.log('[WHL] 🎉 Campanha finalizada!');
            st.isRunning = false;
            await setState(st);
            await render();
          }
          return;
        } else {
          // Falha - verificar retry
          console.log('[WHL] ❌ Falha ao enviar imagem via DOM para', cur.phone, ':', e.data.error);
          cur.retries = (cur.retries || 0) + 1;
          
          if (cur.retries >= (st.retryMax || 0)) {
            // Máximo de retries atingido
            cur.status = 'failed';
            cur.errorReason = e.data.error || 'Falha no envio de imagem';
            cur.retryPending = false;
            st.stats.failed++;
            st.stats.pending--;
            st.index++;
            
            // Se não continuar em erros, parar campanha
            if (!st.continueOnError) {
              console.log('[WHL] ⚠️ Parando campanha devido a erro');
              st.isRunning = false;
              await setState(st);
              await render();
              return;
            }
          } else {
            // Ainda pode tentar novamente
            cur.retryPending = true;
            console.log(`[WHL] 🔄 Tentando novamente (${cur.retries}/${st.retryMax})...`);
          }
        }
        
        await setState(st);
        await render();
        
        // ATUALIZADO: Continuar campanha apenas em caso de FALHA
        // Sucesso agora aguarda confirmação visual antes de continuar
        if (!e.data.success && st.isRunning && !st.isPaused) {
          if (st.index < st.queue.length) {
            const delay = getRandomDelay(st.delayMin, st.delayMax);
            console.log(`[WHL] ⏳ Aguardando ${(delay/1000).toFixed(1)}s antes do próximo envio...`);
            setTimeout(() => processCampaignStepDirect(), delay);
          } else {
            // Campanha finalizada
            console.log('[WHL] 🎉 Campanha finalizada!');
            st.isRunning = false;
            await setState(st);
            await render();
          }
        }
      }
    }
    
    // CORREÇÃO BUG 2: RESULTADO de envio de imagem para número específico
    if (type === 'WHL_SEND_IMAGE_TO_NUMBER_RESULT') {
      const st = await getState();
      
      // Verificar se ainda está em uma campanha ativa
      if (!st.isRunning) return;
      
      const cur = st.queue[st.index];
      
      // CORREÇÃO CRÍTICA: Validar requestId para evitar processar resultado de envio antigo
      if (cur && cur.requestId && e.data.requestId && cur.requestId !== e.data.requestId) {
        console.warn('[WHL] ⚠️ RequestId não corresponde - ignorando resultado antigo de imagem específica', {
          expected: cur.requestId,
          received: e.data.requestId,
          currentPhone: cur.phone
        });
        return;
      }

      _clearMediaSafetyNet(e.data.requestId);

      if (cur) {
        if (e.data.success) {
          console.log('[WHL] ✅ Imagem enviada para número.');
          cur.status = 'sent';
          st.stats.sent++;
          st.stats.pending--;
          st.index++;
          await incrementAntiBanCounter();
          await setState(st);
          await render();

          if (st.isRunning && !st.isPaused && st.index < st.queue.length) {
            const delay = getRandomDelay(st.delayMin, st.delayMax);
            console.log(`[WHL] ⏳ Aguardando ${(delay/1000).toFixed(1)}s antes do próximo envio...`);
            setTimeout(() => processCampaignStepDirect(), delay);
          } else if (st.index >= st.queue.length) {
            console.log('[WHL] 🎉 Campanha finalizada!');
            st.isRunning = false;
            await setState(st);
            await render();
          }
          return;
        } else {
          // Falha - verificar retry
          console.log('[WHL] ❌ Falha ao enviar imagem para número', cur.phone, ':', e.data.error);
          
          // Se é erro de número inexistente, não tentar novamente
          if (e.data.error === 'Número inexistente') {
            cur.status = 'failed';
            cur.errorReason = 'Número inexistente';
            cur.retryPending = false;
            st.stats.failed++;
            st.stats.pending--;
            st.index++;
            console.log('[WHL] ⚠️ Número inexistente - pulando para próximo');
          } else {
            cur.retries = (cur.retries || 0) + 1;
            
            if (cur.retries >= (st.retryMax || 0)) {
              // Máximo de retries atingido
              cur.status = 'failed';
              cur.errorReason = e.data.error || 'Falha no envio de imagem';
              cur.retryPending = false;
              st.stats.failed++;
              st.stats.pending--;
              st.index++;
              
              // Se não continuar em erros, parar campanha
              if (!st.continueOnError) {
                console.log('[WHL] ⚠️ Parando campanha devido a erro');
                st.isRunning = false;
                await setState(st);
                await render();
                return;
              }
            } else {
              // Ainda pode tentar novamente
              cur.retryPending = true;
              console.log(`[WHL] 🔄 Tentando novamente (${cur.retries}/${st.retryMax})...`);
            }
          }
        }
        
        await setState(st);
        await render();
        
        // Continuar campanha apenas em caso de FALHA
        if (!e.data.success && st.isRunning && !st.isPaused) {
          if (st.index < st.queue.length) {
            const delay = getRandomDelay(st.delayMin, st.delayMax);
            console.log(`[WHL] ⏳ Aguardando ${(delay/1000).toFixed(1)}s antes do próximo envio...`);
            setTimeout(() => processCampaignStepDirect(), delay);
          } else {
            // Campanha finalizada
            console.log('[WHL] 🎉 Campanha finalizada!');
            st.isRunning = false;
            await setState(st);
            await render();
          }
        }
      }
    }
    
    // NOVO: Handler para resultado da confirmação visual
    if (type === 'WHL_VISUAL_CONFIRMATION_RESULT') {
      const st = await getState();
      if (!st.isRunning) return;
      
      const cur = st.queue[st.index];
      if (!cur) return;
      
      // CORREÇÃO ISSUE 01: Sempre avançar quando API retornou sucesso
      // Confiar na API mesmo sem confirmação visual
      if (e.data.confirmed) {
        console.log('[WHL] ✅ Confirmação visual OK!');
        cur.status = 'sent';
      } else {
        // FALLBACK: Mesmo sem confirmação, marcar como enviado se API retornou sucesso
        console.warn('[WHL] ⚠️ Sem confirmação visual, mas API retornou sucesso. Avançando...');
        cur.status = 'sent'; // Confiar na API
      }
      
      st.stats.sent++;
      st.stats.pending--;
      st.index++;
      
      // Incrementar contador do Anti-Ban
      await incrementAntiBanCounter();
      
      await setState(st);
      await render();
      
      // Continuar para próximo
      if (st.isRunning && !st.isPaused && st.index < st.queue.length) {
        const delay = getRandomDelay(st.delayMin, st.delayMax);
        console.log(`[WHL] ⏳ Aguardando ${(delay/1000).toFixed(1)}s antes do próximo envio...`);
        setTimeout(() => processCampaignStepDirect(), delay);
      } else if (st.index >= st.queue.length) {
        console.log('[WHL] 🎉 Campanha finalizada!');
        st.isRunning = false;
        await setState(st);
        await render();
      }
    }
    
    // Resultado de envio de mensagem ou imagem (API antiga)

    // RESULTADO de envio de áudio/arquivo para número específico (WPP Hooks direto)
    if (type === 'WHL_SEND_AUDIO_RESULT' || type === 'WHL_SEND_FILE_RESULT') {
      const st = await getState();

      if (!st.isRunning) return;

      const cur = st.queue[st.index];
      if (!cur) return;

      // v9.6.x: validar requestId — antes não havia validação e resultados
      // de envios anteriores podiam casar com a cur errada (status não atualizava).
      if (cur.requestId && e.data.requestId && cur.requestId !== e.data.requestId) {
        console.warn('[WHL] ⚠️ RequestId de mídia não corresponde — ignorando', {
          expected: cur.requestId,
          received: e.data.requestId
        });
        return;
      }

      // Cancela o safety-net (resultado chegou dentro da janela)
      _clearMediaSafetyNet(e.data.requestId);

      const ok = !!e.data.success;

      if (ok) {
        console.log('[WHL] ✅ Enviado com sucesso para', e.data.phone);
        cur.status = 'sent';
        cur.retries = cur.retries || 0;
        st.stats.sent++;
        st.stats.pending--;
        st.index++;

        // Anti-ban
        await incrementAntiBanCounter();
      } else {
        console.log('[WHL] ❌ Falha ao enviar para', e.data.phone, ':', e.data.error);
        cur.retries = (cur.retries || 0) + 1;

        if (cur.retries >= (st.retryMax || 0)) {
          cur.status = 'failed';
          cur.errorReason = e.data.error || 'Falha no envio de mídia';
          cur.retryPending = false;
          st.stats.failed++;
          st.stats.pending--;
          st.index++;

          if (!st.continueOnError) {
            console.log('[WHL] ⚠️ Parando campanha devido a erro');
            st.isRunning = false;
            await setState(st);
            await render();
            return;
          }
        } else {
          cur.retryPending = true;
          console.log(`[WHL] 🔄 Tentando novamente (${cur.retries}/${st.retryMax})...`);
        }
      }

      await setState(st);
      await render();

      if (st.isRunning && !st.isPaused && st.index < st.queue.length) {
        const delay = getRandomDelay(st.delayMin, st.delayMax);
        console.log(`[WHL] ⏳ Aguardando ${(delay/1000).toFixed(1)}s antes do próximo envio...`);
        setTimeout(() => processCampaignStepDirect(), delay);
      } else if (st.isRunning && st.index >= st.queue.length) {
        console.log('[WHL] 🎉 Campanha finalizada!');
        st.isRunning = false;
        await setState(st);
        await render();
      }
    }

if (type === 'WHL_SEND_MESSAGE_RESULT' || type === 'WHL_SEND_IMAGE_RESULT') {
      const st = await getState();
      
      // Verificar se ainda está em uma campanha ativa
      if (!st.isRunning) return;
      
      const cur = st.queue[st.index];
      
      if (cur && cur.phone === e.data.phone) {
        if (e.data.success) {
          // Sucesso!
          console.log('[WHL] ✅ Mensagem enviada com sucesso via API para', e.data.phone);
          cur.status = 'sent';
          cur.retries = cur.retries || 0;
          st.stats.sent++;
          st.stats.pending--;
          st.index++;
          
          // Incrementar contador do Anti-Ban
          await incrementAntiBanCounter();
        } else {
          // Falha - verificar retry
          console.log('[WHL] ❌ Falha ao enviar via API para', e.data.phone, ':', e.data.error);
          cur.retries = (cur.retries || 0) + 1;
          
          if (cur.retries >= (st.retryMax || 0)) {
            // Máximo de retries atingido
            cur.status = 'failed';
            cur.errorReason = e.data.error || 'Falha no envio via API';
            cur.retryPending = false;
            st.stats.failed++;
            st.stats.pending--;
            st.index++;
            
            // Se não continuar em erros, parar campanha
            if (!st.continueOnError) {
              console.log('[WHL] ⚠️ Parando campanha devido a erro');
              st.isRunning = false;
              await setState(st);
              await render();
              return;
            }
          } else {
            // Ainda pode tentar novamente
            cur.retryPending = true;
            console.log(`[WHL] 🔄 Tentando novamente (${cur.retries}/${st.retryMax})...`);
          }
        }
        
        await setState(st);
        await render();
        
        // Continuar campanha após delay
        if (st.isRunning && !st.isPaused && st.index < st.queue.length) {
          const delay = getRandomDelay(st.delayMin, st.delayMax);
          console.log(`[WHL] ⏳ Aguardando ${(delay/1000).toFixed(1)}s antes do próximo envio...`);
          setTimeout(() => processCampaignStepDirect(), delay);
        } else if (st.index >= st.queue.length) {
          // Campanha finalizada
          st.isRunning = false;
          await setState(st);
          await render();
          console.log('[WHL] 🎉 Campanha finalizada!');
        }
      }
    }
    
    // Resultado de extração direta
    if (type === 'WHL_EXTRACT_ALL_RESULT') {
      console.log('[WHL] ✅ Extração via API concluída:', e.data);
      
      // Atualizar campos de extração
      const normalBox = document.getElementById('whlExtractedNumbers');
      const archivedBox = document.getElementById('whlArchivedNumbers');
      const blockedBox = document.getElementById('whlBlockedNumbers');
      
      if (normalBox && e.data.normal) {
        normalBox.value = e.data.normal.join('\n');
      }
      if (archivedBox && e.data.archived) {
        archivedBox.value = e.data.archived.join('\n');
      }
      if (blockedBox && e.data.blocked) {
        blockedBox.value = e.data.blocked.join('\n');
      }
      
      // Atualizar contadores
      const normalCount = document.getElementById('whlNormalCount');
      const archivedCount = document.getElementById('whlArchivedCount');
      const blockedCount = document.getElementById('whlBlockedCount');
      
      if (normalCount) normalCount.textContent = e.data.normal?.length || 0;
      if (archivedCount) archivedCount.textContent = e.data.archived?.length || 0;
      if (blockedCount) blockedCount.textContent = e.data.blocked?.length || 0;
      
      const statusEl = document.getElementById('whlExtractStatus');
      if (statusEl) {
        const total = (e.data.normal?.length || 0) + 
                      (e.data.archived?.length || 0) + 
                      (e.data.blocked?.length || 0);
        statusEl.textContent = `✅ ${total} contatos extraídos via API direta (instantâneo)`;
      }
    }
    
    if (type === 'WHL_EXTRACT_ALL_ERROR') {
      console.error('[WHL] ❌ Erro na extração via API:', e.data.error);
      const statusEl = document.getElementById('whlExtractStatus');
      if (statusEl) {
        statusEl.textContent = `❌ Erro: ${e.data.error}`;
      }
    }
  });

  // Loop da campanha via URL (substituindo modo DOM)
  async function processCampaignStepViaDom() {
    const st = await getState();
    
    if (!st.isRunning || st.isPaused) {
      console.log('[WHL] Campanha parada ou pausada');
      return;
    }
    
    if (st.index >= st.queue.length) {
      console.log('[WHL] 🎉 Campanha finalizada!');
      st.isRunning = false;
      await setState(st);
      await render();
      return;
    }
    
    // VERIFICAÇÃO ANTI-BAN: Checar limite antes de enviar
    const antiBanCheck = await canSendAntiBan();
    if (!antiBanCheck.allowed) {
      console.warn('[WHL] ⛔ ANTI-BAN: ' + antiBanCheck.message);
      st.isRunning = false;
      st.isPaused = true;
      await setState(st);
      await render();
      
      // Notificar usuário
      try {
        alert(`⛔ ANTI-BAN: ${antiBanCheck.message}\n\nA campanha foi pausada automaticamente para proteger sua conta.`);
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      return;
    }
    
    const cur = st.queue[st.index];
    
    // Pular números inválidos
    if (cur && cur.valid === false) {
      console.log('[WHL] ⚠️ Número inválido, pulando:', cur.phone);
      cur.status = 'failed';
      st.index++;
      await setState(st);
      await render();
      scheduleCampaignStepViaDom();
      return;
    }
    
    // Pular se não existe
    if (!cur) {
      st.index++;
      await setState(st);
      scheduleCampaignStepViaDom();
      return;
    }
    
    // Pular números já processados (enviados ou falhados finais)
    if (cur.status === 'sent') {
      st.index++;
      await setState(st);
      scheduleCampaignStepViaDom();
      return;
    }
    
    // Se já falhou e não é para retry, pular
    if (cur.status === 'failed' && !cur.retryPending) {
      st.index++;
      await setState(st);
      scheduleCampaignStepViaDom();
      return;
    }
    
    console.log(`[WHL] Processando ${st.index + 1}/${st.queue.length}: ${cur.phone}`);
    cur.status = 'opened';
    await setState(st);
    await render();
    
    // Aplicar substituição de variáveis
    const messageToSend = substituirVariaveis(st.message || '', cur);
    
    // Enviar via URL (isso vai causar reload da página)
    await sendMessageViaURL(cur.phone, messageToSend);
    
    // NOTA: A função sendMessageViaURL causa um reload da página
    // A continuação do envio acontece em checkAndResumeCampaignAfterURLNavigation()
  }

  function scheduleCampaignStepViaDom() {
    if (campaignInterval) clearTimeout(campaignInterval);
    campaignInterval = setTimeout(() => {
      processCampaignStepViaDom();
    }, 100);
  }

  // PR #78: Store scheduled timeout ID for cancellation
  let scheduledCampaignTimeout = null;
  
  // Item 9: WhatsApp disconnect detector
  let disconnectCheckInterval = null;
  
  function isWhatsAppConnected() {
    // Check for common disconnect indicators in WhatsApp Web
    // 1. Check for QR code (not logged in)
    const qrCode = document.querySelector('canvas[aria-label*="QR"]') || 
                   document.querySelector('[data-ref="qr-code"]');
    if (qrCode) {
      whlLog.warn('WhatsApp desconectado: QR Code detectado');
      return false;
    }
    
    // 2. Check for connection issues banner
    const connectionBanner = document.querySelector('[data-testid="alert-phone-connection"]') ||
                             document.querySelector('[role="banner"]');
    if (connectionBanner && connectionBanner.textContent.toLowerCase().includes('conectando')) {
      whlLog.warn('WhatsApp desconectado: Banner de conexão detectado');
      return false;
    }
    
    // 3. Check if there's a retry button (connection lost)
    const retryButton = document.querySelector('button[aria-label*="Tentar"]') ||
                        document.querySelector('button[aria-label*="Retry"]');
    if (retryButton) {
      whlLog.warn('WhatsApp desconectado: Botão de retry detectado');
      return false;
    }
    
    return true;
  }
  
  function startDisconnectMonitor() {
    // Item 9: Monitor WhatsApp connection during campaign
    if (disconnectCheckInterval) {
      clearInterval(disconnectCheckInterval);
    }
    
    disconnectCheckInterval = setInterval(async () => {
      const st = await getState();
      
      if (!st.isRunning || st.isPaused) {
        // Campaign not running, stop monitoring
        if (disconnectCheckInterval) {
          clearInterval(disconnectCheckInterval);
          disconnectCheckInterval = null;
        }
        return;
      }
      
      if (!isWhatsAppConnected()) {
        whlLog.warn('⚠️ Desconexão detectada! Pausando campanha...');
        await pauseCampaign();
        alert('⚠️ WhatsApp desconectado!\n\nA campanha foi pausada automaticamente.\nReconecte ao WhatsApp e clique em "Iniciar Campanha" para continuar.');
        
        // Stop monitoring until campaign is resumed
        if (disconnectCheckInterval) {
          clearInterval(disconnectCheckInterval);
          disconnectCheckInterval = null;
        }
      }
    }, 5000); // Check every 5 seconds
    
    // Registrar para cleanup global
    if (window.__whlIntervals) window.__whlIntervals.push(disconnectCheckInterval);
  }
  
  async function startCampaign() {
    const st = await getState();
    
    if (st.queue.length === 0) {
      alert('Por favor, adicione números e gere a tabela primeiro!');
      return;
    }

    if (st.isRunning) {
      console.log('[WHL] Campaign already running');
      return;
    }

    // PR #78: Check if scheduling is enabled
    if (st.scheduleAt) {
      const scheduledTime = new Date(st.scheduleAt);
      const now = new Date();
      
      // Validate the date
      if (isNaN(scheduledTime.getTime())) {
        console.error('[WHL] Invalid schedule date:', st.scheduleAt);
        alert('⚠️ Data de agendamento inválida. Por favor, defina uma data válida.');
        return;
      }
      
      if (scheduledTime > now) {
        const delayMs = scheduledTime - now;
        const delayMinutes = Math.round(delayMs / 60000);
        
        console.log(`[WHL] 📅 Campanha agendada para ${scheduledTime.toLocaleString('pt-BR')}`);
        console.log(`[WHL] ⏰ Aguardando ${delayMinutes} minutos...`);
        
        alert(`✅ Campanha agendada!\nInício: ${scheduledTime.toLocaleString('pt-BR')}\nAguardando ${delayMinutes} minutos...`);
        
        // Cancel any previous scheduled campaign
        if (scheduledCampaignTimeout) {
          clearTimeout(scheduledCampaignTimeout);
        }
        
        // Schedule the start and store the timeout ID
        scheduledCampaignTimeout = setTimeout(() => {
          startCampaignNow();
          scheduledCampaignTimeout = null;
        }, delayMs);
        
        return;
      } else {
        console.log('[WHL] ⚠️ Horário agendado já passou, iniciando imediatamente');
      }
    }
    
    // Start immediately
    startCampaignNow();
  }
  
  async function startCampaignNow() {
    const st = await getState();

    // Calculate stats
    st.stats.sent = st.queue.filter(c => c.status === 'sent').length;
    st.stats.failed = st.queue.filter(c => c.status === 'failed').length;
    st.stats.pending = st.queue.filter(c => c.status === 'pending' || c.status === 'opened').length;

    st.isRunning = true;
    st.isPaused = false;
    await setState(st);
    await render();

    whlLog.info('🚀 Campanha iniciada');
    
    // Item 9: Start disconnect monitoring
    startDisconnectMonitor();
    
    // ATUALIZADO: Usar métodos API validados (SEM reload)
    if (WHL_CONFIG.USE_DIRECT_API) {
      whlLog.info('📡 Usando API validada (enviarMensagemAPI e enviarImagemDOM) - SEM RELOAD!');
      processCampaignStepDirect();
    } else if (WHL_CONFIG.USE_INPUT_ENTER_METHOD) {
      whlLog.info('🔧 Using Input + Enter method for sending');
      processCampaignStepViaInput();
    } else {
      whlLog.info('🔗 Usando modo URL (com reload)');
      processCampaignStepViaDom();
    }
  }

  // DISABLED: Hidden Worker Tab function (não funciona) - REMOVED

  async function pauseCampaign() {
    console.log('[WHL] 🔸 Botão PAUSAR clicado');
    const st = await getState();
    
    if (st.isPaused) {
      // Retomar
      console.log('[WHL] ▶️ Retomando campanha...');
      st.isPaused = false;
      await setState(st);
      await render();
      
      // DISABLED: Worker mode não funciona
      if (st.useWorker) {
        console.log('[WHL] ⚠️ Worker mode disabled - usando Input + Enter');
        // Don't use worker
      }
      
      // Continuar processamento de onde parou
      if (st.isRunning) {
        // Usar o mesmo modo configurado
        if (WHL_CONFIG.USE_INPUT_ENTER_METHOD) {
          scheduleCampaignStepViaInput();
        } else if (WHL_CONFIG.USE_DIRECT_API) {
          scheduleCampaignStepDirect();
        } else {
          scheduleCampaignStepViaDom();
        }
      }
    } else {
      // Pausar
      console.log('[WHL] ⏸️ Pausando campanha...');
      st.isPaused = true;
      await setState(st);
      await render();
      
      // DISABLED: Worker mode não funciona
      if (st.useWorker) {
        console.log('[WHL] ⚠️ Worker mode disabled');
        // Don't use worker
      }
      
      // Limpar interval para parar o loop
      if (campaignInterval) {
        clearTimeout(campaignInterval);
        campaignInterval = null;
      }
    }
  }

  async function stopCampaign() {
    const st = await getState();
    st.isRunning = false;
    st.isPaused = false;
    await setState(st);
    await render();

    // DISABLED: Worker mode não funciona
    if (st.useWorker) {
      console.log('[WHL] ⚠️ Worker mode disabled');
      // Don't use worker
    }

    if (campaignInterval) {
      clearTimeout(campaignInterval);
      campaignInterval = null;
    }
    
    // PR #78: Cancel scheduled campaign if exists
    if (scheduledCampaignTimeout) {
      clearTimeout(scheduledCampaignTimeout);
      scheduledCampaignTimeout = null;
      console.log('[WHL] Scheduled campaign cancelled');
    }

    console.log('[WHL] Campaign stopped');
  }

  // ===== RENDER & UI =====

  async function render() {
    const panel = ensurePanel();
    const state = await getState();

    // visibility
    panel.style.display = state.panelVisible ? 'block' : 'none';

    const numbersEl = document.getElementById('whlNumbers');
    const msgEl = document.getElementById('whlMsg');
    const delayMinEl = document.getElementById('whlDelayMin');
    const delayMaxEl = document.getElementById('whlDelayMax');

    if (numbersEl && numbersEl.value !== state.numbersText) numbersEl.value = state.numbersText;
    if (msgEl && msgEl.value !== state.message) msgEl.value = state.message;
    if (delayMinEl) delayMinEl.value = state.delayMin;
    if (delayMaxEl) delayMaxEl.value = state.delayMax;
    
    // PR #78: Removed obsolete settings (continueOnError, retryMax, useWorker)
    const schedEl = document.getElementById('whlScheduleAt');
    if (schedEl && (schedEl.value||'') !== (state.scheduleAt||'')) schedEl.value = state.scheduleAt || '';
    
    // Preview
    const curp = state.queue[state.index];
    const phone = curp?.phone || '';
    const imgEl = document.getElementById('whlPreviewImg');
    const textEl = document.getElementById('whlPreviewText');
    const timeEl = document.getElementById('whlPreviewMeta');

    // mensagem final (se CSV tiver customMessage, use)
    const msgFinal = (curp?.customMessage || state.message || '').replace('{phone}', phone);

    if (textEl) textEl.textContent = msgFinal || '';
    if (imgEl) {
      if (state.imageData) {
        imgEl.src = state.imageData;
        imgEl.style.display = 'block';
      } else {
        imgEl.removeAttribute('src');
        imgEl.style.display = 'none';
      }
    }

    if (timeEl) {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2,'0');
      const mm = String(d.getMinutes()).padStart(2,'0');
      timeEl.textContent = `${hh}:${mm}`;
    }


    // Image hint
    const ih = document.getElementById('whlImageHint');
    const selectImageBtn = document.getElementById('whlSelectImageBtn');
    const clearImageBtn = document.getElementById('whlClearImageBtn');
    if (ih) {
      if (state.imageData) {
        ih.textContent = '✅ Imagem anexada e pronta para envio';
        ih.style.color = '#78ffa0';
        if (clearImageBtn) clearImageBtn.style.display = '';
        if (selectImageBtn) selectImageBtn.textContent = '📎 Trocar Imagem';
      } else {
        ih.textContent = '';
        if (clearImageBtn) clearImageBtn.style.display = 'none';
        if (selectImageBtn) selectImageBtn.textContent = '📎 Anexar Imagem';
      }
    }
    // Selector health
    const sh = document.getElementById('whlSelectorHealth');
    if (sh) sh.innerHTML = '';


    // Update status badge
    const statusBadge = document.getElementById('whlStatusBadge');
    if (statusBadge) {
      statusBadge.className = 'status-badge';
      if (state.isRunning && !state.isPaused) {
        statusBadge.textContent = 'Enviando...';
        statusBadge.classList.add('running');
      } else if (state.isPaused) {
        statusBadge.textContent = 'Pausado';
        statusBadge.classList.add('paused');
      } else {
        statusBadge.textContent = 'Parado';
        statusBadge.classList.add('stopped');
      }
    }

    // Update statistics
    const sent = state.queue.filter(c => c.status === 'sent').length;
    const failed = state.queue.filter(c => c.status === 'failed').length;
    const pending = state.queue.filter(c => c.status === 'pending' || c.status === 'opened' || c.status === 'confirming' || c.status === 'pending_retry').length;

    document.getElementById('whlStatSent').textContent = sent;
    document.getElementById('whlStatFailed').textContent = failed;
    document.getElementById('whlStatPending').textContent = pending;

    // Update progress bar
    const total = state.queue.length;
    const completed = sent + failed;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    document.getElementById('whlProgressFill').style.width = `${percentage}%`;
    document.getElementById('whlProgressText').textContent = `${percentage}% (${completed}/${total})`;
    
    // Item 18: Calculate and display estimated time
    const estimatedTimeEl = document.getElementById('whlEstimatedTime');
    if (estimatedTimeEl && state.isRunning && pending > 0) {
      const avgDelay = (state.delayMin + state.delayMax) / 2;
      const estimatedSeconds = pending * avgDelay;
      const estimatedMinutes = Math.ceil(estimatedSeconds / 60);
      
      if (estimatedMinutes > 60) {
        const hours = Math.floor(estimatedMinutes / 60);
        const mins = estimatedMinutes % 60;
        estimatedTimeEl.textContent = `⏱️ Tempo estimado: ${hours}h ${mins}min`;
      } else {
        estimatedTimeEl.textContent = `⏱️ Tempo estimado: ${estimatedMinutes} min`;
      }
    } else if (estimatedTimeEl) {
      estimatedTimeEl.textContent = '';
    }

    document.getElementById('whlMeta').textContent = `${state.queue.length} contato(s) • posição: ${Math.min(state.index+1, Math.max(1,state.queue.length))}/${Math.max(1,state.queue.length)}`;

    const tb = document.getElementById('whlTable');
    tb.innerHTML = '';

    state.queue.forEach((c, i) => {
      const tr = document.createElement('tr');
      const pill = c.status || 'pending';
      
      // Highlight current item
      if (i === state.index && state.isRunning) {
        tr.classList.add('current');
        tr.id = 'whl-current-row'; // Item 13: ID for auto-scroll
      }
      
      const safePhone = escapeHtml(c.phone);
      const safePill = escapeHtml(pill);
      tr.innerHTML = `
        <td>${i+1}</td>
        <td><span class="tip" data-tip="${c.valid===false ? 'Número inválido (8 a 15 dígitos). Ex: 5511999998888' : ''}">${safePhone}${c.valid===false ? ' ⚠️' : ''}</span></td>
        <td><span class="pill ${safePill}">${c.valid===false ? 'invalid' : safePill}</span></td>
        <td>
          <button data-act="del" data-i="${i}" style="margin:0;padding:6px 10px;border-radius:10px">X</button>
        </td>
      `;
      tb.appendChild(tr);
    });
    
    // Item 13: Auto-scroll to highlight current row in table
    if (state.isRunning && state.index >= 0) {
      setTimeout(() => {
        const currentRow = document.getElementById('whl-current-row');
        if (currentRow) {
          currentRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }

    tb.querySelectorAll('button').forEach(btn => {
      btn.onclick = async () => {
        const i = Number(btn.dataset.i);
        const act = btn.dataset.act;
        const st = await getState();
        if (!st.queue[i]) return;
        if (act === 'del') {
          st.queue.splice(i,1);
          if (st.index >= st.queue.length) st.index = Math.max(0, st.queue.length-1);
          await setState(st);
          await render();
        }
      };
    });

    document.getElementById('whlHint').textContent = 'Modo automático via URL: configure os delays e clique em "Iniciar Campanha"';

    const cur = state.queue[state.index];
    if (state.isRunning && !state.isPaused) {
      document.getElementById('whlStatus').innerHTML = cur
        ? `Enviando para: <b>${escapeHtml(cur.phone)}</b>`
        : 'Processando...';
    } else if (state.isPaused) {
      document.getElementById('whlStatus').innerHTML = 'Campanha pausada. Clique em "Pausar" novamente para continuar.';
    } else {
      document.getElementById('whlStatus').innerHTML = cur
        ? `Próximo: <b>${escapeHtml(cur.phone)}</b>. Clique em "Iniciar Campanha" para começar.`
        : 'Fila vazia. Cole números e clique "Gerar tabela".';
    }

    // Enable/disable buttons based on campaign state
    const startBtn = document.getElementById('whlStartCampaign');
    const pauseBtn = document.getElementById('whlPauseCampaign');
    const stopBtn = document.getElementById('whlStopCampaign');

    if (startBtn) {
      startBtn.disabled = state.isRunning && !state.isPaused;
      startBtn.style.opacity = startBtn.disabled ? '0.5' : '1';
    }
    if (pauseBtn) {
      pauseBtn.disabled = !state.isRunning;
      pauseBtn.style.opacity = pauseBtn.disabled ? '0.5' : '1';
      pauseBtn.textContent = state.isPaused ? '▶️ Retomar' : '⏸️ Pausar';
    }
    if (stopBtn) {
      stopBtn.disabled = !state.isRunning;
      stopBtn.style.opacity = stopBtn.disabled ? '0.5' : '1';
    }
  }

  // PR #78: Function to update message preview in real-time
  function updateMessagePreview() {
    try {
      const previewEl = document.getElementById('whlPreviewText');
      const messageEl = document.getElementById('whlMsg');
      
      if (!previewEl || !messageEl) return;
      
      const message = messageEl.value || '';
      
      // Replace variables with highlighted placeholders
      const previewHTML = message
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
        .replace(/{{nome}}/gi, '<span style="background:rgba(111,0,255,0.3);padding:2px 6px;border-radius:4px;color:#fff">[Nome]</span>')
        .replace(/{{first_name}}/gi, '<span style="background:rgba(111,0,255,0.3);padding:2px 6px;border-radius:4px;color:#fff">[Primeiro Nome]</span>')
        .replace(/{{last_name}}/gi, '<span style="background:rgba(111,0,255,0.3);padding:2px 6px;border-radius:4px;color:#fff">[Último Nome]</span>')
        .replace(/{{phone}}/gi, '<span style="background:rgba(111,0,255,0.3);padding:2px 6px;border-radius:4px;color:#fff">[Telefone]</span>')
        .replace(/{{email}}/gi, '<span style="background:rgba(111,0,255,0.3);padding:2px 6px;border-radius:4px;color:#fff">[Email]</span>');
      
      previewEl.innerHTML = previewHTML;
      
      // Update time
      const timeEl = document.getElementById('whlPreviewMeta');
      if (timeEl) {
        const d = new Date();
        const hh = String(d.getHours()).padStart(2,'0');
        const mm = String(d.getMinutes()).padStart(2,'0');
        timeEl.textContent = `${hh}:${mm}`;
      }
    } catch (e) {
      console.error('[WHL] Erro ao atualizar preview:', e);
    }
  }

  async function buildQueueFromInputs() {
    const st = await getState();
    st.numbersText = document.getElementById('whlNumbers').value || '';
    st.message = document.getElementById('whlMsg').value || '';

    const rawNums = (st.numbersText||'').split(/\r?\n/).map(n => whlSanitize(n)).filter(n => n.length >= 8);
    
    // Item 8: Track invalid and duplicate numbers for display
    const invalidNumbers = [];
    const duplicateNumbers = [];
    
    // FILTRAGEM DE DUPLICATAS COM NORMALIZAÇÃO
    const uniqueNums = [];
    const seen = new Set();
    let duplicatesRemoved = 0;
    
    for (const num of rawNums) {
      // Normalizar: adicionar 55 se for número brasileiro sem código
      let normalized = num.replace(/\D/g, '');
      if (normalized.length === 10 || normalized.length === 11) {
        normalized = '55' + normalized;
      }
      
      // Item 8: Check if number is invalid (less than 10 digits)
      if (!whlIsValidPhone(normalized)) {
        invalidNumbers.push(num);
      }
      
      // Verificar duplicata (considerando versões com e sem 55)
      const without55 = normalized.startsWith('55') && normalized.length >= 12 
        ? normalized.substring(2) 
        : normalized;
      
      if (seen.has(normalized) || seen.has(without55)) {
        duplicatesRemoved++;
        duplicateNumbers.push(num);
        whlLog.debug('Duplicata removida:', num);
        continue;
      }
      
      seen.add(normalized);
      seen.add(without55);
      uniqueNums.push(normalized);
    }
    
    // Criar fila com números únicos
    st.queue = uniqueNums.map(n => ({ 
      phone: n, 
      status: whlIsValidPhone(n) ? 'pending' : 'failed', 
      valid: whlIsValidPhone(n), 
      retries: 0 
    }));
    
    st.index = 0;
    st.stats = { sent: 0, failed: 0, pending: uniqueNums.length };
    
    await setState(st);
    await render();
    
    // Item 8: Display detailed validation feedback
    const hintEl = document.getElementById('whlHint');
    if (hintEl) {
      let message = `✅ ${uniqueNums.length} números únicos carregados`;
      
      if (duplicatesRemoved > 0) {
        message += `\n⚠️ ${duplicatesRemoved} duplicata(s) removida(s)`;
        if (duplicateNumbers.length <= 5) {
          message += `: ${duplicateNumbers.join(', ')}`;
        }
      }
      
      if (invalidNumbers.length > 0) {
        message += `\n❌ ${invalidNumbers.length} número(s) inválido(s) (menos de 10 dígitos)`;
        if (invalidNumbers.length <= 5) {
          message += `: ${invalidNumbers.join(', ')}`;
        }
      }
      
      hintEl.textContent = message;
      hintEl.style.color = invalidNumbers.length > 0 || duplicatesRemoved > 0 ? '#fbbf24' : '#4ade80';
      hintEl.style.whiteSpace = 'pre-line';
    }
  }

  async function skip() {
    const st = await getState();
    if (!st.queue.length) return;
    
    const cur = st.queue[st.index];
    if (cur) {
      cur.status = 'failed';
      // Stats will be recalculated by render() from queue status
    }
    
    st.index++;
    if (st.index >= st.queue.length) st.index = Math.max(0, st.queue.length - 1);
    await setState(st);
    await render();
  }

  async function wipe() {
    if (campaignInterval) {
      clearTimeout(campaignInterval);
      campaignInterval = null;
    }
    
    await setState({
      numbersText: '',
      message: '',
      queue: [],
      index: 0,
      openInNewTab: false,
      panelVisible: false,
      isRunning: false,
      isPaused: false,
      delayMin: 2,
      delayMax: 6,
      continueOnError: true,
      stats: { sent: 0, failed: 0, pending: 0 }
    });
    await render();
  }

  async function bindOnce() {
    ensurePanel();

    // Tab switching functionality
    document.querySelectorAll('.whl-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        // Remover active de todas as tabs
        document.querySelectorAll('.whl-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.whl-tab-content').forEach(c => c.classList.remove('active'));
        
        // Adicionar active na tab clicada
        tab.classList.add('active');
        const tabId = tab.dataset.tab;
        document.getElementById(`whl-tab-${tabId}`).classList.add('active');
      });
    });

    
