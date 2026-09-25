#!/usr/bin/env bash
# Stock Hold — package script
#   Source: workspace repo HEAD (committed state)
#   Output: ${DEPLOY_DIR}/stock_hold_deploy.zip
#           (default: $HOME/deploy/  — override with DEPLOY_DIR=...)
#   Includes: VERSION.txt for deploy-time verification
#
#   Post-build report uses \${DEPLOY_WEBROOT} placeholder; override per-run:
#     DEPLOY_DIR=/your/out DEPLOY_WEBROOT=/home/user/public_html bash scripts/package.sh
#
#   This script's defaults are deliberately generic so it is safe to push to a
#   public GitHub repo without leaking your local filesystem layout.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-$HOME/deploy}"
OUTPUT="$DEPLOY_DIR/stock_hold_deploy.zip"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$REPO_ROOT"

# Refuse if there are uncommitted changes (package only what is committed)
if ! git diff --quiet HEAD -- . ':(exclude)VERSION.txt' || ! git diff --cached --quiet; then
  cat >&2 <<EOF
ERROR: working tree has uncommitted changes.
  Commit first, then re-run:
    git add -A && git commit -m "<message>"
  Or run with PACKAGE_DIRTY=1 to package working tree (not recommended).
EOF
  exit 2
fi

# Extract HEAD's tree to a staging directory, then drop dev-only paths
# that the server does not need (keeps the deploy bundle lean and stops
# developer tooling from leaking into the deployed artifact).
git archive HEAD | tar -x -C "$WORK"
rm -rf "$WORK/scripts"

# F-12.2: bake the Turnstile sitekey into frontend/login.html at build time.
# This avoids runtime complexity (no /api/v1/config endpoint, no dynamic
# fetch JS). The placeholder {{TURNSTILE_SITEKEY}} is left as-is in git and
# substituted here. Dev mode: STOCK_HOLD_TURNSTILE_SITEKEY unset → widget
# renders inert, backend verify_turnstile() also skips check when SECRET
# is empty (see api/bootstrap.php).
: "${STOCK_HOLD_TURNSTILE_SITEKEY:=}"

# F-XX fix: pull the Turnstile sitekey from operator-managed .env files
# (NOT .env.example, which is public and tracked in git) when the var
# is not passed on the command line. Lets `bash scripts/package.sh`
# work without exposing the key in shell history / log output / redacted
# transcripts. Refuses well-known placeholders so a stray .env copy of
# .env.example can never sneak through into deploy/login.html.
for _sh_envfile in "$REPO_ROOT/.env" "$HOME/.env"; do
    if [ -z "${STOCK_HOLD_TURNSTILE_SITEKEY:-}" ] && [ -r "$_sh_envfile" ]; then
        _sh_line=$(grep -E "^STOCK_HOLD_TURNSTILE_SITEKEY=" "$_sh_envfile" 2>/dev/null | head -1 || true)
        if [ -n "$_sh_line" ]; then
            # Cut on first =, then strip surrounding quotes / whitespace.
            # tr avoids the nested-quote foot-gun that inline sed hits.
            _sh_val=$(printf "%s" "$_sh_line" | cut -d= -f2- | tr -d \"\047 | tr -d "[:space:]")
            if [ -n "$_sh_val" ]; then
                STOCK_HOLD_TURNSTILE_SITEKEY="$_sh_val"
                break
            fi
        fi
    fi
done

# F-XX fix: refuse well-known placeholder strings so a stray .env that
# looks like .env.example cannot bake a publicly-known value into the
# deploy. Update this case statement when .env.example placeholder
# list changes. "replacXoken" pattern catches both ASCII and unicode-ellipsis
# variants from .env.example history (e.g. "replac...oken", "replacXoken").
case "$STOCK_HOLD_TURNSTILE_SITEKEY" in
    "***")
        echo "ERROR: STOCK_HOLD_TURNSTILE_SITEKEY is a literal \"***\"; refusing to bake it." >&2
        echo "       Set it as an env var or in $REPO_ROOT/.env with a real Turnstile sitekey." >&2
        exit 1
        ;;
    "replace-with-a-long-random-token"|"replace-with-long-random-token"|"replace-with-openssl-rand-hex-32-output"|"replac"*"oken"|"changeme"|"your-token-here"|"your-secret-token-here"|"your_api_token"|"<your-token>"|"<token>"|"TODO"|"FIXME"|"xxx")
        echo "ERROR: STOCK_HOLD_TURNSTILE_SITEKEY looks like a placeholder; refusing to bake it." >&2
        echo "       Set it as an env var or in $REPO_ROOT/.env with a real Turnstile sitekey." >&2
        exit 1
        ;;
esac

if [ -n "$STOCK_HOLD_TURNSTILE_SITEKEY" ]; then
    sed -i "s|{{TURNSTILE_SITEKEY}}|$STOCK_HOLD_TURNSTILE_SITEKEY|g" "$WORK/frontend/login.html"
fi

# Inject VERSION.txt
#   Only safe fields are recorded. Commit subject / author email / hostname /
#   repo root are intentionally omitted so that the deployed artifact does not
#   leak infrastructure information even if the zip is exfiltrated or pushed.
{
  echo "Stock Hold Deploy Bundle"
  echo "========================"
  echo "Commit:    $(git rev-parse HEAD)"
  echo "Short:     $(git rev-parse --short HEAD)"
  echo "Branch:    $(git rev-parse --abbrev-ref HEAD)"
  echo "Built at:  $(date -u +%Y-%m-%dT%H:%M:%SZ) ($(date +%Z))"
  echo "Built by:  ${BUILD_USER:-${SUDO_USER:-${USER:-unknown}}}"
} > "$WORK/VERSION.txt"

# Zip deterministically (sorted) via python3 (zip/unzip not required)
mkdir -p "$DEPLOY_DIR"
python3 - "$WORK" "$OUTPUT" <<'PY'
import os, sys
src, dst = sys.argv[1], sys.argv[2]
with __import__("zipfile").ZipFile(dst, "w", __import__("zipfile").ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        dirs.sort(); files.sort()
        for f in files:
            p = os.path.join(root, f)
            arc = os.path.relpath(p, src).replace(os.sep, "/")
            z.write(p, arc)
PY

# Report
SIZE=$(du -h "$OUTPUT" | awk '{print $1}')
SHA=$(sha256sum "$OUTPUT" | awk '{print $1}')
COUNT=$(python3 -c "import zipfile,sys; print(len(zipfile.ZipFile('$OUTPUT').namelist()))")

# Deploy target placeholders (override via env). Defaults are deliberately generic
# so this script is safe to push to a public GitHub repo without leaking your
# deploy target.
: "${DEPLOY_WEBROOT:=/path/to/webroot}"

cat <<EOF

✓ Built: $OUTPUT
  Size:  $SIZE
  Files: $COUNT
  SHA-256: $SHA

On remote (web server holding \${DEPLOY_WEBROOT} = $DEPLOY_WEBROOT):
  1. Copy this zip to the remote host (scp / SFTP / USB / ...)
  2. Extract into a staging directory, then rsync to \${DEPLOY_WEBROOT}
  3. Verify with:  cat \${DEPLOY_WEBROOT}/VERSION.txt
  4. Full runbook: see DEPLOY.md in the repo

EOF
