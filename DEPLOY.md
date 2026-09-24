# Stock Hold — Deployment Runbook

> 從 **2026-09-25** 起，stock_hold 改採 **zip 交付** 模式：
> 開發在 `~/.openclaw/workspace/repos/stock_hold/`，完成後打包成 zip，手動複製到遠端主機。

## 流程總覽

```
~/.openclaw/workspace/repos/stock_hold/   (develop, commit)
        │
        │  bash scripts/package.sh
        ▼
/mnt/d/deploy/stock_hold_deploy.zip      (交付物)
        │
        │  (manual: scp / SFTP / 隨身碟 / …)
        ▼
LiteSpeed public_html/                    (部署位置)
        │
        │  smoke test
        ▼
https://tracker.elhomeo.com/
```

## 1. 本地打包

```bash
cd ~/.openclaw/workspace/repos/stock_hold
bash scripts/validate.sh           # 跑靜態檢查
git status                         # 確認 working tree 已 commit
git log --oneline -5                # 確認要打包哪個 commit
bash scripts/package.sh            # 產出 zip
```

預設輸出：

```text
/mnt/d/deploy/stock_hold_deploy.zip
```

可在呼叫時覆寫：

```bash
DEPLOY_DIR=~/my-other-deploy bash scripts/package.sh
```

## 2. 複製到遠端

由你決定方式（scp / SFTP / USB / Cloudflare R2 / …）。

| 方式 | 範例指令 |
|---|---|
| SCP | `scp /mnt/d/deploy/stock_hold_deploy.zip user@tracker.elhomeo.com:~/` |
| SFTP | FileZilla / WinSCP 拉到 `~/` 或 `/tmp/` |
| USB | 直接 copy |

## 3. 遠端解壓與部署

```bash
# 在遠端主機（SSH 進 LiteSpeed）
cd ~
unzip stock_hold_deploy.zip -d stock_hold_staging

# (可選) 比對內容
rsync -avn --delete stock_hold_staging/ ~/public_html/

# 部署前先備份舊版（建議）
mv ~/public_html ~/public_html.bak.$(date +%Y%m%d-%H%M)

# 正式部署
rsync -av --delete stock_hold_staging/ ~/public_html/
```

> `--delete` 確保移除舊版殘留檔。

## 4. 部署後驗證

```bash
# (1) 確認部署的版本
cat ~/public_html/VERSION.txt
# 對照 git log 確認 Commit SHA 正確

# (2) health endpoint
curl -i https://tracker.elhomeo.com/api/v1/health
# 預期：200 + JSON {"status":"ok","data":{"service":"stock_hold",...}}

# (3) auth session
curl -i https://tracker.elhomeo.com/api/v1/auth/session
# 預期：200 + JSON 含 csrf_token

# (4) 靜態頁
curl -I https://tracker.elhomeo.com/
curl -I https://tracker.elhomeo.com/frontend/login.html

# (5) 確認 .env 沒被上傳（dev 不能 commit，部署後只能由你手動放）
test ! -f ~/public_html/.env && echo "OK: no .env"

# (6) 確認 runtime 目錄存在且可寫
ls -ld ~/runtime/stock_hold
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

確認 LiteSpeed 已啟用 PHP 8.2+ 且 extensions：

```text
pdo_sqlite  json  curl  mbstring  openssl
```

### 6.2 runtime 目錄（建議放 `public_html` 外）

```bash
mkdir -p ~/runtime/stock_hold
chmod 750 ~/runtime/stock_hold
```

`.htaccess` 已擋 `runtime/` 的 HTTP 存取，但放外面更穩。

### 6.3 環境變數（LiteSpeed VirtualHost 或 `~/.env`）

```apache
SetEnv STOCK_HOLD_RUNTIME_DIR "/home/<user>/runtime/stock_hold"
SetEnv STOCK_HOLD_API_TOKEN    "<openssl rand -hex 32>"
SetEnv STOCK_HOLD_INIT_TOKEN   "<openssl rand -hex 32>"
SetEnv STOCK_HOLD_UPDATE_REPO  "kalapontsai/stock_hold"
```

參考 `.env.example` 取得完整變數清單。

### 6.4 首次 migration

若 SQLite 是新建立：

```bash
cd ~/public_html
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

或直接從備份還原（若你按 §3 留了 `public_html.bak.<timestamp>`）：

```bash
rsync -av --delete ~/public_html.bak.<timestamp>/ ~/public_html/
```

## 8. 與舊流程差異

| 舊（停用） | 新 |
|---|---|
| `D:\docker-volumn\ubuntu-apache2\html\stock_hold` 工作目錄 | `~/.openclaw/workspace/repos/stock_hold/` 工作目錄 |
| `git pull` 推到 Apache | `bash scripts/package.sh` → 手動複製 zip |
| `localhost/stock_hold/` 路徑 | `https://tracker.elhomeo.com/`（網域根） |
| 無部署版本標記 | `VERSION.txt` 含 commit SHA + 時間 |
| 本地 Apache 自動 serve | LiteSpeed 手動部署 |

> 本地 Apache 部署 (`D:\docker-volumn\ubuntu-apache2\html\stock_hold`) 自 2026-09-25 起**凍結**，
> 保留作為緊急 fallback，不再同步更新。任何實際改動請在 workspace repo 進行。

## 9. 常見問題

**Q: package.sh 拒絕打包，說有 uncommitted changes？**
A: 先 commit。`git add -A && git commit -m "..."` 後重跑。
   真的想打包 working tree（含 uncommitted 改動）：不建議，但可用 `git stash`/`git diff` 自行處理。

**Q: 部署後 health endpoint 報 500？**
A: 看 LiteSpeed error log（`~/logs/<site>/error.log`）。
   最常見：`STOCK_HOLD_RUNTIME_DIR` 未設或不可寫。

**Q: 部署後登入頁打開但 API 404？**
A: 確認 `.htaccess` 的 `RewriteEngine On` 與 `RewriteRule ^api/v1` 沒被覆蓋。
   部署時用 `rsync --delete`，確保沒有舊版殘檔。

**Q: zip 太大怎麼辦？**
A: 目前 ~145KB，全 tracked 檔案納入。`runtime/`、`node_modules/` 不會被打包。
   若想瘦身：可在 `scripts/package.sh` 加 exclude pattern（需改 git archive 為 tar pipeline）。
