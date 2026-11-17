#!/usr/bin/env bash
# Builds the web app and deploys it to Firebase Hosting.
# Usage: npm run deploy
# Deploys hosting only. Routes are published in the Firebase console (Remote Config), never by this
# script, so a deploy can never overwrite a measured policy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$ROOT/infra/firebase"

if ! grep -q '^VITE_RECAPTCHA_SITE_KEY=.\+' "$ROOT/apps/web/.env.local" 2>/dev/null \
   && [ -z "${VITE_RECAPTCHA_SITE_KEY:-}" ]; then
  echo "VITE_RECAPTCHA_SITE_KEY is not set. Visitors would fail App Check. Aborting." >&2
  exit 1
fi

# Run from the repository root rather than with --prefix, so the path is never handed to npm
# in a form a Windows shell can mistranslate.
cd "$ROOT"
npm run typecheck
npm test
npm run build

# Never publish a local App Check debug token: anyone holding it can get past App Check.
TOKEN="$(grep -s '^VITE_APPCHECK_DEBUG_TOKEN=' "$ROOT/apps/web/.env.local" | cut -d= -f2- | tr -d '\r')"
if [ -n "$TOKEN" ] && grep -rqF "$TOKEN" "$ROOT/apps/web/dist"; then
  echo "The build contains the App Check debug token. Aborting." >&2
  exit 1
fi
if grep -rq 'VITE_APPCHECK_DEBUG' "$ROOT/apps/web/dist"; then
  echo "The build contains App Check debug settings. Aborting." >&2
  exit 1
fi

rm -rf "$STAGE/public"
cp -R "$ROOT/apps/web/dist" "$STAGE/public"
cd "$STAGE" && npx firebase-tools deploy --only hosting
