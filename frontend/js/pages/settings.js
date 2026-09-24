/**
 * stock_hold — Settings page (7 sections per WIREFRAME §5)
 *
 * Desktop: anchor nav on left + sections on right.
 * Mobile:  accordions, default collapsed (Settings §5.2 says "預設全部收合",
 *          but per Phase 3 wireframe notes we expand 帳戶 by default for context).
 */

import * as api from "../api-client.js";
import { t, setLocale, getLocale } from "../i18n.js";
import { formatDateTime } from "../format.js";
import { createDataTable } from "../components/data-table.js";
import { createModal, confirmDialog, toast } from "../components/modal.js";
import { escapeHtml } from "../utils/escape-html.js";

export async function mountSettings(root) {
  root.innerHTML = "";

  const header = document.createElement("div");
  header.className = "page-header";
  header.innerHTML = `<h1 class="page-header__title">${t("set.title")}</h1>`;
  root.appendChild(header);

  const layout = document.createElement("div");
  layout.className = "settings-layout";
  root.appendChild(layout);

  // Anchor nav (desktop)
  const nav = document.createElement("aside");
  nav.className = "settings-anchor";
  nav.setAttribute("aria-label", "設定分區");
  nav.innerHTML = `
    <a class="settings-anchor__link" href="#accounts">${t("set.anchor.accounts")}</a>
    <a class="settings-anchor__link" href="#securities">${t("set.anchor.securities")}</a>
    <a class="settings-anchor__link" href="#skills">${t("set.anchor.skills")}</a>
    <a class="settings-anchor__link" href="#token">${t("set.anchor.token")}</a>
    <a class="settings-anchor__link" href="#quotes">報價更新</a>
    <a class="settings-anchor__link" href="#appearance">${t("set.anchor.appearance")}</a>
    <a class="settings-anchor__link" href="#reconcile">${t("set.anchor.reconcile")}</a>
    <a class="settings-anchor__link" href="#maintenance">${t("set.anchor.maintenance")}</a>
  `;
  layout.appendChild(nav);

  const sections = document.createElement("div");
  layout.appendChild(sections);

  // Load
  const [accounts, securities, skills, quoteSettings] = await Promise.all([
    api.accounts.list().catch(() => []),
    api.securities.list().catch(() => []),
    api.skills.list().catch(() => []),
    api.quoteSettings.get().catch(() => ({ provider: "twse_mis", enabled: true, interval_minutes: 15, last_updated: null })),
  ]);

  // ───────── 1. 帳戶 ─────────
  const accountsSection = section(t("set.sec.accounts"), "accounts", true);
  const accountsHost = accountsSection.querySelector("[data-host]");
  accountsHost.appendChild(buildAccountsTable(accounts, () => mountSettings(root)));
  accountsSection.querySelector("[data-add]").addEventListener("click", () => openAccountModal(null, accounts, () => mountSettings(root)));
  sections.appendChild(accountsSection);

  // ───────── 2. 標的 ─────────
  const securitiesSection = section(t("set.sec.securities"), "securities", true);
  const securitiesHost = securitiesSection.querySelector("[data-host]");
  securitiesHost.appendChild(buildSecuritiesTable(securities, () => mountSettings(root)));
  securitiesSection.querySelector("[data-add]").addEventListener("click", () => openSecurityModal(null, securities, () => mountSettings(root)));
  sections.appendChild(securitiesSection);

  // ───────── 3. Skills ─────────
  const skillsSection = section(t("set.sec.skills"), "skills");
  const skillsHost = skillsSection.querySelector("[data-host]");
  skillsHost.appendChild(buildSkillsTable(skills));
  sections.appendChild(skillsSection);

  // ───────── 4. API Token ─────────
  const tokenSection = section(t("set.sec.token"), "token");
  tokenSection.querySelector("[data-host]").innerHTML = `
    <p style="margin-bottom: var(--space-3); color: var(--color-text-muted); font-size: var(--text-sm);">${t("set.token.label")}</p>
    <div class="input-group" style="max-width: 420px;">
      <input type="password" class="input" value="•••••••••••••••••••••••" readonly id="api-token-input">
      <button type="button" class="btn btn--ghost btn--sm" style="position:absolute; right: 8px; top: 4px;" id="api-token-show">${t("action.show")}</button>
    </div>
    <div style="margin-top: var(--space-3); font-size: var(--text-sm); color: var(--color-text-muted);">
      ${t("set.token.permission", { perm: "agent" })} · ${t("set.token.ipRestriction", { ip: "127.0.0.1 / ::1" })}
    </div>
    <div style="margin-top: var(--space-4);">
      <button type="button" class="btn btn--danger" data-action="regenerate">${t("action.regenerate")}</button>
    </div>
  `;
  const tokenInput = tokenSection.querySelector("#api-token-input");
  tokenSection.querySelector("#api-token-show").addEventListener("click", () => {
    if (tokenInput.type === "password") {
      tokenInput.type = "text";
      tokenInput.value = "sk_stock_hold_" + Math.random().toString(36).slice(2, 18);
      tokenSection.querySelector("#api-token-show").textContent = t("action.hide");
    } else {
      tokenInput.type = "password";
      tokenInput.value = "•••••••••••••••••••••••";
      tokenSection.querySelector("#api-token-show").textContent = t("action.show");
    }
  });
  tokenSection.querySelector("[data-action=regenerate]").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: t("action.regenerate"),
      body: "重新產生後舊 token 將立即失效，外部呼叫會失敗。確定繼續？",
      confirmLabel: t("action.confirm"),
      confirmTone: "danger",
    });
    if (!ok) return;
    toast("瀏覽器顯示用 token 已重新產生；正式 token 請由伺服器環境設定。", { tone: "success" });
  });
  sections.appendChild(tokenSection);

  // ───────── 5. Quote updates ─────────
  const quoteSection = section("報價更新", "quotes");
  quoteSection.querySelector("[data-host]").innerHTML = `
    <p class="form-field__hint">由 Apache/PHP 伺服器端抓取行情並保存到 SQLite，瀏覽器不直接連線外部報價站。</p>
    <div class="form-field">
      <label class="form-field__label" for="quote-provider">報價來源</label>
      <select class="select" id="quote-provider">
        <option value="twse_mis">台灣證交所 MIS（免 API key）</option>
        <option value="manual">手動匯入</option>
      </select>
    </div>
    <div class="form-field">
      <label class="form-field__label" for="quote-interval">更新間隔（分鐘）</label>
      <input class="input input--number" id="quote-interval" type="number" min="1" max="1440" step="1" value="${escapeHtml(quoteSettings.interval_minutes)}">
      <span class="form-field__hint">供排程更新使用；也可按「立即更新」即時抓取。</span>
    </div>
    <label class="form-field" style="display:flex; gap:var(--space-2); align-items:center;">
      <input type="checkbox" id="quote-enabled" ${quoteSettings.enabled ? "checked" : ""}>
      <span class="form-field__label" style="margin:0;">啟用報價更新</span>
    </label>
    <div style="display:flex; gap:var(--space-3); align-items:center; flex-wrap:wrap;">
      <button type="button" class="btn btn--primary" data-action="save-quotes">儲存設定</button>
      <button type="button" class="btn btn--secondary" data-action="refresh-quotes">立即更新全部持股</button>
      <span class="form-field__hint" data-quote-status>${quoteSettings.last_updated ? `最後更新：${escapeHtml(formatDateTime(quoteSettings.last_updated))}` : "尚未更新"}</span>
    </div>
  `;
  quoteSection.querySelector("#quote-provider").value = quoteSettings.provider;
  quoteSection.querySelector("[data-action=save-quotes]").addEventListener("click", async () => {
    try {
      const value = Number(quoteSection.querySelector("#quote-interval").value);
      await api.quoteSettings.update({
        provider: quoteSection.querySelector("#quote-provider").value,
        enabled: quoteSection.querySelector("#quote-enabled").checked,
        interval_minutes: value,
      });
      toast("報價設定已儲存", { tone: "success" });
    } catch (e) { toast(e.message, { tone: "error" }); }
  });
  quoteSection.querySelector("[data-action=refresh-quotes]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api.maintenance.refreshPrices({ symbols: [] });
      const settings = await api.quoteSettings.get();
      quoteSection.querySelector("[data-quote-status]").textContent = `已更新 ${result.updated} 筆；最後更新：${formatDateTime(settings.last_updated)}`;
      toast(`報價更新完成（${result.updated} 筆）`, { tone: "success" });
    } catch (e) { toast(e.message, { tone: "error" }); }
    finally { button.disabled = false; }
  });
  sections.appendChild(quoteSection);

  // ───────── 6. Appearance ─────────
  const appearanceSection = section(t("set.sec.appearance"), "appearance");
  appearanceSection.querySelector("[data-host]").innerHTML = `
    <div class="form-field">
      <span class="form-field__label">${t("set.appearance.theme")}</span>
      <div class="radio-group" data-theme-group role="radiogroup">
        <label class="radio-group__item"><input type="radio" name="theme" value="light"> ${t("set.appearance.light")}</label>
        <label class="radio-group__item"><input type="radio" name="theme" value="dark"> ${t("set.appearance.dark")}</label>
        <label class="radio-group__item"><input type="radio" name="theme" value="system"> ${t("set.appearance.system")}</label>
      </div>
    </div>
    <div class="form-field">
      <span class="form-field__label">${t("set.appearance.numFont")}</span>
      <div class="radio-group" data-numfont-group role="radiogroup">
        <label class="radio-group__item"><input type="radio" name="numfont" value="tabular" checked> ${t("set.appearance.tabular")}</label>
        <label class="radio-group__item"><input type="radio" name="numfont" value="proportional"> ${t("set.appearance.proportional")}</label>
      </div>
    </div>
    <div class="form-field">
      <label class="form-field__label" for="base-ccy">${t("set.appearance.baseCcy")}</label>
      <select class="select" id="base-ccy">
        <option value="TWD" selected>TWD</option>
        <option value="USD">USD</option>
        <option value="JPY">JPY</option>
      </select>
    </div>
  `;
  // Theme sync with current data-theme
  const themeGroup = appearanceSection.querySelector("[data-theme-group]");
  const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
  themeGroup.querySelector(`input[value="${currentTheme}"]`)?.setAttribute("checked", "");
  themeGroup.addEventListener("change", (e) => {
    const val = e.target.value;
    if (val === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
    } else {
      document.documentElement.setAttribute("data-theme", val);
    }
    try { localStorage.setItem("stock_hold.theme", val); } catch (_) {}
  });
  sections.appendChild(appearanceSection);

  // ───────── 7. Reconcile ─────────
  const reconcileSection = section(t("set.sec.reconcile"), "reconcile");
  reconcileSection.querySelector("[data-host]").innerHTML = `
    <div class="form-field" style="max-width: 240px;">
      <label class="form-field__label" for="reconcile-tol">${t("set.reconcile.tolerance")}</label>
      <input type="text" inputmode="decimal" class="input input--number" id="reconcile-tol" value="0.01">
      <span class="form-field__hint">${t("set.reconcile.unit")}</span>
    </div>
    <div style="display:flex; gap: var(--space-3); align-items: center;">
      <button type="button" class="btn btn--primary" data-action="reconcile">${t("action.runReconcile")}</button>
      <span class="form-field__hint">${t("set.reconcile.lastRun", { ts: "2026-09-20 09:00" })}</span>
    </div>
  `;
  reconcileSection.querySelector("[data-action=reconcile]").addEventListener("click", async () => {
    try {
      await api.maintenance.reconcile({ tolerance: "0.01" });
      toast("對帳完成", { tone: "success" });
    } catch (e) {
      toast(e.message, { tone: "error" });
    }
  });
  sections.appendChild(reconcileSection);

  // ───────── 8. Maintenance ─────────
  const maintenanceSection = section(t("set.sec.maintenance"), "maintenance");
  maintenanceSection.querySelector("[data-host]").innerHTML = `
    <div style="display:flex; flex-wrap: wrap; gap: var(--space-3);">
      <button type="button" class="btn btn--secondary" data-action="backup">${t("action.backup")}</button>
      <button type="button" class="btn btn--secondary" data-action="restore">${t("action.restore")}</button>
      <button type="button" class="btn btn--secondary" data-action="health">${t("action.healthCheck")}</button>
      <button type="button" class="btn btn--secondary" data-action="update">${t("action.checkUpdate")}</button>
    </div>
  `;
  maintenanceSection.querySelector("[data-action=backup]").addEventListener("click", async () => {
    try { const result = await api.maintenance.backup(); toast(`備份完成：${result.backup_file}`, { tone: "success" }); }
    catch (e) { toast(e.message, { tone: "error" }); }
  });
  maintenanceSection.querySelector("[data-action=restore]").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: t("action.restore"),
      body: "從備份還原會覆蓋現有資料。請先確認已備份最新狀態。",
      confirmLabel: t("action.confirm"),
      confirmTone: "danger",
    });
    if (!ok) return;
    const backupFile = window.prompt("請輸入 runtime/backup 內的備份檔名：");
    if (!backupFile) return;
    try { await api.maintenance.restore({ backup_file: backupFile, confirm: true }); toast("還原完成，請重新整理頁面。", { tone: "success" }); }
    catch (e) { toast(e.message, { tone: "error" }); }
  });
  maintenanceSection.querySelector("[data-action=health]").addEventListener("click", async () => {
    try { await api.rawRequest("GET", "/health"); toast("健康檢查通過", { tone: "success" }); }
    catch (e) { toast(e.message, { tone: "error" }); }
  });
  maintenanceSection.querySelector("[data-action=update]").addEventListener("click", () => toast("目前版本由本機 Apache 提供，請依部署流程更新檔案。", { tone: "info" }));
  sections.appendChild(maintenanceSection);

  // Apply i18n from saved locale
  const cur = getLocale();
  if (cur === "en") toast("Switched to English (i18n demo)", { tone: "info", durationMs: 2000 });
}

