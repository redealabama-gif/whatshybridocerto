# WhatsHybrid Pro — Guia de Instalação e Configuração

> **Versão**: 8.0.1 | **Node.js**: ≥ 18 | **Chrome**: ≥ 120

---

## Índice

1. [Pré-requisitos](#1-pré-requisitos)
2. [Instalação do Backend](#2-instalação-do-backend)
3. [Instalação da Extensão](#3-instalação-da-extensão)
4. [Configuração do `.env`](#4-configuração-do-env)
5. [Build e empacotamento](#5-build-e-empacotamento)
6. [Atualização de versão](#6-atualização-de-versão)
7. [White-label / Branding](#7-white-label--branding)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Pré-requisitos

| Ferramenta | Versão mínima | Verificação |
|------------|--------------|-------------|
| Node.js    | 18.0.0       | `node -v`   |
| npm        | 9.0.0        | `npm -v`    |
| Git        | 2.30+        | `git --version` |
| Chrome     | 120          | Menu → Ajuda → Sobre |

---

## 2. Instalação do Backend

```bash
# 1. Clone o repositório (ou extraia o ZIP)
git clone https://github.com/sua-org/whatshybrid-pro.git
cd whatshybrid-pro

# 2. Instale todas as dependências (monorepo)
npm install

# 3. Configure o ambiente
cp whatshybrid-backend/.env.example whatshybrid-backend/.env
# Edite o arquivo .env — veja seção 4

# 4. Execute as migrações do banco de dados
cd whatshybrid-backend
npm run migrate

# 5. Inicie o servidor
npm run dev          # desenvolvimento (nodemon, hot-reload)
npm start            # produção
```

O backend ficará disponível em `http://localhost:3000` (ou a porta configurada em `PORT`).

### Verificar se o backend está funcionando

```bash
curl http://localhost:3000/api/health
# Resposta esperada: {"status":"ok","version":"8.0.1"}
```

---

## 3. Instalação da Extensão

### Opção A — Carregar em modo desenvolvedor (recomendado para testes)

1. Abra o Chrome e navegue para `chrome://extensions`
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `whatshybrid-extension/`
5. A extensão aparecerá com o ícone do WhatsHybrid

### Opção B — Instalar via ZIP empacotado (entrega ao cliente)

```bash
# Gera o ZIP final em dist/
npm run build:extension
npm run pack:extension
# Saída: dist/whatshybrid-pro-v8.0.1.zip
```

1. Abra `chrome://extensions`
2. Ative o Modo do desenvolvedor
3. Arraste o arquivo `.zip` para a janela OU use "Carregar sem compactação" no diretório `dist/extension/`

---

## 4. Configuração do `.env`

O arquivo `.env` fica em `whatshybrid-backend/.env`. **Nunca comite este arquivo.**

### Variáveis obrigatórias

```env
# Porta do servidor
PORT=3000
NODE_ENV=production

# JWT — GERE UMA CHAVE SEGURA:
# node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
JWT_SECRET=SUBSTITUA_POR_CHAVE_SEGURA_64_CHARS_MINIMO

# Banco de dados (SQLite — padrão)
DATABASE_PATH=./data/whatshybrid.db
```

### Variáveis de IA (pelo menos uma obrigatória)

```env
# OpenAI (recomendado)
OPENAI_API_KEY=sk-...

# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...

# Groq (ultra rápido e gratuito para testes)
GROQ_API_KEY=gsk_...
```

### CORS (obrigatório em produção)

```env
# Substitua pelo ID real da sua extensão Chrome
CORS_ORIGIN=chrome-extension://SEU_EXTENSION_ID_AQUI
```

**Como obter o Extension ID**: em `chrome://extensions`, copie o ID abaixo do nome da extensão.

---

## 5. Build e empacotamento

```bash
# Build completo da extensão (copia fontes, aplica branding, valida manifest)
npm run build:extension

# Empacota em ZIP para distribuição
npm run pack:extension

# Build completo com branding customizado
BUILD_BRAND=acme_corp npm run build:extension
npm run pack:extension
# Saída: dist/whatshybrid-pro-v8.0.1-acme_corp.zip
```

### Arquivos gerados

```
dist/
├── extension/              # Extensão pronta (não comprimida)
│   ├── manifest.json
│   ├── build-info.json     # Metadados de build (versão, commit, data)
│   └── brand_runtime.json  # Configuração de branding em runtime
├── whatshybrid-pro-v8.0.1.zip        # ZIP para distribuição
└── whatshybrid-pro-v8.0.1.zip.sha256 # Checksum SHA-256
```

---

## 6. Atualização de versão

Use o script `bump-version.js` para sincronizar a versão em todos os arquivos:

```bash
node scripts/bump-version.js 8.1.0
```

Esse script atualiza automaticamente:
- `package.json` (root)
- `whatshybrid-extension/package.json`
- `whatshybrid-extension/manifest.json`
- `whatshybrid-backend/package.json`
- `whatshybrid-extension/utils/version.js`

### Fluxo completo de release

```bash
# 1. Bumpar versão
node scripts/bump-version.js 8.1.0

# 2. Commitar e taguear
git add -A
git commit -m "chore: bump version to 8.1.0"
git tag v8.1.0

# 3. Build e pack
npm run build:extension
npm run pack:extension

# 4. Enviar para repositório
git push && git push --tags
```

O CI/CD criará automaticamente o release e o artefato ZIP ao detectar uma tag `v*`.

---

## 7. White-label / Branding

Edite o arquivo `BRAND_CONFIG.json` na raiz do projeto:

```json
{
  "meu_cliente": {
    "name": "MeuBot Pro",
    "description": "Automação WhatsApp personalizada",
    "primaryColor": "#0066FF",
    "supportEmail": "suporte@meucliente.com"
  }
}
```

Build com branding:

```bash
BUILD_BRAND=meu_cliente npm run build:extension
npm run pack:extension
# Gera: dist/whatshybrid-pro-v8.0.1-meu_cliente.zip
```

### Substituindo ícones/logos

Coloque os arquivos na pasta `whatshybrid-extension/icons/`:
- `16.png` — 16×16 px
- `48.png` — 48×48 px
- `128.png` — 128×128 px

---

## 8. Troubleshooting

### Backend não inicia — "JWT_SECRET não configurado"

```bash
# Gere e configure:
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
# Cole o resultado em .env → JWT_SECRET=...
```

### Extensão não conecta ao backend

1. Verifique se o backend está rodando: `curl http://localhost:3000/api/health`
2. Confirme o `CORS_ORIGIN` no `.env` inclui o ID da extensão
3. Abra o DevTools da extensão (chrome://extensions → Inspecionar views)
4. Verifique erros no console

### Extensão mostra "Versão incompatível"

```bash
# Sincronize todas as versões:
node scripts/bump-version.js $(cat whatshybrid-extension/manifest.json | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version")
```

### Build falha com "versões fora de sincronia"

Execute `node scripts/bump-version.js <VERSION>` para sincronizar, depois refaça o build.

### Testes falhando

```bash
# Rodar testes com output detalhado
npm run test:verbose

# Rodar apenas testes unitários
npm run test:unit

# Verificar E2E (requer backend rodando)
BASE_URL=http://localhost:3000 npm run test:e2e
```

### Logs excessivos em produção

Verifique se `NODE_ENV=production` está definido no `.env` e se `LOG_LEVEL=warn` está configurado. O logger da extensão silencia `console.log/info/debug` automaticamente quando `whl_debug` não está ativo.

---

## Suporte

- **Documentação técnica**: `/docs/`
- **Changelog**: `CHANGELOG_v*.md`
- **Issues**: repositório GitHub do projeto
