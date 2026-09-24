#!/usr/bin/env bash
# Stock Hold — static validation
#   Runs without PHP on host (uses node + python3).
#   For full PHP-side checks, run on remote (see "Manual smoke test" below).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

errors=0
echo "=== Stock Hold — Static Validation ==="
echo "Repo: $REPO_ROOT"
echo "HEAD: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
echo ""

# ---------- Required file presence ----------
echo "[1/4] Required files"
required=(
  index.html
  .htaccess
  .env.example
  README.md
  LICENSE
  api/index.php
  api/bootstrap.php
  api/.htaccess
  frontend/login.html
  frontend/dashboard.html
  frontend/js/api-client.js
  cli/migrate.php
  cli/backup.php
  migrations/001-initial.sql
  docs/SPEC.md
)
for f in "${required[@]}"; do
  if [[ -f "$f" ]]; then
    printf "  ✓ %s\n" "$f"
  else
    printf "  ✗ MISSING: %s\n" "$f"
    errors=$((errors+1))
  fi
done

# ---------- JS syntax ----------
echo ""
echo "[2/4] JS syntax (node --check)"
fail_js=0
while IFS= read -r -d '' f; do
  if node --check "$f" >/dev/null 2>&1; then
    printf "  ✓ %s\n" "$f"
  else
    printf "  ✗ %s\n" "$f"
    node --check "$f" 2>&1 | sed 's/^/      /' | head -3
    fail_js=$((fail_js+1))
  fi
done < <(find frontend -type f -name '*.js' -print0)
[[ $fail_js -eq 0 ]] || errors=$((errors+fail_js))

# ---------- JSON syntax ----------
echo ""
echo "[3/4] JSON syntax"
fail_json=0
while IFS= read -r -d '' f; do
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" >/dev/null 2>&1; then
    printf "  ✓ %s\n" "$f"
  else
    printf "  ✗ %s\n" "$f"
    python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" 2>&1 | sed 's/^/      /'
    fail_json=$((fail_json+1))
  fi
done < <(find . -type f -name '*.json' -not -path './node_modules/*' -print0)
[[ $fail_json -eq 0 ]] || errors=$((fail_json))

# ---------- PHP syntax (only if php on PATH) ----------
echo ""
echo "[4/4] PHP syntax"
if command -v php >/dev/null 2>&1; then
  fail_php=0
  while IFS= read -r -d '' f; do
    if php -l "$f" >/dev/null 2>&1; then
      printf "  ✓ %s\n" "$f"
    else
      printf "  ✗ %s\n" "$f"
      php -l "$f" 2>&1 | sed 's/^/      /' | head -3
      fail_php=$((fail_php+1))
    fi
  done < <(find api cli -type f -name '*.php' -print0)
  [[ $fail_php -eq 0 ]] || errors=$((fail_php))
else
  cat <<'NOTE'
  ℹ  php not on PATH locally — skipped.
  Run on remote (LiteSpeed) for full check:
    find api cli -type f -name '*.php' -exec php -l {} \; | grep -v 'No syntax errors'
NOTE
fi

# ---------- Manual smoke test checklist (always printed) ----------
cat <<'CHECKLIST'

=== Manual smoke test (run on remote after deploy) ===
1. Verify deployed version
   $ cat ~/public_html/VERSION.txt
   → match Commit SHA against what you packaged

2. Health endpoint
   $ curl -i https://tracker.elhomeo.com/api/v1/health
   → 200 + JSON {"status":"ok","data":{"service":"stock_hold",...}}

3. Session endpoint
   $ curl -i https://tracker.elhomeo.com/api/v1/auth/session
   → 200 + JSON with csrf_token + authenticated:false

4. Static pages
   $ curl -I https://tracker.elhomeo.com/
   $ curl -I https://tracker.elhomeo.com/frontend/login.html

5. .env / runtime directory permissions
   $ ls -ld ~/runtime/stock_hold
   $ test -r ~/public_html/.env.example && ! test -r ~/public_html/.env

6. Browser smoke
   - Open https://tracker.elhomeo.com/frontend/login.html
   - Register first user (needs STOCK_HOLD_INIT_TOKEN env)
   - Login → Dashboard renders
   - Add an account, a transaction, view holdings
   - Settings → Maintenance → 檢查更新

7. LiteSpeed error log clean
   $ tail -n 50 ~/logs/<site>/error.log

CHECKLIST

# ---------- Summary ----------
echo "=== Summary ==="
if [[ $errors -gt 0 ]]; then
  echo "❌ $errors error(s) — fix before packaging."
  exit 1
else
  echo "✓ Static checks passed. Proceed with: bash scripts/package.sh"
fi
