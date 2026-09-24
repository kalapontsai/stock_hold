# Stock Hold — Deployment Runbook

> 從 **2026-09-25** 起，stock_hold 改採 **zip 交付** 模式：
> 開發在 `~/.openclaw/workspace/repos/stock_hold/`，完成後打包成 zip，手動複製到遠端主機。

## 部署變數（push-safe placeholders）

> 本文以下行文使用 `${VAR}` 樣式佔位符；**不包含真實 host / 路徑**，
> 可安全 `git push` 至公開 GitHub。部署時由你依實際環境代入。

| 變數 | 用途 | 範例（請依你的環境替換） |
|---|---|---|
| `${DEPLOY_HOST}` | 生產站網域（公開存取） | `your.domain.example` |
| `${DEPLOY_WEBROOT}` | HTTP document root（部署目標） | `/home/<user>/public_html` |
| `${DEPLOY_RUNTIME}` | runtime 目錄（SQLite / logs，建議放 webroot 外） | `/home/<user>/runtime/stock_hold` |
| `${DEPLOY_ERROR_LOG}` | web server 錯誤 log | `/home/<user>/logs/<site>/error.log` |

> 自動偵測站網域/IP 也可；不要把任何能在公網對應到你的主機 / DNS 寫入此文件。

## 流程總覽

```
~/.openclaw/workspace/repos/stock_hold/   (develop, commit)
        │
        │  bash scripts/package.sh
        ▼
<DEPLOY_DIR>/stock_hold_deploy.zip       (交付物；本機自選路徑)
        │
        │  (manual: scp / SFTP / 隨身碟 / …)
        ▼
${DEPLOY_WEBROOT}/                        (部署位置)
        │
        │  smoke test
        ▼
https://${DEPLOY_HOST}/
```

## 1. 本地打包

```bash
cd ~/.openclaw/workspace/repos/stock_hold
bash scripts/validate.sh           # 跑靜態檢查
git status                         # 確認 working tree 已 commit
git log --oneline -5                # 確認要打包哪個 commit
bash scripts/package.sh            # 產出 zip
```

預設輸出位置由 `scripts/package.sh` 內的 `DEPLOY_DIR` 環境變數決定；可用 `DEPLOY_DIR=...` 覆寫。

## 2. 複製到遠端

由你決定方式（scp / SFTP / USB / Cloudflare R2 / …）。

| 方式 | 範例指令 |
|---|---|
| SCP | `scp <DEPLOY_DIR>/stock_hold_deploy.zip user@${DEPLOY_HOST}:~/` |
| SFTP | FileZilla / WinSCP 拉到 `~/` 或 `/tmp/` |
| USB | 直接 copy |

> `user@${DEPLOY_HOST}` 是你遠端主機的 SSH / SFTP 帳號；本文不寫實際值。

## 3. 遠端解壓與部署

```bash
# 在遠端主機（SSH 進 web 伺服器）
cd ~
unzip stock_hold_deploy.zip -d stock_hold_staging

# (可選) 比對內容
rsync -avn --delete stock_hold_staging/ ${DEPLOY_WEBROOT}/

# 部署前先備份舊版（建議）
mv ${DEPLOY_WEBROOT} ${DEPLOY_WEBROOT}.bak.$(date +%Y%m%d-%H%M)

# 正式部署
rsync -av --delete stock_hold_staging/ ${DEPLOY_WEBROOT}/
```

> `--delete` 確保移除舊版殘留檔。
> `${DEPLOY_WEBROOT}` 視你的 web server 而定（LiteSpeed / Apache / Nginx 公用 root、
> Plesk 的 `httpdocs/`、cPanel 的 `public_html/` 等）；本機自訂。

## 4. 部署後驗證

```bash
# (1) 確認部署的版本
cat ${DEPLOY_WEBROOT}/VERSION.txt
# 對照 git log 確認 Commit SHA 正確

# (2) health endpoint
curl -i https://${DEPLOY_HOST}/api/v1/health
# 預期：200 + JSON {"status":"ok","data":{"service":"stock_hold",...}}

# (3) auth session
curl -i https://${DEPLOY_HOST}/api/v1/auth/session
# 預期：200 + JSON 含 csrf_token

# (4) 靜態頁
curl -I https://${DEPLOY_HOST}/
curl -I https://${DEPLOY_HOST}/frontend/login.html

# (5) 確認 .env 沒被上傳
test ! -f ${DEPLOY_WEBROOT}/.env && echo "OK: no .env"

# (6) 確認 runtime 目錄存在且可寫
ls -ld ${DEPLOY_RUNTIME}
```

完整 smoke test 步驟見 `scripts/validate.sh` 的 "Manual smoke test" 區塊。

## 5. zip 包含什麼 / 不包含什麼

✅ 包含（tracked files + VERSION.txt）：

