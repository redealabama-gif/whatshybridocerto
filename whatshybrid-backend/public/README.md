# Site WhatsHybrid Pro — Como visualizar

Esta pasta contém as 4 páginas públicas da SaaS.

## ⚡ Visualização rápida (sem instalar nada)

**Opção 1 — Servidor estático Python (mais fácil):**
```bash
cd whatshybrid-backend/public
python3 -m http.server 8080
```
Abre no navegador: `http://localhost:8080`

**Opção 2 — Abrir o arquivo direto:**
- No Windows: clique duplo em `index.html`
- No Mac/Linux: `open index.html` ou arraste pro navegador

> ⚠️ Botões de signup/login só funcionam com o backend rodando (Opção 3).

**Opção 3 — Backend completo (recomendado para teste real):**
```bash
cd whatshybrid-backend
npm install        # primeira vez
cp .env.example .env
# Edite .env e coloque: JWT_SECRET=qualquer_string_aleatoria_aqui_32_chars
npm start
```
Abre: `http://localhost:3000`

## 📄 Páginas

| Arquivo | Função | Rota no backend |
|---|---|---|
| `index.html` | Landing page | `/` |
| `signup.html` | Cadastro 3 etapas | `/signup` |
| `login.html` | Login | `/login` |
| `dashboard.html` | Portal do cliente (precisa estar logado) | `/dashboard` |

## 🎨 Estilo

- Cores: roxo `#6f00ff` + ciano `#00ffff`
- Fontes: Orbitron (títulos) + Inter (texto) — carregadas do Google Fonts
- Ícones: Lucide via CDN
- Glassmorphism, custom cursor, animações suaves
- Tudo definido em `css/futuristic.css` (15KB)
