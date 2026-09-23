/**
 * stock_hold — Transactions page (CRUD with filter + modal)
 *
 * Wireframe §2: filter bar + table (desktop) / card list (mobile) + modal
 * for create/edit. Batch delete uses ConfirmDialog.
 */

import * as api from "../api-client.js";
import { t } from "../i18n.js";
import { formatMoney, formatQty, formatDate } from "../format.js";
import { createDataTable } from "../components/data-table.js";
import { createModal, confirmDialog, toast } from "../components/modal.js";
import { createCurrencyInput } from "../components/currency-input.js";

const TYPE_KEYS = ["BUY","SELL","DIVIDEND","DEPOSIT","WITHDRAW","TRANSFER_IN","TRANSFER_OUT","FEE","SPLIT","MERGER"];

export async function mountTransactions(root) {
  root.innerHTML = "";

  // --- Page header
  const header = document.createElement("div");
  header.className = "page-header";
  header.innerHTML = `
    <div class="page-header__row">
      <h1 class="page-header__title">${t("txn.title")}</h1>
      <div class="page-header__actions">
        <button type="button" class="btn btn--secondary" data-action="refresh">
          <span aria-hidden="true">↻</span> ${t("action.refresh")}
        </button>
        <button type="button" class="btn btn--primary" data-action="add">+ ${t("txn.add")}</button>
      </div>
    </div>
  `;
  root.appendChild(header);

  // --- Filter bar
  const filterBar = document.createElement("div");
  filterBar.className = "filter-bar";
  filterBar.setAttribute("role", "search");
  filterBar.innerHTML = `
    <div class="filter-bar__group">
      <span class="filter-bar__label">${t("txn.filter.dateRange")}</span>
      <div class="filter-bar__chip-group" data-range-chips>
        <button type="button" class="btn btn--sm btn--secondary" data-range="thisWeek">${t("filter.range.thisWeek")}</button>
        <button type="button" class="btn btn--sm btn--secondary" data-range="thisMonth">${t("filter.range.thisMonth")}</button>
        <button type="button" class="btn btn--sm btn--secondary" data-range="thisQuarter">${t("filter.range.thisQuarter")}</button>
        <button type="button" class="btn btn--sm btn--secondary" data-range="thisYear">${t("filter.range.thisYear")}</button>
        <button type="button" class="btn btn--sm btn--secondary" data-range="custom">${t("filter.range.custom")}</button>
      </div>
      <div class="filter-bar__custom-range" hidden data-custom-range>
        <input type="date" class="input" data-from style="height:32px;width:auto">
        <span aria-hidden="true">~</span>
        <input type="date" class="input" data-to style="height:32px;width:auto">
      </div>
    </div>
    <div class="filter-bar__group">
      <label class="filter-bar__label" for="txn-filter-account">${t("txn.filter.account")}</label>
      <select id="txn-filter-account" class="select" data-filter="account" style="width:auto;min-width:140px;height:32px">
        <option value="">${t("filter.range.thisYear") /* placeholder: all */} 全部</option>
      </select>
    </div>
    <div class="filter-bar__group">
      <label class="filter-bar__label" for="txn-filter-type">${t("txn.filter.type")}</label>
      <select id="txn-filter-type" class="select" data-filter="type" style="width:auto;min-width:120px;height:32px">
        <option value="">全部</option>
      </select>
    </div>
    <div class="filter-bar__group" style="flex:1;min-width:160px">
      <label class="filter-bar__label" for="txn-filter-search">${t("action.search")}</label>
      <input type="search" id="txn-filter-search" class="input" placeholder="${t("txn.searchPlaceholder")}" data-filter="search" style="height:32px">
    </div>
    <div class="filter-bar__actions">
      <button type="button" class="btn btn--ghost btn--sm" data-action="clear">${t("action.clearAll")}</button>
    </div>
  `;
  root.appendChild(filterBar);

  // --- Table host
  const tableHost = document.createElement("div");
  root.appendChild(tableHost);

  // --- Batch action bar
  const batchBar = document.createElement("div");
  batchBar.style.marginTop = "var(--space-3)";
  batchBar.style.display = "none";
  batchBar.innerHTML = `
    <span data-selected-count></span>
    <button type="button" class="btn btn--danger btn--sm" data-action="batch-delete">${t("txn.batchDelete")}</button>
  `;
  root.appendChild(batchBar);

  // --- State
  const state = {
    range: "thisMonth",
    from: null, to: null,
    account: "", type: "", search: "",
    rows: [],
  };

  // --- Load accounts + type options
  const [accounts, securities, initial] = await Promise.all([
    api.accounts.list().catch(() => []),
    api.securities.list().catch(() => []),
    api.transactions.list().catch(() => []),
  ]);
  const accountSel = filterBar.querySelector('[data-filter="account"]');
  accounts.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id; opt.textContent = a.name;
    accountSel.appendChild(opt);
  });
  const typeSel = filterBar.querySelector('[data-filter="type"]');
  TYPE_KEYS.forEach((k) => {
    const opt = document.createElement("option");
    opt.value = k; opt.textContent = t("txnType." + k);
    typeSel.appendChild(opt);
  });

  // Default range to this month
  applyRangePreset("thisMonth");

  let table;
  function buildTable(rows) {
    tableHost.innerHTML = "";
    table = createDataTable({
      columns: [
        {
          key: "txn_date", header: t("txn.col.date"), sortable: true, width: "110px",
          cell: (row) => `<span class="num">${formatDate(row.txn_date)}</span>`,
        },
        {
          key: "account_id", header: t("txn.col.account"),
          cell: (row) => nameOf(accounts, row.account_id),
        },
        {
          key: "type", header: t("txn.col.type"), sortable: true, width: "90px",
          cell: (row) => `<span class="badge ${typeBadgeClass(row.type)}">${t("txnType." + row.type)}</span>`,
        },
        {
          key: "security_id", header: t("txn.col.symbol"),
          cell: (row) => row.security_id ? symbolOf(securities, row.security_id) : "—",
        },
        {
          key: "qty", header: t("txn.col.qty"), numeric: true, align: "right", width: "100px",
          cell: (row) => row.qty ? formatQty(row.qty) : "—",
        },
        {
          key: "price", header: t("txn.col.price"), numeric: true, align: "right", width: "100px",
          cell: (row) => row.price ? formatMoney(row.price, "TWD") : "—",
        },
        {
          key: "amount", header: t("txn.col.amount"), numeric: true, align: "right", width: "140px",
          cell: (row) => {
            const amt = computeAmount(row);
            const cls = amt.startsWith("+") ? "value-positive" : amt.startsWith("-") ? "value-negative" : "";
            return `<span class="${cls}">${amt}</span>`;
          },
        },
        {
          key: "note", header: t("txn.col.note"),
          cell: (row) => row.note ? escapeHtml(row.note) : "",
        },
      ],
      data: rows,
      rowKey: (r) => r.id,
      caption: t("txn.title"),
      selectable: true,
      initialSort: { key: "txn_date", direction: "descending" },
      onRowClick: (row) => openEditModal(row),
    });
    tableHost.appendChild(table.el);
    updateBatchBar();
  }

  function updateBatchBar() {
    const sel = table ? table.getSelected() : [];
    if (sel.length === 0) {
      batchBar.style.display = "none";
      return;
    }
    batchBar.style.display = "flex";
    batchBar.style.alignItems = "center";
    batchBar.style.gap = "var(--space-3)";
    batchBar.querySelector("[data-selected-count]").textContent = t("txn.selected", { n: sel.length });
  }

  // --- Wire filters
  let searchDebounce = null;
  filterBar.querySelector('[data-filter="search"]').addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.search = e.target.value;
      refetch();
    }, 250);
  });
  filterBar.querySelector('[data-filter="account"]').addEventListener("change", (e) => {
    state.account = e.target.value; refetch();
  });
  filterBar.querySelector('[data-filter="type"]').addEventListener("change", (e) => {
    state.type = e.target.value; refetch();
  });
  filterBar.querySelector("[data-action=clear]").addEventListener("click", () => {
    state.range = "thisMonth";
    state.from = null; state.to = null;
    state.account = ""; state.type = ""; state.search = "";
    filterBar.querySelector('[data-filter="account"]').value = "";
    filterBar.querySelector('[data-filter="type"]').value = "";
    filterBar.querySelector('[data-filter="search"]').value = "";
    filterBar.querySelectorAll("[data-range]").forEach((b) => b.classList.remove("btn--primary"));
    filterBar.querySelector('[data-range="thisMonth"]').classList.add("btn--primary");
    refetch();
  });

  // Range chips
  filterBar.querySelectorAll("[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBar.querySelectorAll("[data-range]").forEach((b) => b.classList.remove("btn--primary"));
      btn.classList.add("btn--primary");
      applyRangePreset(btn.dataset.range);
      refetch();
    });
  });
  filterBar.querySelector('[data-range="thisMonth"]').classList.add("btn--primary");
  filterBar.querySelector("[data-from]").addEventListener("change", (e) => { state.from = e.target.value; refetch(); });
  filterBar.querySelector("[data-to]").addEventListener("change", (e) => { state.to = e.target.value; refetch(); });

  // Header actions
  header.querySelector("[data-action=add]").addEventListener("click", () => openEditModal(null));
  header.querySelector("[data-action=refresh]").addEventListener("click", async () => {
    try {
      await api.maintenance.refreshPrices({ symbols: [] });
      toast(t("action.refreshDone"), { tone: "success" });
    } catch (e) {
      toast(t("action.refreshFailed", { code: e.code }), { tone: "error" });
    }
  });

  // Batch delete
  batchBar.querySelector("[data-action=batch-delete]").addEventListener("click", async () => {
    const ids = table.getSelected();
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: t("txn.deleteConfirm.title"),
      body: t("txn.deleteConfirm.body"),
      confirmLabel: t("action.delete"),
      confirmTone: "danger",
    });
    if (!ok) return;
    try {
      await api.transactions.batchRemove(ids);
      toast(t("deleted"), { tone: "success" });
      refetch();
    } catch (e) {
      toast(e.message, { tone: "error" });
    }
  });

  // --- Modal for create/edit
  function openEditModal(row) {
    const isEdit = !!row;
    const m = createModal({
      title: isEdit ? t("txn.edit") : t("txn.add"),
      size: "lg",
      onClose: () => {},
    });

    const form = document.createElement("form");
    form.noValidate = true;
    form.innerHTML = `
      <div class="form-field">
        <label class="form-field__label form-field__label--required">${t("txn.field.type")}</label>
        <div class="radio-group" data-radio="type" role="radiogroup" aria-label="${t("txn.field.type")}">
          ${TYPE_KEYS.map((k, i) => `
            <label class="radio-group__item">
              <input type="radio" name="type" value="${k}" ${(!isEdit && i === 0) || (row && row.type === k) ? "checked" : ""}>
              ${t("txnType." + k)}
            </label>
          `).join("")}
        </div>
      </div>
      <div class="form-field">
        <label class="form-field__label form-field__label--required" for="txn-acc">${t("txn.field.account")}</label>
        <select class="select" id="txn-acc" name="account_id" required>
          ${accounts.filter(a => String(a.status).toLowerCase() === "active").map(a =>
            `<option value="${a.id}" ${(row && row.account_id === a.id) ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`
          ).join("")}
        </select>
      </div>
      <div class="form-field">
        <label class="form-field__label" for="txn-sym">${t("txn.field.symbol")}</label>
        <select class="select" id="txn-sym" name="security_id">
          <option value="">—</option>
          ${securities.map(s =>
            `<option value="${s.id}" ${(row && row.security_id === s.id) ? "selected" : ""}>${escapeHtml(s.symbol)} ${escapeHtml(s.name)} (${s.currency})</option>`
          ).join("")}
        </select>
      </div>
      <div class="form-field">
        <label class="form-field__label form-field__label--required" for="txn-date">${t("txn.field.date")}</label>
        <input type="date" class="input" id="txn-date" name="txn_date" required value="${row ? row.txn_date : new Date().toISOString().slice(0,10)}">
      </div>
      <div class="grid grid--two">
        <div class="form-field">
          <label class="form-field__label" for="txn-qty">${t("txn.field.qty")}</label>
          <div id="txn-qty"></div>
          <span class="form-field__hint">${t("txn.qty.unit")}</span>
        </div>
        <div class="form-field">
          <label class="form-field__label" for="txn-price">${t("txn.field.price")}</label>
          <div id="txn-price"></div>
        </div>
      </div>
      <div class="grid grid--two">
        <div class="form-field">
          <label class="form-field__label" for="txn-fees">${t("txn.field.fees")}</label>
          <input type="text" inputmode="decimal" class="input input--number" id="txn-fees" name="fees" value="${row?.fees ?? "0"}">
        </div>
        <div class="form-field">
          <label class="form-field__label" for="txn-fx">${t("txn.field.fxRate")}</label>
          <input type="text" inputmode="decimal" class="input input--number" id="txn-fx" name="fx_rate" value="${row?.fx_rate ?? "1.0000"}">
        </div>
      </div>
      <div class="form-field">
        <label class="form-field__label" for="txn-note">${t("txn.field.note")}</label>
        <textarea class="textarea" id="txn-note" name="note">${row?.note ?? ""}</textarea>
      </div>
      <div class="form-field__hint" id="txn-hint"></div>
    `;
    m.body.appendChild(form);

    const qtyInput = createCurrencyInput({ name: "qty", decimals: 4, value: row?.qty ?? "", currency: "TWD" });
    const priceInput = createCurrencyInput({ name: "price", decimals: 2, value: row?.price ?? "", currency: "TWD" });
    form.querySelector("#txn-qty").appendChild(qtyInput.el);
    form.querySelector("#txn-price").appendChild(priceInput.el);

    // Type-aware hint + field disabling (per WIREFRAME §2.3)
    function refreshTypeState() {
      const type = form.querySelector('input[name="type"]:checked')?.value;
      const isCashOnly = ["DEPOSIT","WITHDRAW","TRANSFER_IN","TRANSFER_OUT","FEE"].includes(type);
      const isDiv = type === "DIVIDEND";
      const symSel = form.querySelector("#txn-sym");
      symSel.disabled = isCashOnly;
      symSel.required = !isCashOnly;
      form.querySelector("#txn-hint").textContent = isDiv ? t("txn.note.divHint") : "";
      const acc = accounts.find(a => a.id === form.querySelector("#txn-acc").value);
      if (acc) {
        priceInput.input.dataset.currency = acc.currency;
        // visual currency suffix
        const suf = priceInput.el.querySelector(".input-group__suffix");
        if (suf) suf.textContent = acc.currency;
      }
    }
    form.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener("change", refreshTypeState));
    form.querySelector("#txn-acc").addEventListener("change", refreshTypeState);
    refreshTypeState();

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn--secondary";
    cancelBtn.textContent = t("action.cancel");
    cancelBtn.addEventListener("click", () => m.close());
    m.footer.appendChild(cancelBtn);

    if (isEdit) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn--danger";
      delBtn.textContent = t("action.delete");
      delBtn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: t("txn.deleteConfirm.title"),
          body: t("txn.deleteConfirm.body"),
          confirmLabel: t("action.delete"),
          confirmTone: "danger",
        });
        if (!ok) return;
        try {
          await api.transactions.remove(row.id);
          toast(t("deleted"), { tone: "success" });
          m.close();
          refetch();
        } catch (e) {
          toast(e.message, { tone: "error" });
        }
      });
      m.footer.appendChild(delBtn);
    }

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.className = "btn btn--primary";
    saveBtn.textContent = t("action.save");
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      submit();
    });
    m.footer.appendChild(saveBtn);

    async function submit() {
      saveBtn.setAttribute("aria-busy", "true");
      saveBtn.disabled = true;
      try {
        const fd = new FormData(form);
        const body = {
          type: fd.get("type"),
          account_id: fd.get("account_id"),
          security_id: fd.get("security_id") || null,
          txn_date: fd.get("txn_date"),
          qty: qtyInput.getRawValue(),
          price: priceInput.getRawValue(),
          fees: fd.get("fees") || "0",
          fx_rate: fd.get("fx_rate") || "1.0000",
          note: fd.get("note") || "",
        };
        if (isEdit) await api.transactions.update(row.id, body);
        else        await api.transactions.create(body);
        toast(t("saved"), { tone: "success" });
        m.close();
        refetch();
      } catch (e) {
        toast(e.message || t("error.validation"), { tone: "error" });
        saveBtn.removeAttribute("aria-busy");
        saveBtn.disabled = false;
      }
    }

    m.show();
  }

  // --- Range presets
  function applyRangePreset(p) {
    const today = new Date("2026-09-23T00:00:00Z");
    const fmt = (d) => d.toISOString().slice(0, 10);
    if (p === "custom") {
      filterBar.querySelector("[data-custom-range]").hidden = false;
      state.range = "custom";
      return;
    }
    filterBar.querySelector("[data-custom-range]").hidden = true;
    state.range = p;
    let from = today, to = today;
    if (p === "thisWeek") {
      const dow = today.getUTCDay() || 7;
      from = new Date(today); from.setUTCDate(today.getUTCDate() - (dow - 1));
    } else if (p === "thisMonth") {
      from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    } else if (p === "thisQuarter") {
      const q = Math.floor(today.getUTCMonth() / 3) * 3;
      from = new Date(Date.UTC(today.getUTCFullYear(), q, 1));
    } else if (p === "thisYear") {
      from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    }
    state.from = fmt(from); state.to = fmt(to);
  }

  async function refetch() {
    const q = {};
    if (state.from) q.from = state.from;
    if (state.to)   q.to = state.to;
    if (state.account) q.account_id = state.account;
    if (state.type) q.type = state.type;
    if (state.search) q.search = state.search;
    try {
      const rows = await api.transactions.list(q);
      state.rows = rows;
      buildTable(rows);
    } catch (e) {
      toast(e.message, { tone: "error" });
    }
  }
  await refetch();

  // Selection-driven batch bar (re-check after each render)
  setInterval(() => updateBatchBar(), 250);
}

