#!/usr/bin/env bash
# Pipeline local completo: schema -> papéis -> testes.
set -euo pipefail
set -a; source .env; set +a
npm run migrate
bash scripts/db-roles.sh
npm run typecheck
npm run lint
npm test