/* --------- Section container --------- */
function section(title, anchor, open = false) {
  const sec = document.createElement("section");
  sec.className = "card section";
  sec.id = anchor;
  sec.innerHTML = `
    <div class="card__header">
      <h2 class="card__title">${title}</h2>
      <div class="card__actions">
        <button type="button" class="btn btn--primary btn--sm" data-add>+ ${t("action.add")}</button>
      </div>
    </div>
    <div data-host></div>
  `;
  if (!open) sec.querySelector("[data-add]").style.display = "none";
  return sec;
}

/* --------- Tables --------- */
function buildAccountsTable(accounts, refresh) {
  const tbl = createDataTable({
    columns: [
      { key: "type", header: "類型", cell: (r) => `<span class="badge ${r.type === "BANK" ? "badge--info" : "badge--neutral"}">${escapeHtml(t("set.acc.type." + String(r.type ?? "").toLowerCase()))}</span>` },
      { key: "name", header: "名稱", cell: (r) => `<strong>${escapeHtml(r.name)}</strong>` },
      { key: "currency", header: "幣別", cell: (r) => `<span class="chip">${escapeHtml(r.currency)}</span>` },
      { key: "broker", header: "券商 / 行庫", cell: (r) => r.broker ? escapeHtml(r.broker) : "—" },
      { key: "account_no", header: "帳號", cell: (r) => escapeHtml(r.account_no) },
      { key: "status", header: "狀態", cell: (r) => String(r.status).toLowerCase() === "active"
        ? `<span class="badge badge--positive">${escapeHtml(t("set.acc.status.active"))}</span>`
        : `<span class="badge badge--neutral">${escapeHtml(t("set.acc.status.disabled"))}</span>` },
      { key: "actions", header: "", cell: (r) => {
        const isInactive = String(r.status).toLowerCase() !== "active";
        // 仍列出刪除按鈕，但停用中的帳戶明確標示，刪除按鈕文字與行為都對齊「停用」語意
        return `<button type="button" class="btn btn--ghost btn--sm" data-edit="${escapeHtml(r.id)}">${escapeHtml(t("action.edit"))}</button>
           <button type="button" class="btn btn--ghost btn--sm" data-del="${escapeHtml(r.id)}" ${isInactive ? "disabled" : ""}>${escapeHtml(t("set.acc.action.disable"))}</button>`;
      } },
    ],
    data: accounts,
    rowKey: (r) => r.id,
    // 讓 is-inactive 視覺樣式（刪除線 + 灰色名字）套到停用中的帳戶
    rowClass: (r) => String(r.status).toLowerCase() !== "active" ? "is-inactive" : "",
  });
  // Wire action buttons (delegated)
  tbl.el.addEventListener("click", async (e) => {
    const editId = e.target.closest("[data-edit]")?.dataset.edit;
    const delId = e.target.closest("[data-del]")?.dataset.del;
    if (editId) openAccountModal(accounts.find(a => a.id === editId), accounts, refresh);
    if (delId) {
      const target = accounts.find(a => a.id === delId);
      // 已停用的帳戶按鈕雖然 disabled，但保險起見再做一次 runtime guard
      if (target && String(target.status).toLowerCase() !== "active") {
        toast("此帳戶已停用", { tone: "info" });
        return;
      }
      const ok = await confirmDialog({
        title: t("set.acc.confirmDisable.title"),
        body: t("set.acc.confirmDisable.body"),
        confirmLabel: t("set.acc.action.disable"),
        confirmTone: "danger",
      });
      if (ok) {
        try {
          await api.accounts.remove(delId);
          toast("已停用", { tone: "success" });
          await refresh();
        } catch (e) {
          toast(e?.message || "停用帳戶失敗", { tone: "error" });
        }
      }
    }
  });
  return tbl.el;
}

