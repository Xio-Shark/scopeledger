#!/usr/bin/env bash
# Build locally with pnpm build first. Ship standalone output; never build on the small VPS.
# Required: DEPLOY_HOST=user@host DEPLOY_SSH_KEY=/path/to/private/key.
# Existing releases are retained so deployment and rollback never delete another build.
set -euo pipefail
cd "$(dirname "$0")/.."
TASK_HOST="${DEPLOY_HOST:?set DEPLOY_HOST=user@host}"
TASK_KEY="${DEPLOY_SSH_KEY:?set DEPLOY_SSH_KEY=/path/to/private/key}"
TASK_RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}"
TASK_STAGE="$(mktemp -d -t scopeledger-release)"
export TASK_STAGE
python3 - <<'PY'
import os, pathlib, shutil, tarfile
stage = pathlib.Path(os.environ['TASK_STAGE'])
source = pathlib.Path('.next/standalone')
if not (source / 'server.js').is_file():
    raise SystemExit('Missing standalone build; run pnpm build first')
shutil.copytree(source, stage / 'app', symlinks=True, ignore=shutil.ignore_patterns('.env*', '*.log'))
shutil.copytree('.next/static', stage / 'app/.next/static', dirs_exist_ok=True)
if pathlib.Path('public').is_dir():
    shutil.copytree('public', stage / 'app/public', dirs_exist_ok=True)
with tarfile.open(stage / 'app.tar.gz', 'w:gz') as archive:
    archive.add(stage / 'app', arcname='app')
print('Standalone release prepared without env files.')
PY
scp -q -o BatchMode=yes -o IdentitiesOnly=yes -i "$TASK_KEY" "$TASK_STAGE/app.tar.gz" "$TASK_HOST:/opt/scopeledger/release-$TASK_RELEASE.tar.gz"
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$TASK_KEY" "$TASK_HOST" bash -s -- "$TASK_RELEASE" <<'REMOTE'
set -euo pipefail
release="$1"
cd /opt/scopeledger
mkdir -p "releases/$release"
tar -xzf "release-$release.tar.gz" -C "releases/$release"
chown -R scopeledger:scopeledger "releases/$release/app"
mv app "releases/previous-$release"
mv "releases/$release/app" app
systemctl restart scopeledger
healthy=false
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null; then healthy=true; break; fi
  sleep 1
done
if [ "$healthy" != true ]; then
  mv app "releases/failed-$release"
  mv "releases/previous-$release" app
  systemctl restart scopeledger
  echo 'New release failed health check; previous release restored.' >&2
  exit 1
fi
printf 'ScopeLedger release %s healthy; previous build retained.\n' "$release"
REMOTE
if [ -n "${PUBLIC_URL:-}" ]; then
  curl -fsS --max-time 20 "$PUBLIC_URL/api/health"
fi
