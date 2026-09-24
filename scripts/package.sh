#!/usr/bin/env bash
# Stock Hold — package script
#   Source: workspace repo HEAD (committed state)
#   Output: ${DEPLOY_DIR}/stock_hold_deploy.zip  (default: /mnt/d/deploy/)
#   Includes: VERSION.txt for deploy-time verification
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-/mnt/d/deploy}"
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

# Extract HEAD's tree to a staging directory
git archive HEAD | tar -x -C "$WORK"

# Inject VERSION.txt
{
  echo "Stock Hold Deploy Bundle"
  echo "========================"
  echo "Commit:    $(git rev-parse HEAD)"
  echo "Branch:    $(git rev-parse --abbrev-ref HEAD)"
  echo "Subject:   $(git log -1 --pretty=%s)"
  echo "Author:    $(git log -1 --pretty='%an <%ae>')"
  echo "Built at:  $(date -u +%Y-%m-%dT%H:%M:%SZ) ($(date +%Z))"
  echo "Host:      $(hostname)"
  echo "Repo root: $REPO_ROOT"
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

cat <<EOF

✓ Built: $OUTPUT
  Size:  $SIZE
  Files: $COUNT
  SHA-256: $SHA

On remote (LiteSpeed at tracker.elhomeo.com):
  1. Copy this zip to the remote host (scp / SFTP / USB / ...)
  2. Extract into a staging directory, then rsync to public_html
  3. Verify with:  cat public_html/VERSION.txt
  4. Full runbook: see DEPLOY.md in the repo

EOF
