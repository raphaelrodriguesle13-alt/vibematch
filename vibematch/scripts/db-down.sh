#!/usr/bin/env bash
set -euo pipefail
docker compose down
echo "Ambiente parado. Use 'docker compose down -v' para apagar também os dados."