function buildSecuritiesTable(securities, refresh) {
  const tbl = createDataTable({
    columns: [
      { key: "symbol", header: "代碼", cell: (r) => `<strong>${escapeHtml(r.symbol)}</strong>` },
      { key: "name", header: "名稱", cell: (r) => escapeHtml(r.name) },
      { key: "exchange", header: "市場", cell: (r) => `<span class="chip">${escapeHtml(r.exchange)}</span>` },
      { key: "currency", header: "幣別", cell: (r) => `<span class="chip">${escapeHtml(r.currency)}</span>` },
      { key: "type", header: "類型", cell: (r) => `<span class="badge ${r.type === "ETF" ? "badge--info" : "badge--neutral"}">${escapeHtml(r.type)}</span>` },
      { key: "sector", header: "產業", cell: (r) => escapeHtml(r.sector) },
      { key: "status", header: "狀態", cell: (r) => r.is_active !== false && String(r.status ?? "active").toLowerCase() !== "disabled" ? `<span class="badge badge--positive">啟用</span>` : `<span class="badge badge--neutral">停用</span>` },
      { key: "actions", header: "", cell: (r) =>
          `<button type="button" class="btn btn--ghost btn--sm" data-edit="${escapeHtml(r.id)}">${escapeHtml(t("action.edit"))}</button>
           <button type="button" class="btn btn--ghost btn--sm" data-del="${escapeHtml(r.id)}">${escapeHtml(t("action.delete"))}</button>` },
    ],
    data: securities,
    rowKey: (r) => r.id,
  });
  tbl.el.addEventListener("click", (e) => {
    const editId = e.target.closest("[data-edit]")?.dataset.edit;
    const delId = e.target.closest("[data-del]")?.dataset.del;
    if (editId) openSecurityModal(securities.find(s => s.id === editId), securities, refresh);
    if (delId) {
      confirmDialog({
        title: "停用標的",
        body: "停用後不會刪除既有交易紀錄。確定繼續？",
        confirmLabel: t("action.confirm"),
        confirmTone: "danger",
      }).then(async (ok) => {
        if (!ok) return;
        try {
          await api.securities.remove(delId);
          toast("已停用", { tone: "success" });
          await refresh();
        } catch (e) {
          toast(e?.message || "停用標的失敗", { tone: "error" });
        }
      });
    }
  });
  return tbl.el;
}

