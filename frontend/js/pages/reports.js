/**
 * stock_hold — Reports page (4 tabs: realized, unrealized, dividends, tax)
 *
 * Wireframe §4: 4 metrics cards + bar chart on realized; holdings table on
 * unrealized; dividends table; tax estimate with disclaimer.
 */

import * as api from "../api-client.js";
import { t } from "../i18n.js";
import { formatMoney, formatPercent, formatDate, formatQty } from "../format.js";
import { createBarChart } from "../components/chart-bar.js";
import { createDataTable } from "../components/data-table.js";
import { toast } from "../components/modal.js";
import { escapeHtml } from "../utils/escape-html.js";

const TABS = [
  { key: "realized",    label: "rpt.tab.realized" },
  { key: "unrealized",  label: "rpt.tab.unrealized" },
  { key: "dividend",    label: "rpt.tab.dividend" },
];

export async function mountReports(root) {
  root.innerHTML = "";

  const header = document.createElement("div");
  header.className = "page-header";
  header.innerHTML = `
    <h1 class="page-header__title">${t("rpt.title")}</h1>
    <div class="page-header__row" style="margin-top: var(--space-3);">
      <div class="filter-bar__chip-group" style="display:inline-flex; align-items:center; gap: var(--space-2);">
        <span style="font-size: var(--text-sm); color: var(--color-text-muted);">${t("rpt.period")}</span>
        <input type="date" class="input" data-period-from value="2026-01-01" style="height:32px; width:auto">
        <span aria-hidden="true">~</span>
        <input type="date" class="input" data-period-to value="2026-09-23" style="height:32px; width:auto">
        <button type="button" class="btn btn--sm btn--secondary" data-preset="thisMonth">${t("filter.range.thisMonth")}</button>
        <button type="button" class="btn btn--sm btn--secondary" data-preset="thisYear">${t("filter.range.thisYear")}</button>
        <button type="button" class="btn btn--sm btn--secondary" data-preset="custom">${t("filter.range.custom")}</button>
      </div>
    </div>
  `;
  root.appendChild(header);

  // Tabs
  const tabs = document.createElement("div");
  tabs.className = "tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "報表分頁");
  TABS.forEach((tab, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tabs__tab";
    b.role = "tab";
    b.dataset.tab = tab.key;
    b.id = `rpt-tab-${tab.key}`;
    b.setAttribute("aria-selected", i === 0 ? "true" : "false");
    b.setAttribute("aria-controls", `rpt-panel-${tab.key}`);
    b.tabIndex = i === 0 ? 0 : -1;
    b.textContent = t(tab.label);
    tabs.appendChild(b);
  });
  root.appendChild(tabs);

  // Panels
  const panels = document.createElement("div");
  panels.className = "section";
  root.appendChild(panels);

  const panelEls = {};
  TABS.forEach((tab, i) => {
    const p = document.createElement("section");
    p.id = `rpt-panel-${tab.key}`;
    p.setAttribute("role", "tabpanel");
    p.setAttribute("aria-labelledby", `rpt-tab-${tab.key}`);
    p.hidden = i !== 0;
    panelEls[tab.key] = p;
    panels.appendChild(p);
  });

  // Tab switching (a11y: ←/→/Home/End)
  tabs.addEventListener("keydown", (e) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const all = [...tabs.querySelectorAll("[role=tab]")];
    let idx = all.findIndex((el) => el.getAttribute("aria-selected") === "true");
    if (e.key === "ArrowRight") idx = (idx + 1) % all.length;
    if (e.key === "ArrowLeft")  idx = (idx - 1 + all.length) % all.length;
    if (e.key === "Home")       idx = 0;
    if (e.key === "End")        idx = all.length - 1;
    e.preventDefault();
    activate(all[idx].dataset.tab);
    all[idx].focus();
  });
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    activate(b.dataset.tab);
  });

  function activate(key) {
    TABS.forEach((tab) => {
      const isActive = tab.key === key;
      const tabEl = tabs.querySelector(`[data-tab="${tab.key}"]`);
      tabEl.setAttribute("aria-selected", isActive ? "true" : "false");
      tabEl.tabIndex = isActive ? 0 : -1;
      panelEls[tab.key].hidden = !isActive;
    });
  }

  // Period controls
  const fromInput = header.querySelector("[data-period-from]");
  const toInput = header.querySelector("[data-period-to]");
  header.querySelectorAll("[data-preset]").forEach((b) => {
    b.addEventListener("click", () => {
      const p = b.dataset.preset;
      const today = new Date("2026-09-23T00:00:00Z");
      const fmt = (d) => d.toISOString().slice(0, 10);
      if (p === "thisMonth") {
        fromInput.value = fmt(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
        toInput.value = fmt(today);
      } else if (p === "thisYear") {
        fromInput.value = fmt(new Date(Date.UTC(today.getUTCFullYear(), 0, 1)));
        toInput.value = fmt(today);
      }
      reloadAll();
    });
  });
  fromInput.addEventListener("change", reloadAll);
  toInput.addEventListener("change", reloadAll);

  // --- Realized tab
  async function renderRealized() {
    const p = panelEls.realized;
    p.innerHTML = "";
    let data;
    try { data = await api.reports.realized({ from: fromInput.value, to: toInput.value }); }
    catch (e) { p.innerHTML = `<p>${e.message}</p>`; return; }
    const sum = data.summary;

    const cards = document.createElement("div");
    cards.className = "grid grid--metrics section";
    cards.appendChild(metricCard(t("metric.realizedPnl"), formatMoney(sum.total_realized, "TWD", { signed: true }),
      { value: sum.total_trades > 0 ? `${sum.total_trades} 筆` : "—", direction: "flat" },
      Number(sum.total_realized) >= 0 ? "positive" : "negative"));
    cards.appendChild(metricCard(t("metric.winningRate"), `${sum.winning_rate_pct}% (${sum.wins}/${sum.total_trades})`));
    cards.appendChild(metricCard(t("metric.avgHoldingDays"), `${sum.avg_holding_days} 天`));
    cards.appendChild(metricCard(t("metric.maxSingleGain"), formatMoney(sum.max_single_gain, "TWD", { signed: true }),
      { value: "—", direction: "flat" },
      Number(sum.max_single_gain) >= 0 ? "positive" : "negative"));
    p.appendChild(cards);

    const chartCard = document.createElement("div");
    chartCard.className = "card";
    chartCard.innerHTML = `<div class="card__header"><h2 class="card__title">月度已實現損益</h2></div><div data-realized-chart></div>`;
    p.appendChild(chartCard);
    const realizedChart = await createBarChart({
      labels: data.monthly.labels,
      data: data.monthly.values.map((v, i) => ({ x: data.monthly.labels[i], y: Number(v), color: Number(v) >= 0 ? "var(--chart-2)" : "var(--chart-4)" })),
      title: "月度已實現損益",
      height: 300,
      yFormatter: (v) => formatMoney(String(v), "TWD", { signed: true }),
    });
    chartCard.querySelector("[data-realized-chart]").appendChild(realizedChart.el);
  }

  // --- Unrealized tab = subset of Holdings
  async function renderUnrealized() {
    const p = panelEls.unrealized;
    p.innerHTML = "";
    const [rows, accounts] = await Promise.all([
      api.holdings.list().catch(() => []),
      api.accounts.list().catch(() => []),
    ]);
    const tbl = createDataTable({
      columns: [
        { key: "symbol", header: "標的", cell: (r) => `<strong>${escapeHtml(r.symbol)}</strong> ${escapeHtml(r.name)} <span class="chip">${escapeHtml(r.currency)}</span>` },
        { key: "qty", header: "數量", numeric: true, align: "right", cell: (r) => `<span class="num">${formatQty(r.qty)}</span>` },
        { key: "price", header: "現價", numeric: true, align: "right", cell: (r) => `<span class="num">${formatMoney(r.current_price, r.currency)}</span>` },
        { key: "marketValue", header: "市值(TWD)", numeric: true, align: "right",
          cell: (r) => formatMoney(String(Math.round(Number(r.current_price) * Number(r.qty) * Number(r.fx_rate))), "TWD") },
        { key: "unrealizedPnl", header: "未實現(TWD)", numeric: true, align: "right",
          cell: (r) => {
            const v = (Number(r.current_price) - Number(r.avg_cost)) * Number(r.qty) * Number(r.fx_rate);
            const cls = v > 0 ? "value-positive" : v < 0 ? "value-negative" : "";
            return `<span class="num ${cls}">${formatMoney(String(Math.round(v)), "TWD", { signed: true })}</span>`;
          },
        },
        { key: "account", header: "帳戶", cell: (r) => nameOf(accounts, r.account_id) },
      ],
      data: rows,
      rowKey: (r) => `${r.security_id}::${r.account_id}`,
      caption: "未實現損益",
    });
    p.appendChild(tbl.el);
  }

  // --- Dividend tab
  async function renderDividend() {
    const p = panelEls.dividend;
    p.innerHTML = "";
    const rows = await api.reports.dividends({ from: fromInput.value, to: toInput.value }).catch(() => []);

    const totalTwd = rows.reduce((s, r) => s + Number(r.amount_twd || 0), 0);
    const totalUsd = rows.filter(r => r.currency === "USD").reduce((s, r) => s + Number(r.qty) * Number(r.per_share), 0);
    const approxTwd = Math.round(totalUsd * 30); // demo FX

    const sum = document.createElement("div");
    sum.className = "card section";
    sum.innerHTML = `<h2 class="card__title">合計配息</h2>
      <div class="metric-card__value num value-positive">${formatMoney(String(totalTwd), "TWD", { decimals: 0 })} + ${totalUsd.toFixed(2)} USD</div>
      <div class="metric-card__period">≈ ${formatMoney(String(approxTwd), "TWD", { decimals: 0 })} (TWD 估算)</div>`;
    p.appendChild(sum);

    const tbl = createDataTable({
      columns: [
        { key: "symbol", header: "標的" },
        { key: "ex_date", header: t("rpt.col.exDate"), cell: (r) => `<span class="num">${formatDate(r.ex_date)}</span>` },
        { key: "pay_date", header: t("rpt.col.payDate"), cell: (r) => `<span class="num">${formatDate(r.pay_date)}</span>` },
        { key: "per_share", header: t("rpt.col.perShare"), numeric: true, align: "right",
          cell: (r) => `<span class="num">${formatMoney(r.per_share, r.currency)}</span>` },
        { key: "amount_twd", header: t("rpt.col.total"), numeric: true, align: "right",
          cell: (r) => `<span class="num">+${formatMoney(r.amount_twd, "TWD", { decimals: 0 })}</span>` },
      ],
      data: rows,
      rowKey: (r) => r.id,
      caption: "配息明細",
    });
    p.appendChild(tbl.el);
  }

  function metricCard(label, value, delta, semantic) {
    const card = document.createElement("div");
    card.className = "metric-card";
    card.innerHTML = `
      <p class="metric-card__label">${label}</p>
      <div class="metric-card__value ${semantic === "positive" ? "value-positive" : semantic === "negative" ? "value-negative" : ""} num">${value}</div>
      ${delta ? `<div class="metric-card__delta ${delta.direction === "up" ? "metric-card__delta--positive" : delta.direction === "down" ? "metric-card__delta--negative" : "metric-card__delta--neutral"}">${delta.value}</div>` : ""}
    `;
    return card;
  }

  async function reloadAll() {
    await Promise.all([renderRealized(), renderUnrealized(), renderDividend()]);
  }
  await reloadAll();
}

function nameOf(list, id) { return list.find(x => x.id === id)?.name ?? "—"; }
