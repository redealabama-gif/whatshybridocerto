# 🚀 Vórtex Backend v7.5.0

Backend API para Vórtex Pro - Sistema de automação e IA para WhatsApp.

## 📋 Requisitos

- **Node.js 18+** ([Download](https://nodejs.org/))
- **npm** (incluído com Node.js)

## ⚡ Instalação Rápida (1 minuto!)

### Linux/Mac
```bash
cd whatshybrid-backend
chmod +x start.sh
./start.sh
```

### Windows
```batch
cd whatshybrid-backend
start.bat
```

O script irá:
1. ✅ Verificar Node.js
2. ✅ Criar arquivo `.env` se não existir
3. ✅ Instalar dependências
4. ✅ Iniciar o servidor

## ⚙️ Configuração

### 1. Criar arquivo `.env`
```bash
cp .env.example .env
```

### 2. Configurar JWT (OBRIGATÓRIO)
Edite `.env` e troque o `JWT_SECRET`:
```env
JWT_SECRET=sua-chave-super-secreta-aqui-troque-isso
```

### 3. Configurar IA (Recomendado)

Configure pelo menos **UMA** chave de API para habilitar IA:

#### 🌟 Opção 1: Groq (RECOMENDADO - Gratuito e Rápido!)
```env
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxx
```
👉 **[Obter chave GRATUITA](https://console.groq.com/keys)**

#### Opção 2: OpenAI
```env
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx
```
👉 [Obter chave](https://platform.openai.com/api-keys)

#### Opção 3: Anthropic Claude
```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxx
```
👉 [Obter chave](https://console.anthropic.com/)

#### Opção 4: Google Gemini (Tem tier gratuito)
```env
GOOGLE_API_KEY=xxxxxxxxxxxxxxxxxxxxx
```
👉 [Obter chave](https://makersuite.google.com/app/apikey)

## 🚀 Iniciar Servidor

```bash
npm start
```

Ou em modo desenvolvimento (com auto-reload):
```bash
npm run dev
```

O servidor iniciará em **http://localhost:3000**

## 📡 Endpoints da API

| Endpoint | Descrição |
|----------|-----------|
| `GET /health` | Status do servidor |
| `GET /api` | Documentação dos endpoints |
| `POST /api/v1/auth/register` | Criar conta |
| `POST /api/v1/auth/login` | Login |
| `GET /api/v1/contacts` | Listar contatos |
| `POST /api/v1/ai/complete` | Completar com IA |
| `GET /api/v1/analytics` | Métricas |
| `POST /api/v1/smartbot/analyze` | Análise SmartBot |

## 🔧 Conectar Extensão ao Backend

Na extensão Vórtex:

1. Abra o **Side Panel** (ícone na barra do Chrome)
2. Vá em **⚙️ Configurações** > **Backend**
3. URL: `http://localhost:3000`
4. Clique em **Conectar**

## 📁 Estrutura do Projeto

```
whatshybrid-backend/
├── src/
│   ├── server.js          # Servidor Express
│   ├── routes/            # Rotas da API
│   │   ├── ai.js          # Endpoints de IA
│   │   ├── auth.js        # Autenticação
│   │   ├── contacts.js    # Contatos
│   │   ├── smartbot.js    # SmartBot
│   │   └── ...
│   ├── middleware/        # Auth, rate limit
│   ├── services/          # Lógica de negócio
│   └── utils/             # Utilitários
├── config/index.js        # Configurações
├── data/                  # Banco SQLite
├── .env.example           # Template
├── start.sh               # Script Linux/Mac
├── start.bat              # Script Windows
└── package.json
```

## ❓ Problemas Comuns

### "No AI provider configured"
**Solução:** Configure pelo menos uma chave de API de IA no `.env`
```env
GROQ_API_KEY=gsk_sua_chave_aqui
```

### "Database error"
**Solução:** O diretório `data/` é criado automaticamente. Verifique permissões de escrita.

### "Port already in use"
**Solução:** Altere a porta no `.env`:
```env
PORT=4000
```

### Backend não conecta com a extensão
**Solução:** Verifique se:
1. O servidor está rodando (`npm start`)
2. A URL está correta (http://localhost:3000)
3. CORS está configurado (`CORS_ORIGIN=*`)

## 🔐 Segurança em Produção

Antes de usar em produção:

1. **Troque JWT_SECRET** por uma chave forte
2. **Configure CORS** para aceitar apenas seu domínio
3. **Use HTTPS** com certificado válido
4. **Configure rate limiting** adequado

```env
JWT_SECRET=chave-muito-longa-e-segura-aqui
CORS_ORIGIN=https://seu-dominio.com
NODE_ENV=production
```

## 📄 Licença

MIT