function buildSkillsTable(skills) {
  const tbl = createDataTable({
    columns: [
      { key: "name", header: "Skill", cell: (r) => `<code>${escapeHtml(r.name)}</code>` },
      { key: "source", header: "資料源", cell: (r) => escapeHtml(r.source) },
      { key: "enabled", header: "狀態", cell: (r) => {
        const sw = `
          <label class="switch" aria-label="啟用 ${escapeHtml(r.name)}">
            <input type="checkbox" ${r.enabled ? "checked" : ""} data-skill="${escapeHtml(r.name)}">
            <span class="switch__slider"></span>
          </label>
        `;
        return sw + ` <button type="button" class="btn btn--ghost btn--sm" data-run="${escapeHtml(r.name)}">${escapeHtml(t("action.run"))}</button>`;
      }},
      { key: "last_run_at", header: "上次執行", cell: (r) => r.last_run_at ? `<span class="num">${escapeHtml(formatDateTime(r.last_run_at))}</span>` : "—" },
    ],
    data: skills,
    rowKey: (r) => r.name,
  });
  tbl.el.addEventListener("change", async (e) => {
    if (e.target.matches("[data-skill]")) {
      try {
        await api.skills.toggle(e.target.dataset.skill, { enabled: e.target.checked });
        toast("已更新", { tone: "success" });
      } catch (e) { toast(e.message, { tone: "error" }); }
    }
  });
  tbl.el.addEventListener("click", async (e) => {
    const runName = e.target.closest("[data-run]")?.dataset.run;
    if (runName) {
      try { await api.skills.run(runName, {}); toast(`${runName} 執行中…`, { tone: "info" }); }
      catch (e) { toast(e.message, { tone: "error" }); }
    }
  });
  return tbl.el;
}