- `api/`、`cli/`、`frontend/`、`migrations/`、`docs/`、`demo/`
- `index.html`、`.htaccess`、`.env.example`、`README.md`、`LICENSE`
- `VERSION.txt`（commit SHA + branch + 時間戳 + 構建資訊）

❌ 不包含（依 `.gitignore` 排除）：

- `runtime/` — SQLite DB、logs（部署後由伺服器自動建立）
- `.env` — 本地 secrets，絕不入庫
- `*.sqlite`, `*.log`, `*.bak`
- `.venv/`, `node_modules/`, `__pycache__/`

## 6. 一次性遠端設定（首次部署需要，之後不用重做）

### 6.1 PHP

確認 web server 已啟用 PHP 8.2+ 且 extensions：

```text
pdo_sqlite  json  curl  mbstring  openssl
```

### 6.2 runtime 目錄（建議放 `${DEPLOY_WEBROOT}` 外）

```bash
mkdir -p ${DEPLOY_RUNTIME}
chmod 750 ${DEPLOY_RUNTIME}
```

`.htaccess` 已擋 `runtime/` 的 HTTP 存取，但放外面更穩。

### 6.3 環境變數（web server VirtualHost / config / `~/.env`）

```apache
SetEnv STOCK_HOLD_RUNTIME_DIR "${DEPLOY_RUNTIME}"
SetEnv STOCK_HOLD_API_TOKEN    "<openssl rand -hex 32>"
SetEnv STOCK_HOLD_INIT_TOKEN   "<openssl rand -hex 32>"
SetEnv STOCK_HOLD_UPDATE_REPO  "kalapontsai/stock_hold"
```

參考 `.env.example` 取得完整變數清單。

### 6.4 首次 migration

若 SQLite 是新建立：

```bash
cd ${DEPLOY_WEBROOT}
php cli/migrate.php
```

### 6.5 首次註冊第一位使用者

用 `STOCK_HOLD_INIT_TOKEN` 註冊。詳見 `README.md`。

## 7. 回滾

最簡單：從 git reflog 重新打包前一版。

```bash
cd ~/.openclaw/workspace/repos/stock_hold
git log --oneline -5
git checkout <previous-sha>
bash scripts/package.sh
# 然後 §3 再做一次
```

或直接從備份還原（若你按 §3 留了 `${DEPLOY_WEBROOT}.bak.<timestamp>`）：

```bash
rsync -av --delete ${DEPLOY_WEBROOT}.bak.<timestamp>/ ${DEPLOY_WEBROOT}/
```

## 8. 與舊流程差異

| 舊（停用） | 新 |
|---|---|
| 本地 `<DOCKER_APACHE>/html/stock_hold` 工作目錄 | `~/.openclaw/workspace/repos/stock_hold/` 工作目錄 |
| `git pull` 推到本機 web server | `bash scripts/package.sh` → 手動複製 zip |
| `localhost/<WEB_SUBDIR>/` 路徑 | `https://${DEPLOY_HOST}/`（網域根或子目錄依部署） |
| 無部署版本標記 | `VERSION.txt` 含 commit SHA + 時間 |
| 本機 web server 自動 serve | 遠端手動部署 |

> 本機舊版部署路徑（停用）不再同步更新。
> 任何實際改動請在 workspace repo 進行。

## 9. 常見問題

**Q: package.sh 拒絕打包，說有 uncommitted changes？**
A: 先 commit。`git add -A && git commit -m "..."` 後重跑。
   真的想打包 working tree（含 uncommitted 改動）：不建議，但可用 `git stash` 自行處理。

**Q: 部署後 health endpoint 報 500？**
A: 看 web server error log（`tail -f ${DEPLOY_ERROR_LOG}`）。
   最常見：`STOCK_HOLD_RUNTIME_DIR` 未設或不可寫。

**Q: 部署後登入頁打開但 API 404？**
A: 確認 `.htaccess` 的 `RewriteEngine On` 與 `RewriteRule ^api/v1` 沒被覆蓋。
   部署時用 `rsync --delete`，確保沒有舊版殘檔。

**Q: zip 太大怎麼辦？**
A: 目前 ~145KB，全 tracked 檔案納入。`runtime/`、`node_modules/` 不會被打包。
   若想瘦身：可在 `scripts/package.sh` 加 exclude pattern（需改 git archive 為 tar pipeline）。

## 10. 推送 GitHub 前的最後檢查

```bash
# 確認文件不含 host / 路徑洩漏
grep -RnE 'tracker\.|\.elhomeo|public_html|/mnt/d/' DEPLOY.md scripts/ || echo "OK: no leak"
```

> 本文件於 2026-09-25 修訂，移除所有 deploy-host / host-path literal，
> 改為 `${VAR}` 佔位符。可直接 `git push` 不洩漏基礎設施資訊。
