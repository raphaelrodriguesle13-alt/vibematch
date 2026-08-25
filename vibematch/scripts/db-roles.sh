#!/usr/bin/env bash
# Concede LOGIN + senha aos papéis de runtime criados pela migration 006.
# Correção 9: a senha NUNCA é concatenada dentro da string SQL. Usamos a
# interpolação com quoting do psql (:'var'), que escapa o literal corretamente.
# Nenhuma senha aparece no output.
set -euo pipefail
[ -f .env ] || { echo "ERRO: .env ausente."; exit 1; }
set -a; source .env; set +a
: "${DATABASE_URL:?DATABASE_URL não definida}"

for role in auth profile matchmaking video moderation billing; do
  var="SVC_$(echo "$role" | tr '[:lower:]' '[:upper:]')_PASSWORD"
  pass="${!var:-}"
  if [ -z "$pass" ] || [ "$pass" = "CHANGE_ME_LOCAL_ONLY" ]; then
    echo "ERRO: $var não definida (ou ainda com placeholder)."; exit 1
  fi
  # -v passa a senha como variável do psql; :'newpass' aplica quoting seguro.
  # ON_ERROR_STOP garante falha visível. A senha não é ecoada.
  PGPASSWORD_UNUSED=1 psql "${DATABASE_URL}" \
    --quiet --no-psqlrc -v ON_ERROR_STOP=1 -v newpass="$pass" \
    -c "ALTER ROLE \"svc_${role}\" WITH LOGIN PASSWORD :'newpass';" >/dev/null
  echo "Papel svc_${role}: LOGIN habilitado."
  unset pass
done
echo "Papéis de runtime prontos. Nenhum é owner de tabela (V1.2 §2.5)."
