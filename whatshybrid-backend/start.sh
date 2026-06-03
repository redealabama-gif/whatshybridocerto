#!/bin/bash
# =====================================================
# Axion Backend - Script de Inicialização
# =====================================================

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   🚀 Axion Backend v7.5.0                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Verificar Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js não encontrado!"
    echo "   Instale em: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js versão 18+ requerida (atual: $(node -v))"
    exit 1
fi

echo "✅ Node.js $(node -v)"

# Verificar arquivo .env
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  Arquivo .env não encontrado!"
    echo "   Criando a partir de .env.example..."
    cp .env.example .env
    echo ""
    echo "╔══════════════════════════════════════════════════╗"
    echo "║   📝 CONFIGURAÇÃO NECESSÁRIA                     ║"
    echo "╠══════════════════════════════════════════════════╣"
    echo "║   Edite o arquivo .env e configure:              ║"
    echo "║                                                  ║"
    echo "║   1. JWT_SECRET (troque por chave segura)        ║"
    echo "║                                                  ║"
    echo "║   2. Pelo menos UMA chave de API de IA:          ║"
    echo "║      • GROQ_API_KEY (recomendado - gratuito!)    ║"
    echo "║      • OPENAI_API_KEY                            ║"
    echo "║      • ANTHROPIC_API_KEY                         ║"
    echo "║                                                  ║"
    echo "║   🔗 Obter chave Groq GRATUITA:                  ║"
    echo "║      https://console.groq.com/keys               ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""
    exit 1
fi

# Verificar chaves de IA
HAS_AI_KEY=false
if grep -q "GROQ_API_KEY=gsk_" .env 2>/dev/null; then HAS_AI_KEY=true; fi
if grep -q "OPENAI_API_KEY=sk-" .env 2>/dev/null; then HAS_AI_KEY=true; fi
if grep -q "ANTHROPIC_API_KEY=sk-ant-" .env 2>/dev/null; then HAS_AI_KEY=true; fi

if [ "$HAS_AI_KEY" = false ]; then
    echo ""
    echo "⚠️  AVISO: Nenhuma chave de API de IA configurada!"
    echo "   As funcionalidades de IA usarão fallback local."
    echo ""
    echo "   Para IA completa, configure no .env:"
    echo "   • GROQ_API_KEY (gratuito): https://console.groq.com/keys"
    echo ""
fi

# Criar diretório de dados
mkdir -p data

# Instalar dependências se necessário
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
fi

echo ""
echo "🌐 Iniciando servidor em http://localhost:${PORT:-3000}"
echo ""
npm start
