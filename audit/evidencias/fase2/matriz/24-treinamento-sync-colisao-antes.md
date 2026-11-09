# training/sync — colisão de id entre workspaces

1. B sincroniza a própria FAQ → HTTP 200 {"success":true,"synced":{"examples":0,"faqs":1,"products":0,"businessInfo":false}} · FAQs de B no banco: 1
2. A sincroniza FAQ id=1794185305079 → HTTP 200 {"success":true,"synced":{"examples":0,"faqs":1,"products":0,"businessInfo":false}}
3. B sincroniza [a própria FAQ + FAQ com o mesmo id local de A] → HTTP 200 (response.ok=true) {"success":false,"synced":{"examples":0,"faqs":1,"products":0,"businessInfo":false},"errors":["faqs: UNIQUE constraint failed: faqs.id"]}
   FAQs de B no banco: antes=1 → depois=**1**
3b. B envia só o conjunto local de A (todos os ids colidem) → HTTP 200 (response.ok=true) {"success":false,"synced":{"examples":0,"faqs":0,"products":0,"businessInfo":false},"errors":["faqs: UNIQUE constraint failed: faqs.id"]} · FAQs de B: antes=1 → depois=**0**
4. Resposta do passo 3 vista pelo service worker: response.ok=true, success=false (o código original decidia "sincronizado" só por response.ok).
