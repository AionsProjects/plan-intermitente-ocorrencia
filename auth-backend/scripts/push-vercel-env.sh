#!/usr/bin/env bash
# Empurra as chaves sensíveis do .env pro projeto Vercel (production + preview),
# SEM imprimir valores (pipe via stdin). Idempotente: remove e re-adiciona cada chave.
#
# Pré-requisito (rode UMA vez, interativo):
#   npx vercel login
#
# Uso:
#   bash auth-backend/scripts/push-vercel-env.sh
#
# Depois: faça um redeploy (git push ou `npx vercel --prod`) pra o backend ler os novos envs.

set -euo pipefail
cd "$(dirname "$0")/.."   # auth-backend/

PROJECT="plan-intermitente-ocorrencia"
SCOPE="aions"
ENVFILE=".env"

# Liga este diretório ao projeto (não-interativo).
npx vercel link --yes --project "$PROJECT" --scope "$SCOPE" >/dev/null

# Chaves de integração a sincronizar (NÃO inclui DATABASE_URL/GOOGLE_* — já no projeto).
KEYS=(
  MONDAY_TOKEN MONDAY_API_VERSION
  RM_BRIDGE_URL RM_AIONS_AUTH RM_DATA_SERVER
  CAJU_AUTH_URL CAJU_API_BASE CAJU_CLIENT_ID CAJU_CLIENT_SECRET
  CAJU_GRANT_TYPE CAJU_USERNAME CAJU_PASSWORD CAJU_SPONSOR_ID CAJU_INTEGRATION_ID
  CRON_SECRET
)

val() { grep -E "^$1=" "$ENVFILE" | head -1 | cut -d= -f2-; }

for K in "${KEYS[@]}"; do
  V="$(val "$K" || true)"
  if [ -z "$V" ]; then echo "skip $K (vazio no .env)"; continue; fi
  for ENV in production preview; do
    npx vercel env rm "$K" "$ENV" --yes >/dev/null 2>&1 || true
    printf '%s' "$V" | npx vercel env add "$K" "$ENV" >/dev/null
  done
  echo "ok  $K -> production, preview"
done

echo
echo "Feito. Redeploy pra aplicar:  npx vercel --prod"
