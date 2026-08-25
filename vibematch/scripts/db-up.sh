#!/usr/bin/env bash
# Sobe PostgreSQL + Redis locais e aguarda ficarem saudáveis.
set -euo pipefail
[ -f .env ] || { echo "ERRO: .env ausente. Copie de .env.example e ajuste."; exit 1; }
set -a; source .env; set +a
docker compose up -d postgres redis
echo "Aguardando PostgreSQL ficar pronto..."
for i in $(seq 1 40); do
  if docker compose exec -T postgres pg_isready -U "${POSTGRES_OWNER_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    echo "PostgreSQL pronto."; exit 0
  fi
  sleep 1
done
echo "ERRO: PostgreSQL não ficou pronto a tempo."; exit 1