/* --------- Account / Security modals --------- */
function openAccountModal(row, accounts, refresh) {
  const isEdit = !!row;
  const m = createModal({ title: isEdit ? "編輯帳戶" : "新增帳戶", size: "md" });
  // H-4: every interpolated value in this template comes from `row` (server)
  // and lands inside an HTML attribute or text node — escape them all.
  const v = {
    name: escapeHtml(row?.name ?? ""),
    account_no: escapeHtml(row?.account_no ?? ""),
    broker: escapeHtml(row?.broker ?? ""),
    currency: escapeHtml(row?.currency ?? "TWD"),
    type: escapeHtml(row?.type ?? "BANK"),
  };
  m.body.innerHTML = `
    <form>
      <div class="form-field">
        <label class="form-field__label" for="acc-type">類型</label>
        <select class="select" id="acc-type" name="type">
          <option value="BANK" ${v.type === "BANK" ? "selected" : ""}>銀行</option>
          <option value="BROKER" ${v.type === "BROKER" ? "selected" : ""}>券商</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-field__label form-field__label--required" for="acc-name">名稱</label>
        <input class="input" id="acc-name" name="name" required value="${v.name}">
      </div>
      <div class="grid grid--two">
        <div class="form-field">
          <label class="form-field__label" for="acc-ccy">幣別</label>
          <select class="select" id="acc-ccy" name="currency">
            <option value="TWD" ${v.currency === "TWD" ? "selected" : ""}>TWD</option>
            <option value="USD" ${v.currency === "USD" ? "selected" : ""}>USD</option>
            <option value="JPY" ${v.currency === "JPY" ? "selected" : ""}>JPY</option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-field__label" for="acc-no">帳號</label>
          <input class="input" id="acc-no" name="account_no" value="${v.account_no}">
        </div>
      </div>
      <div class="form-field">
        <label class="form-field__label" for="acc-broker">券商 / 行庫</label>
        <input class="input" id="acc-broker" name="broker" value="${v.broker}">
      </div>
    </form>
  `;
  const cancel = document.createElement("button");
  cancel.className = "btn btn--secondary"; cancel.textContent = t("action.cancel");
  cancel.addEventListener("click", () => m.close());
  m.footer.appendChild(cancel);
  const save = document.createElement("button");
  save.className = "btn btn--primary"; save.textContent = t("action.save");
  save.addEventListener("click", async () => {
    const form = m.body.querySelector("form");
    if (!form.reportValidity()) return;
    const fd = new FormData(form);
    const body = {
      type: String(fd.get("type") || "BANK"),
      name: String(fd.get("name") || "").trim(),
      currency: String(fd.get("currency") || "TWD").toUpperCase(),
      broker: String(fd.get("broker") || "").trim() || null,
      account_no: String(fd.get("account_no") || "").trim() || null,
    };
    save.disabled = true;
    try {
      if (isEdit) await api.accounts.update(row.id, body);
      else await api.accounts.create(body);
      toast(t("saved"), { tone: "success" });
      m.close();
      await refresh();
    } catch (e) {
      save.disabled = false;
      toast(e?.message || "儲存帳戶失敗", { tone: "error" });
    }
  });
  m.footer.appendChild(save);
  m.show();
}

