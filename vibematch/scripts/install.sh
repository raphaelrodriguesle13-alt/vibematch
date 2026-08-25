#!/usr/bin/env bash
# Correção 10: npm ci é o caminho OFICIAL. npm install só para gerar o lockfile
# na primeira vez, explicitamente, quando o lockfile ainda não existe.
set -euo pipefail
command -v node >/dev/null || { echo "ERRO: Node.js 22+ é necessário."; exit 1; }

if [ -f package-lock.json ]; then
  echo "package-lock.json encontrado. Instalação reproduzível:"
  npm ci
else
  echo "AVISO: package-lock.json AUSENTE."
  echo "Gerando lockfile pela primeira vez (requer acesso ao registry npm)."
  echo "Depois disso, versione o lockfile e use SEMPRE 'npm ci'."
  npm install
  [ -f package-lock.json ] && echo "OK: package-lock.json gerado. COMMITE ESTE ARQUIVO."
fi

[ -f .env ] || { cp .env.example .env; echo "AVISO: .env criado do exemplo. Ajuste as senhas locais."; }
