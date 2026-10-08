# log/

This directory is intentionally committed (via `.gitkeep`) to document the
two distinct log streams in a stock_hold dev checkout:

| File pattern | Written by | Purpose |
|---|---|---|
| `program.log.YYYYMMDD` / `client.log.YYYYMMDD` / `notify.log.YYYYMMDD` | The **standalone Fubon Neo Python worker** (D:\Python\venv\fubon_api\), not by this repo | Per-day dumps the worker writes when its SDK fires internal events. Stock_hold PHP itself never writes here. |
| (none in repo) | `stock_hold` PHP backend via `sh_log()` | Lives on the server at `runtime/log/stock_hold.YYYY-MM-DD.log` (NDJSON). Not in this directory and not in git — the `*.log` rule in `.gitignore` covers it. |

When investigating a server-side incident, look at:

```bash
tail -f /path/to/webroot/runtime/log/stock_hold.$(date -u +%F).log | jq
```

…or grab a 30-day window via the `cli/log-cleanup.php` retention knob
(`STOCK_HOLD_LOG_RETENTION_DAYS`, default 30).

The `.gitkeep` file exists only so this README's directory survives a
checkout. The real, server-managed files are deliberately not tracked.