function openSecurityModal(row, securities, refresh) {
  const isEdit = !!row;
  const m = createModal({ title: isEdit ? "編輯標的" : "新增標的", size: "md" });
  // H-4: same rule as openAccountModal — escape all server-derived values
  // before they land inside an HTML attribute.
  const v = {
    symbol: escapeHtml(row?.symbol ?? ""),
    name: escapeHtml(row?.name ?? ""),
    exchange: escapeHtml(row?.exchange ?? "TW"),
    currency: escapeHtml(row?.currency ?? "TWD"),
    type: escapeHtml(row?.type ?? "STOCK"),
  };
  m.body.innerHTML = `
    <form>
      <div class="grid grid--two">
        <div class="form-field">
          <label class="form-field__label form-field__label--required">代碼</label>
          <input class="input" name="symbol" required value="${v.symbol}">
        </div>
        <div class="form-field">
          <label class="form-field__label">市場</label>
          <select class="select" name="exchange">
            <option value="TW" ${v.exchange === "TW" ? "selected" : ""}>TW</option>
            <option value="US" ${v.exchange === "US" ? "selected" : ""}>US</option>
          </select>
        </div>
      </div>
      <div class="form-field">
        <label class="form-field__label form-field__label--required">名稱</label>
        <input class="input" name="name" required value="${v.name}">
      </div>
      <div class="grid grid--two">
        <div class="form-field">
          <label class="form-field__label">幣別</label>
          <select class="select" name="currency">
            <option value="TWD" ${v.currency === "TWD" ? "selected" : ""}>TWD</option>
            <option value="USD" ${v.currency === "USD" ? "selected" : ""}>USD</option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-field__label">類型</label>
          <select class="select" name="type">
            <option value="STOCK" ${v.type === "STOCK" ? "selected" : ""}>STOCK</option>
            <option value="ETF" ${v.type === "ETF" ? "selected" : ""}>ETF</option>
            <option value="FUND" ${v.type === "FUND" ? "selected" : ""}>FUND</option>
          </select>
        </div>
      </div>
    </form>
  `;
  const cancel = document.createElement("button");
  cancel.className = "btn btn--secondary"; cancel.textContent = t("action.cancel");
  cancel.addEventListener("click", () => m.close());
  m.footer.appendChild(cancel);
  const save = document.createElement("button");
  save.className = "btn btn--primary"; save.textContent = t("action.save");
  save.addEventListener("click", async () => {
    const form = m.body.querySelector("form");
    if (!form.reportValidity()) return;
    const fd = new FormData(form);
    const body = {
      symbol: String(fd.get("symbol") || "").trim().toUpperCase(),
      exchange: String(fd.get("exchange") || "TW").trim().toUpperCase(),
      currency: String(fd.get("currency") || "TWD").toUpperCase(),
      name: String(fd.get("name") || "").trim(),
      type: String(fd.get("type") || "STOCK").toUpperCase(),
    };
    save.disabled = true;
    try {
      if (isEdit) await api.securities.update(row.id, body);
      else await api.securities.create(body);
      toast(t("saved"), { tone: "success" });
      m.close();
      await refresh();
    } catch (e) {
      save.disabled = false;
      toast(e?.message || "儲存標的失敗", { tone: "error" });
    }
  });
  m.footer.appendChild(save);
  m.show();
}

function escapeHtml_REMOVED() { /* moved to utils/escape-html.js (H-4) */ }