/* Helpers */
function nameOf(list, id) { return list.find(x => x.id === id)?.name ?? "—"; }
function symbolOf(list, id) {
  const s = list.find(x => x.id === id);
  return s ? `${s.symbol} ${s.name}` : "—";
}
function typeBadgeClass(type) {
  if (type === "BUY" || type === "DEPOSIT" || type === "TRANSFER_IN") return "badge--positive";
  if (type === "SELL" || type === "WITHDRAW" || type === "TRANSFER_OUT" || type === "FEE") return "badge--negative";
  if (type === "DIVIDEND") return "badge--info";
  return "badge--neutral";
}
function computeAmount(row) {
  if (row.type === "DEPOSIT" || row.type === "DIVIDEND") {
    return "+" + formatMoney(String(Number(row.qty || 0) * Number(row.price || 0)), "TWD", { decimals: 0 }).replace(/^NT\$ /, "");
  }
  if (row.type === "WITHDRAW" || row.type === "FEE") {
    return "-" + formatMoney(row.fees || row.price || "0", "TWD", { decimals: 0 }).replace(/^NT\$ /, "");
  }
  if (row.type === "BUY") {
    return "-" + formatMoney(String(Number(row.qty) * Number(row.price)), "TWD", { decimals: 0 }).replace(/^NT\$ /, "");
  }
  if (row.type === "SELL") {
    return "+" + formatMoney(String(Number(row.qty) * Number(row.price)), "TWD", { decimals: 0 }).replace(/^NT\$ /, "");
  }
  return "—";
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;" }[c]));
}
