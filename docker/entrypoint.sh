#!/bin/sh
set -e

# Applies migrations and seeds the root account before the server accepts a
# single request. Doing this here rather than in a separate init container
# keeps the Portainer stack to one service for the default SQLite setup.

if [ -z "$BETTER_AUTH_SECRET" ]; then
  echo "──────────────────────────────────────────────────────────────"
  echo " BETTER_AUTH_SECRET is not set."
  echo ""
  echo " Every session cookie is signed with it. Without a stable"
  echo " value, sessions break on restart and are trivially forgeable."
  echo ""
  echo "   openssl rand -base64 32"
  echo ""
  echo " Set it in the stack's environment and start again."
  echo "──────────────────────────────────────────────────────────────"
  exit 1
fi

if [ -z "$BETTER_AUTH_URL" ]; then
  echo "warning: BETTER_AUTH_URL is unset; falling back to http://localhost:3000."
  echo "         OAuth callbacks and emailed links will point at the wrong host."
fi

# SQLite needs its directory to exist and be writable before Prisma opens it.
if [ "${DATABASE_PROVIDER:-sqlite}" = "sqlite" ]; then
  mkdir -p "$(dirname "${DATABASE_URL#file:}")"
fi
mkdir -p "${STORAGE_PATH:-/app/uploads}"

echo "borealis: applying migrations (${DATABASE_PROVIDER:-sqlite})…"
/opt/prisma/node_modules/.bin/prisma migrate deploy

echo "borealis: ensuring the root account exists…"
node /app/dist/root.mjs seed

echo "borealis: ready on port ${PORT:-3000}"
exec "$@"
