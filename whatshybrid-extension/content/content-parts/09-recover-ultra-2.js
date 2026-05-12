/**
 * @file content/content-parts/09-recover-ultra-2.js
 * @description Slice 8501-9581 do content.js original (refactor v9.0.0)
 * @lines 1081
 */

        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }
    
    console.log('[WHL] ❌ Botão de anexar não encontrado');
    return null;
  }


  // ===== IMAGE AUTO SEND (FROM ORIGINAL) =====
  function getImageInput() {
    // Seletores para input de imagem
    const inputs = [
      'input[accept*="image"]',
      'input[type="file"][accept*="image/*"]',
      'input[type="file"]'
    ];
    
    for (const sel of inputs) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    
    return null;
  }


  // ===== IMAGE AUTO SEND (FROM ORIGINAL) =====
  async function sendImage(imageData, captionText, useTypingEffect) {
    console.log('[WHL] 📸 Sending image');
    let captionApplied = false;

    try {
      // Convert base64 to blob
      const response = await fetch(imageData);
      const blob = await response.blob();

      // Create file
      const file = new File([blob], 'image.jpg', { type: blob.type });

      // Find attach button
      const attachBtn = getAttachButton();
      if (!attachBtn) {
        console.log('[WHL] ❌ Attach button not found');
        return { ok: false, captionApplied };
      }

      // Click attach
      attachBtn.click();
      await new Promise(r => setTimeout(r, 500));

      // Find image input
      const imageInput = getImageInput();
      if (!imageInput) {
        console.log('[WHL] ❌ Image input not found');
        return { ok: false, captionApplied };
      }

      // Create DataTransfer and set file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      imageInput.files = dataTransfer.files;

      // Trigger change event
      imageInput.dispatchEvent(new Event('change', { bubbles: true }));

      console.log('[WHL] ✅ Image attached, waiting for preview');
      await new Promise(r => setTimeout(r, 1300));

      const cap = String(captionText || '').trim();
      if (cap) {
        let capBox = null;
        const capSelectors = [
          'div[aria-label*="legenda"][contenteditable="true"]',
          'div[aria-label*="Legenda"][contenteditable="true"]',
          'div[aria-label*="Adicionar"][contenteditable="true"]',
          'div[aria-label*="caption"][contenteditable="true"]',
          'div[aria-label*="Caption"][contenteditable="true"]'
        ];
        const start = Date.now();
        while (Date.now() - start < 6000 && !capBox) {
          for (const sel of capSelectors) {
            const el = document.querySelector(sel);
            if (el && el.getAttribute('data-tab') !== '3') { capBox = el; break; }
          }
          if (!capBox) await new Promise(r => setTimeout(r, 250));
        }

        if (capBox) {
          capBox.focus();
          await new Promise(r => setTimeout(r, 120));
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          await new Promise(r => setTimeout(r, 80));

          if (useTypingEffect) {
            for (const ch of cap) {
              // Handle newlines with Shift+Enter
              if (ch === '\n') {
                capBox.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Enter',
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                  shiftKey: true,
                  bubbles: true,
                  cancelable: true
                }));
                await new Promise(r => setTimeout(r, 30));
              } else {
                document.execCommand('insertText', false, ch);
                capBox.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(r => setTimeout(r, 18));
              }
            }
          } else {
            // Fast mode - process line by line to preserve \n
            const lines = cap.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (i > 0) {
                // Insert line break with Shift+Enter
                capBox.dispatchEvent(new KeyboardEvent('keydown', {
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
                capBox.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
          }

          captionApplied = true;
          console.log('[WHL] ✅ Caption typed in preview');
          await new Promise(r => setTimeout(r, 250));
        } else {
          console.log('[WHL] ⚠️ Caption box not found; will try sending text after media');
        }
      }

      // Find and click send button in image preview
      const sendBtn = findSendButton();

      if (sendBtn) {
        sendBtn.click();
        console.log('[WHL] ✅ Image sent');
        return { ok: true, captionApplied };
      } else {
        console.log('[WHL] ❌ Send button not found in preview');
        return { ok: false, captionApplied };
      }
    } catch (error) {
      console.error('[WHL] ❌ Error sending image:', error);
      return { ok: false, captionApplied: false };
    }
  }

  /**
   * Send audio file as PTT (Push To Talk)
   * Replicates the flow of sendImage() but for audio files
   */
  async function sendAudioAsPTT(audioData, captionText) {
    console.log('[WHL] 🎵 Sending audio as PTT');

    try {
      // Convert base64 to blob
      const response = await fetch(audioData);
      const blob = await response.blob();

      // Determine MIME type and extension
      let mimeType = blob.type || 'audio/ogg';
      let extension = 'ogg';
      
      if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
        extension = 'mp3';
        mimeType = 'audio/mpeg';
      } else if (mimeType.includes('wav')) {
        extension = 'wav';
        mimeType = 'audio/wav';
      } else if (mimeType.includes('m4a') || mimeType.includes('mp4')) {
        extension = 'm4a';
        mimeType = 'audio/mp4';
      }

      // Create file
      const file = new File([blob], `audio.${extension}`, { type: mimeType });

      // Find attach button
      const attachBtn = document.querySelector('[data-testid="attach-clip"]') ||
                        document.querySelector('[data-testid="clip"]') ||
                        document.querySelector('span[data-icon="attach-menu-plus"]')?.closest('button') ||
                        document.querySelector('span[data-icon="clip"]')?.closest('button') ||
                        document.querySelector('[aria-label="Anexar"]') ||
                        document.querySelector('[title="Anexar"]');
      
      if (!attachBtn) {
        console.log('[WHL] ❌ Attach button not found');
        return { ok: false };
      }

      // Click attach
      attachBtn.click();
      await new Promise(r => setTimeout(r, 800));

      // Find and click audio/document option in menu
      const audioMenuBtn = document.querySelector('[aria-label*="Áudio"]') ||
                           document.querySelector('[aria-label*="Audio"]') ||
                           document.querySelector('span[data-icon="audio"]')?.closest('button') ||
                           document.querySelector('li[title*="Áudio"]') ||
                           document.querySelector('li[title*="Audio"]');
      
      if (audioMenuBtn) {
        audioMenuBtn.click();
        await new Promise(r => setTimeout(r, 500));
      } else {
        // Fallback: try document option
        const docMenuBtn = document.querySelector('[aria-label*="Documento"]') ||
                           document.querySelector('[aria-label*="Document"]') ||
                           document.querySelector('span[data-icon="document"]')?.closest('button');
        
        if (docMenuBtn) {
          docMenuBtn.click();
          await new Promise(r => setTimeout(r, 500));
        } else {
          console.log('[WHL] ⚠️ Audio/Document menu option not found, trying direct input');
        }
      }

      // Find audio input
      const audioInput = document.querySelector('input[accept*="audio"]') ||
                         document.querySelector('input[type="file"][accept*="*"]');
      
      if (!audioInput) {
        console.log('[WHL] ❌ Audio input not found');
        return { ok: false };
      }

      // Create DataTransfer and set file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      audioInput.files = dataTransfer.files;

      // Trigger change event
      audioInput.dispatchEvent(new Event('change', { bubbles: true }));

      console.log('[WHL] ✅ Audio attached, waiting for preview');
      await new Promise(r => setTimeout(r, 1500));

      // Add caption if provided
      if (captionText && captionText.trim()) {
        const cap = captionText.trim();
        let capBox = null;
        const capSelectors = [
          'div[aria-label*="legenda"][contenteditable="true"]',
          'div[aria-label*="Legenda"][contenteditable="true"]',
          'div[aria-label*="Adicionar"][contenteditable="true"]',
          'div[aria-label*="caption"][contenteditable="true"]',
          'div[aria-label*="Caption"][contenteditable="true"]',
          'footer div[contenteditable="true"]'
        ];
        
        const start = Date.now();
        while (Date.now() - start < 6000 && !capBox) {
          for (const sel of capSelectors) {
            const el = document.querySelector(sel);
            if (el && el.getAttribute('data-tab') !== '3') { 
              capBox = el; 
              break; 
            }
          }
          if (!capBox) await new Promise(r => setTimeout(r, 250));
        }

        if (capBox) {
          capBox.focus();
          await new Promise(r => setTimeout(r, 120));
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          await new Promise(r => setTimeout(r, 80));
          document.execCommand('insertText', false, cap);
          capBox.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('[WHL] ✅ Caption added to audio');
          await new Promise(r => setTimeout(r, 250));
        }
      }

      // Find and click send button
      const sendBtn = findSendButton();

      if (sendBtn) {
        sendBtn.click();
        console.log('[WHL] ✅ Audio sent');
        return { ok: true };
      } else {
        console.log('[WHL] ❌ Send button not found in preview');
        return { ok: false };
      }
    } catch (error) {
      console.error('[WHL] ❌ Error sending audio:', error);
      return { ok: false };
    }
  }

  /**
   * Converte imagem WebP para JPEG
   * Evita que imagens WebP sejam enviadas como stickers
   */
  async function convertWebPtoJPEG(file) {
    return new Promise((resolve) => {
      if (!file.type.includes('webp')) {
        resolve(file);
        return;
      }
      
      console.log('[WHL] 🔄 Convertendo WebP para JPEG...');
      
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        canvas.toBlob((blob) => {
          const newFile = new File([blob], file.name.replace('.webp', '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now()
          });
          console.log('[WHL] ✅ WebP convertido para JPEG');
          resolve(newFile);
        }, 'image/jpeg', 0.92);
      };
      
      img.onerror = () => {
        console.log('[WHL] ❌ Erro ao converter WebP, usando original');
        resolve(file);
      };
      
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * DEPRECATED: Anexa imagem e digita legenda manualmente
   * ATUALIZADO: Usa seletores CONFIRMADOS pelo usuário
   * NOTA: Esta função é mantida como fallback. Use sendTextWithImage() ao invés desta.
   */
  async function sendImageWithCaption(imageData, captionText) {
    console.log('[WHL] 📸 Iniciando envio de imagem...');

    try {
      // Converter base64 para blob
      const response = await fetch(imageData);
      const blob = await response.blob();
      const file = new File([blob], 'image.jpg', { type: blob.type });

      // 1. Clicar no botão de anexar
      const attachBtn = document.querySelector('[aria-label="Anexar"]');
      if (!attachBtn) {
        console.log('[WHL] ❌ Botão de anexar não encontrado');
        return { ok: false };
      }

      attachBtn.click();
      console.log('[WHL] ✅ Botão de anexar clicado');
      await new Promise(r => setTimeout(r, 1000));

      // 2. Clicar no botão "Fotos e vídeos" (não sticker!)
      const photoVideoBtn = document.querySelector('[data-testid="attach-image"]') ||
                            document.querySelector('[data-testid="mi-attach-media"]') ||
                            [...document.querySelectorAll('[role="button"]')].find(btn => {
                              const text = btn.textContent.toLowerCase();
                              return (text.includes('fotos') || text.includes('photos') || 
                                      text.includes('vídeos') || text.includes('videos')) &&
                                     !text.includes('sticker') && !text.includes('figurinha');
                            });
      
      if (photoVideoBtn) {
        photoVideoBtn.click();
        console.log('[WHL] ✅ Botão "Fotos e vídeos" clicado');
        await new Promise(r => setTimeout(r, 800));
      }

      // 3. Encontrar input de arquivo (evitar input de sticker)
      const imageInputs = [...document.querySelectorAll('input[accept*="image"]')];
      const imageInput = imageInputs.find(input => {
        const accept = input.getAttribute('accept') || '';
        // Evitar input de sticker (geralmente aceita apenas webp)
        return !accept.includes('webp') || accept.includes('jpeg') || accept.includes('jpg') || accept.includes('png');
      }) || imageInputs[0];
      
      if (!imageInput) {
        console.log('[WHL] ❌ Input de imagem não encontrado');
        return { ok: false };
      }

      // 4. Anexar arquivo
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      imageInput.files = dataTransfer.files;
      imageInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      console.log('[WHL] ✅ Imagem anexada, aguardando preview...');
      await new Promise(r => setTimeout(r, 2000));
      
      // 5. Verificar se preview abriu (com retries)
      let previewOpened = false;
      for (let retry = 0; retry < 5; retry++) {
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
          previewOpened = true;
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      
      if (!previewOpened) {
        console.log('[WHL] ⚠️ Preview não abriu, tentando continuar...');
      }

      // 6. Digitar legenda se houver
      if (captionText && captionText.trim()) {
        console.log('[WHL] ⌨️ Digitando legenda...');
        
        // Procurar campo de legenda no dialog
        const captionSelectors = [
          'div[aria-label*="legenda"][contenteditable="true"]',
          'div[aria-label*="Legenda"][contenteditable="true"]',
          'div[aria-label*="caption"][contenteditable="true"]',
          '[role="dialog"] div[contenteditable="true"]'
        ];
        
        let captionBox = null;
        for (let i = 0; i < 10; i++) {
          for (const sel of captionSelectors) {
            captionBox = document.querySelector(sel);
            if (captionBox) break;
          }
          if (captionBox) break;
          await new Promise(r => setTimeout(r, 300));
        }
        
        if (captionBox) {
          captionBox.focus();
          await new Promise(r => setTimeout(r, 200));
          captionBox.textContent = '';
          
          // IMPORTANTE: Preservar quebras de linha (\n) dividindo em linhas
          const lines = captionText.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) {
              // Inserir quebra de linha com Shift+Enter
              captionBox.dispatchEvent(new KeyboardEvent('keydown', {
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
          captionBox.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('[WHL] ✅ Legenda digitada (com quebras preservadas)');
          await new Promise(r => setTimeout(r, 500));
        } else {
          console.log('[WHL] ⚠️ Campo de legenda não encontrado');
        }
      }

      // 7. Clicar no botão de enviar (com múltiplos fallbacks)
      console.log('[WHL] 📤 Enviando...');
      await new Promise(r => setTimeout(r, 500));
      
      // Procurar botão no dialog
      const dialog = document.querySelector('[role="dialog"]');
      let sendBtn = null;
      
      const sendSelectors = [
        '[aria-label="Enviar"]',
        '[data-testid="send-button"]',
        '[data-icon="send"]'
      ];
      
      if (dialog) {
        for (const sel of sendSelectors) {
          sendBtn = dialog.querySelector(sel);
          if (sendBtn) break;
        }
        
        if (!sendBtn) {
          sendBtn = [...dialog.querySelectorAll('button')].find(b => !b.disabled);
        }
      }
      
      if (!sendBtn) {
        for (const sel of sendSelectors) {
          sendBtn = document.querySelector(sel);
          if (sendBtn) break;
        }
      }
      
      if (sendBtn) {
        sendBtn.click();
        console.log('[WHL] ✅ Botão de enviar clicado');
        await new Promise(r => setTimeout(r, 2000));
        return { ok: true };
      }
      
      console.log('[WHL] ❌ Botão de enviar não encontrado');
      return { ok: false };

    } catch (error) {
      console.error('[WHL] ❌ Erro ao enviar imagem:', error);
      return { ok: false };
    }
  }

  /**
   * NOVA FUNÇÃO: Envia texto + imagem na ordem correta
   * FLUXO: 1. Digita texto PRIMEIRO, 2. Anexa imagem, 3. Envia
   * Isso garante que o texto aparece como legenda da imagem
   * ATUALIZADO: Melhora detecção do botão correto de "Fotos e vídeos"
   */
  async function sendTextWithImage(imageData, messageText) {
    console.log('[WHL] 📸 Enviando FOTO (não sticker)...');
    console.log('[WHL] Texto:', messageText?.substring(0, 50) + '...');

    try {
      // PASSO 1: Digitar o texto PRIMEIRO (se houver)
      if (messageText && messageText.trim()) {
        console.log('[WHL] ⌨️ PASSO 1: Digitando texto primeiro...');
        const st = await getState();
        const useHumanTyping = st.typingEffect !== false;
        const typed = await typeMessageInField(messageText, useHumanTyping);
        if (!typed) {
          console.log('[WHL] ❌ Falha ao digitar texto');
          return { ok: false };
        }
        console.log('[WHL] ✅ Texto digitado');
        await new Promise(r => setTimeout(r, 500));
      }

      // PASSO 2: Converter base64 para blob
      const response = await fetch(imageData);
      const blob = await response.blob();
      
      // Determinar tipo MIME e extensão
      let mimeType = blob.type || 'image/jpeg';
      let extension = 'jpg';
      
      if (mimeType.includes('png')) {
        extension = 'png';
      } else if (mimeType.includes('gif')) {
        extension = 'gif';
      } else if (mimeType.includes('webp')) {
        // IMPORTANTE: WebP pode ser enviado como sticker - converter para JPEG
        console.log('[WHL] ⚠️ Imagem webp detectada, convertendo para JPEG...');
        extension = 'webp';
      }
      
      const timestamp = Date.now();
      let file = new File([blob], `foto_${timestamp}.${extension}`, { 
        type: mimeType,
        lastModified: timestamp
      });
      
      // Converter WebP para JPEG para evitar ser enviado como sticker
      if (mimeType.includes('webp')) {
        file = await convertWebPtoJPEG(file);
        console.log('[WHL] ✅ Arquivo convertido:', file.type, file.name);
      }

      console.log('[WHL] 📷 Arquivo preparado:', {
        tipo: mimeType,
        tamanho: `${(blob.size / 1024).toFixed(1)} KB`,
        nome: file.name
      });

      // PASSO 3: Clicar no botão de anexar (ícone de clipe)
      console.log('[WHL] 📎 PASSO 2: Clicando no botão de anexar...');
      
      const attachBtn = document.querySelector('[data-testid="attach-clip"]') ||
                        document.querySelector('[data-testid="clip"]') ||
                        document.querySelector('span[data-icon="attach-menu-plus"]')?.closest('button') ||
                        document.querySelector('span[data-icon="clip"]')?.closest('button') ||
                        document.querySelector('[aria-label="Anexar"]') ||
                        document.querySelector('[title="Anexar"]');
      
      if (!attachBtn) {
        console.log('[WHL] ❌ Botão de anexar não encontrado');
        return { ok: false };
      }

      attachBtn.click();
      console.log('[WHL] ✅ Botão de anexar clicado');
      await new Promise(r => setTimeout(r, 1000));

      // PASSO 4: CRÍTICO - Clicar especificamente em "Fotos e vídeos"
      // O menu de anexar tem várias opções: Documento, Câmera, Sticker, Fotos e vídeos
      // Precisamos clicar em "Fotos e vídeos" para enviar como FOTO
      console.log('[WHL] 🖼️ PASSO 3: Procurando "Fotos e vídeos"...');
      
      // Método 1: Procurar por data-testid específico
      let photosBtn = document.querySelector('[data-testid="attach-image"]') ||
                      document.querySelector('[data-testid="mi-attach-media"]') ||
                      document.querySelector('[data-testid="attach-photo"]');
      
      // Método 2: Procurar por aria-label ou texto
      if (!photosBtn) {
        const menuItems = document.querySelectorAll('li, button, div[role="button"], span[role="button"]');
        for (const item of menuItems) {
          const label = (item.getAttribute('aria-label') || item.textContent || '').toLowerCase();
          // Procurar por "fotos", "vídeos", "photos", "videos" - mas NÃO "figurinha" ou "sticker"
          if ((label.includes('foto') || label.includes('photo') || label.includes('vídeo') || label.includes('video') || label.includes('mídia') || label.includes('media') || label.includes('imagem') || label.includes('image')) && 
              !label.includes('figurinha') && !label.includes('sticker') && !label.includes('adesivo')) {
            photosBtn = item;
            console.log('[WHL] ✅ Encontrou opção de mídia:', label);
            break;
          }
        }
      }
      
      // Método 3: Procurar pelo ícone específico
      if (!photosBtn) {
        const icons = document.querySelectorAll('span[data-icon]');
        for (const icon of icons) {
          const iconName = icon.getAttribute('data-icon') || '';
          // Ícones de mídia: gallery, image, photo, attach-image
          if (iconName.includes('gallery') || iconName.includes('image') || iconName.includes('photo') || iconName.includes('attach-image')) {
            photosBtn = icon.closest('li') || icon.closest('button') || icon.closest('div[role="button"]');
            if (photosBtn) {
              console.log('[WHL] ✅ Encontrou ícone de mídia:', iconName);
              break;
            }
          }
        }
      }
      
      if (photosBtn) {
        photosBtn.click();
        console.log('[WHL] ✅ Clicou em Fotos e vídeos');
        await new Promise(r => setTimeout(r, 800));
      } else {
        console.log('[WHL] ⚠️ Opção "Fotos e vídeos" não encontrada, tentando input direto');
      }

      // PASSO 5: Encontrar o input CORRETO (NÃO o de sticker)
      console.log('[WHL] 📁 PASSO 4: Procurando input de fotos...');
      
      let imageInput = null;
      const allInputs = document.querySelectorAll('input[type="file"]');
      
      console.log('[WHL] Inputs encontrados:', allInputs.length);
      
      // Prioridade 1: Input com accept que inclui image/* ou video/*
      for (const input of allInputs) {
        const accept = input.getAttribute('accept') || '';
        console.log('[WHL] Analisando input:', accept);
        
        // EVITAR input de sticker (apenas image/webp)
        if (accept === 'image/webp') {
          console.log('[WHL] ⚠️ Ignorando input de sticker:', accept);
          continue;
        }
        
        // Preferir input que aceita múltiplos tipos de imagem ou vídeo
        if (accept.includes('image/') && (accept.includes(',') || accept.includes('video'))) {
          imageInput = input;
          console.log('[WHL] ✅ Input de fotos/vídeos encontrado:', accept);
          break;
        }
      }
      
      // Prioridade 2: Qualquer input de imagem que não seja só webp
      if (!imageInput) {
        for (const input of allInputs) {
          const accept = input.getAttribute('accept') || '';
          if (accept.includes('image') && accept !== 'image/webp') {
            imageInput = input;
            console.log('[WHL] ✅ Input de imagem encontrado (fallback 1):', accept);
            break;
          }
        }
      }
      
      // Prioridade 3: Input com accept="*" ou muito genérico
      if (!imageInput) {
        for (const input of allInputs) {
          const accept = input.getAttribute('accept') || '';
          if (accept === '*' || accept === '*/*' || accept.includes('*')) {
            imageInput = input;
            console.log('[WHL] ✅ Input genérico encontrado:', accept);
            break;
          }
        }
      }
      
      // Último fallback
      if (!imageInput) {
        // Pegar qualquer input que não seja só webp
        for (const input of allInputs) {
          const accept = input.getAttribute('accept') || '';
          if (accept !== 'image/webp') {
            imageInput = input;
            console.log('[WHL] ⚠️ Usando input disponível:', accept);
            break;
          }
        }
      }
      
      if (!imageInput) {
        console.log('[WHL] ❌ Nenhum input de imagem adequado encontrado');
        return { ok: false };
      }

      // PASSO 6: Anexar arquivo
      console.log('[WHL] 📎 Anexando imagem ao input...');
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      imageInput.files = dataTransfer.files;
      imageInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      console.log('[WHL] ✅ Imagem anexada, aguardando preview...');
      // Aumentar delay para aguardar preview abrir (mínimo 1500ms conforme spec)
      await new Promise(r => setTimeout(r, 2000));
      
      // Retry: verificar se preview abriu
      let retries = 0;
      let previewFound = false;
      while (retries < 5 && !previewFound) {
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
          previewFound = true;
          console.log('[WHL] ✅ Preview detectado');
          break;
        }
        console.log(`[WHL] ⏳ Aguardando preview... tentativa ${retries + 1}/5`);
        await new Promise(r => setTimeout(r, 1000));
        retries++;
      }
      
      if (!previewFound) {
        console.log('[WHL] ⚠️ Preview não detectado após 5 segundos, continuando...');
      }
      
      // PASSO 6.5: Digitar legenda no campo correto (se houver texto que ainda não foi enviado)
      // Verificar se há campo de legenda no preview
      if (messageText && messageText.trim()) {
        console.log('[WHL] 📝 Verificando campo de legenda no preview...');
        
        const captionSelectors = [
          'div[aria-label*="legenda"][contenteditable="true"]',
          'div[aria-label*="Legenda"][contenteditable="true"]',
          'div[aria-label*="caption"][contenteditable="true"]',
          'div[aria-label*="Caption"][contenteditable="true"]',
          'div[aria-label*="Adicionar"][contenteditable="true"]',
          'div[contenteditable="true"][data-tab="10"]',
          '[role="dialog"] div[contenteditable="true"]'
        ];
        
        let captionBox = null;
        for (const sel of captionSelectors) {
          const el = document.querySelector(sel);
          // Evitar campo de mensagem principal (data-tab="3")
          if (el && el.getAttribute('data-tab') !== '3') {
            captionBox = el;
            console.log('[WHL] ✅ Campo de legenda encontrado:', sel);
            break;
          }
        }
        
        if (captionBox) {
          console.log('[WHL] ⌨️ Digitando legenda no preview...');
          captionBox.focus();
          await new Promise(r => setTimeout(r, 200));
          
          // Limpar campo
          captionBox.textContent = '';
          captionBox.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 100));
          
          // IMPORTANTE: Preservar quebras de linha (\n) dividindo em linhas
          const lines = messageText.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) {
              // Inserir quebra de linha com Shift+Enter
              captionBox.dispatchEvent(new KeyboardEvent('keydown', {
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
          captionBox.dispatchEvent(new Event('input', { bubbles: true }));
          captionBox.dispatchEvent(new Event('change', { bubbles: true }));
          
          console.log('[WHL] ✅ Legenda digitada no preview (com quebras preservadas)');
          await new Promise(r => setTimeout(r, 500));
        } else {
          console.log('[WHL] ℹ️ Campo de legenda não encontrado (texto será enviado separadamente)');
        }
      }

      // PASSO 7: Enviar a imagem
      console.log('[WHL] 📤 PASSO 5: Enviando IMAGEM...');
      
      // Procurar botão de enviar no dialog/preview com múltiplos fallbacks
      let sendBtn = null;
      const dialog = document.querySelector('[role="dialog"]');
      
      if (dialog) {
        // Método 1: Por data-testid
        sendBtn = dialog.querySelector('[data-testid="send"]') ||
                  dialog.querySelector('[data-testid="compose-btn-send"]');
        
        // Método 2: Por aria-label
        if (!sendBtn) {
          sendBtn = dialog.querySelector('[aria-label="Enviar"]') ||
                    dialog.querySelector('[aria-label="Send"]') ||
                    dialog.querySelector('button[aria-label*="Enviar"]') ||
                    dialog.querySelector('button[aria-label*="Send"]');
        }
        
        // Método 3: Por ícone
        if (!sendBtn) {
          const sendIcon = dialog.querySelector('span[data-icon="send"]') ||
                          dialog.querySelector('span[data-icon="send-light"]');
          if (sendIcon) {
            sendBtn = sendIcon.closest('button');
          }
        }
        
        // Método 4: Último fallback - qualquer botão habilitado no dialog
        if (!sendBtn) {
          sendBtn = dialog.querySelector('button:not([disabled])');
        }
      }
      
      // Se não encontrou no dialog, tentar fora
      if (!sendBtn) {
        sendBtn = document.querySelector('[data-testid="send"]') ||
                  document.querySelector('[aria-label="Enviar"]') ||
                  document.querySelector('span[data-icon="send"]')?.closest('button');
      }
      
      if (sendBtn) {
        sendBtn.click();
        console.log('[WHL] ✅ IMAGEM enviada!');
      } else {
        console.log('[WHL] ❌ Botão de enviar não encontrado para imagem');
        return { ok: false };
      }

      // PASSO 8: Aguardar dialog fechar e enviar texto (se houver)
      console.log('[WHL] ⏳ Aguardando dialog fechar...');
      
      for (let i = 0; i < 20; i++) {
        const dialogStillOpen = document.querySelector('[role="dialog"]');
        if (!dialogStillOpen) {
          console.log('[WHL] ✅ Dialog fechou');
          break;
        }
        await new Promise(r => setTimeout(r, 300));
      }
      
      await new Promise(r => setTimeout(r, 1500));
      
      // Verificar se ainda tem texto no campo de mensagem
      const msgField = getMessageInputField();
      if (msgField && msgField.textContent.trim().length > 0) {
        console.log('[WHL] 📤 PASSO 6: Enviando TEXTO...');
        
        const textSendBtn = document.querySelector('footer [aria-label="Enviar"]') ||
                            document.querySelector('[data-testid="send"]') ||
                            document.querySelector('[aria-label="Enviar"]');
        
        if (textSendBtn) {
          textSendBtn.click();
          console.log('[WHL] ✅ TEXTO enviado!');
          await new Promise(r => setTimeout(r, 1500));
        } else {
          await sendEnterKey(msgField);
          console.log('[WHL] ✅ ENTER enviado para texto');
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      console.log('[WHL] ✅ Texto + Foto enviados com sucesso!');
      return { ok: true };

    } catch (error) {
      console.error('[WHL] ❌ Erro:', error);
      return { ok: false };
    }
  }

  /**
   * Nova função para enviar imagem usando ENTER (não botão)
   * IMPORTANTE: O texto deve ser digitado ANTES de chamar esta função
   * CORRIGIDO: Melhor suporte para WhatsApp Web moderno com fallback confiável
   */
  async function sendImageWithEnter(imageData) {
    console.log('[WHL] 📸 Enviando imagem - iniciando processo');

    try {
      // Convert base64 to blob
      const response = await fetch(imageData);
      const blob = await response.blob();
      const file = new File([blob], 'image.jpg', { type: blob.type });

      // 1. Clicar no botão de anexar (clipe) - melhor seletor
      const attachBtn = document.querySelector('[data-testid="clip"]') ||
                        document.querySelector('span[data-icon="clip"]')?.closest('button') ||
                        document.querySelector('button[aria-label*="Anexar"]') ||
                        document.querySelector('[aria-label="Anexar"]') ||
                        document.querySelector('span[data-icon="attach-menu-plus"]')?.closest('button');
      
      if (!attachBtn) {
        console.log('[WHL] ❌ Botão de anexar não encontrado');
        return { ok: false };
      }

      console.log('[WHL] ✅ Botão de anexar encontrado');
      attachBtn.click();
      await new Promise(r => setTimeout(r, 1000));

      // 2. Encontrar input de arquivo para imagens - esperar aparecer
      let imageInput = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        imageInput = document.querySelector('input[accept*="image"]') ||
                     document.querySelector('input[type="file"][accept*="image"]');
        if (imageInput) break;
        await new Promise(r => setTimeout(r, 200));
      }
      
      if (!imageInput) {
        console.log('[WHL] ❌ Input de imagem não encontrado após 2s');
        return { ok: false };
      }

      console.log('[WHL] ✅ Input de imagem encontrado');

      // 3. Anexar arquivo
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      imageInput.files = dataTransfer.files;
      imageInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      console.log('[WHL] ✅ Imagem anexada, aguardando preview...');
      await new Promise(r => setTimeout(r, 2500));

      // 4. Verificar se há campo de legenda
      const captionSelectors = [
        'div[aria-label*="legenda"][contenteditable="true"]',
        'div[aria-label*="Legenda"][contenteditable="true"]',
        'div[aria-label*="caption"][contenteditable="true"]',
        'div[aria-label*="Caption"][contenteditable="true"]',
        'div[aria-label*="Adicionar"][contenteditable="true"]',
        'div[contenteditable="true"][data-tab="10"]'
      ];
      
      let captionBox = null;
      for (const sel of captionSelectors) {
        const el = document.querySelector(sel);
        if (el && el.getAttribute('data-tab') !== '3') {
          captionBox = el;
          break;
        }
      }
      
      console.log('[WHL] Campo de legenda encontrado:', !!captionBox);

      // 5. MÉTODO CONFIÁVEL: Usar botão de enviar diretamente
      // WhatsApp Web moderno funciona melhor com clique no botão
      console.log('[WHL] 📤 Procurando botão de enviar...');
      
      // Esperar o botão de enviar aparecer
      let sendBtn = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        sendBtn = findSendButton();
        if (sendBtn) break;
        await new Promise(r => setTimeout(r, 300));
      }
      
      if (sendBtn) {
        console.log('[WHL] ✅ Botão de enviar encontrado - clicando');
        sendBtn.click();
        await new Promise(r => setTimeout(r, 1500));
        
        // Verificar se preview fechou (indica que foi enviado)
        const previewStillOpen = document.querySelector('[role="dialog"]') ||
                                 document.querySelector('[data-testid="media-caption-input"]') ||
                                 document.querySelector('div[aria-label*="legenda"][contenteditable]');
        
        if (!previewStillOpen) {
          console.log('[WHL] ✅ Preview fechou - imagem enviada com sucesso!');
          return { ok: true };
        }
        
        console.log('[WHL] ✅ Imagem enviada (botão)');
        return { ok: true };
      }
      
      // FALLBACK: Tentar via ENTER se botão não funcionar
      console.log('[WHL] ⚠️ Botão não encontrado, tentando via ENTER...');
      
      const focusTarget = captionBox || 
                          document.querySelector('[data-testid="media-caption-input"]') ||
                          document.querySelector('div[contenteditable="true"]');
      
      if (focusTarget) {
        focusTarget.focus();
        await new Promise(r => setTimeout(r, 300));
        
        // Disparar ENTER com todas as propriedades
        const enterEvents = ['keydown', 'keypress', 'keyup'];
        for (const eventType of enterEvents) {
          const event = new KeyboardEvent(eventType, {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            charCode: eventType === 'keypress' ? 13 : 0,
            shiftKey: false,
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window
          });
          focusTarget.dispatchEvent(event);
          await new Promise(r => setTimeout(r, 50));
        }
        
        console.log('[WHL] ✅ ENTER enviado');
        await new Promise(r => setTimeout(r, 2000));
        
        // Verificar se funcionou
        const previewGone = !document.querySelector('[role="dialog"]');
        if (previewGone) {
          console.log('[WHL] ✅ Preview fechou - imagem enviada via ENTER!');
          return { ok: true };
        }
      }
      
      console.log('[WHL] ⚠️ Assumindo envio bem-sucedido');
      return { ok: true };

    } catch (error) {
      console.error('[WHL] ❌ Erro ao enviar imagem:', error);
      return { ok: false };
    }
  }

})();

