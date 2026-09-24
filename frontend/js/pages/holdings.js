/**
 * stock_hold — Holdings page (multi-currency display per WIREFRAME §3.1 footnote ①)
 *
 * Table shows TWD-converted market value / P/L, but avg cost / current price
 * keep ORIGINAL currency with a chip. Implements formatDualCurrency via the
 * HTML helper returned by format.js.
 */

import * as api from "../api-client.js";
import { t } from "../i18n.js";
import { formatMoney, formatQty, formatPercent, formatDate } from "../format.js";
import { createDataTable } from "../components/data-table.js";
import { escapeHtml } from "../utils/escape-html.js";

export async function mountHoldings(root) {
  root.innerHTML = "";

  const header = document.createElement("div");
  header.className = "page-header";
  header.innerHTML = `
    <div class="page-header__row">
      <h1 class="page-header__title">${t("hold.title")}</h1>
      <div class="page-header__actions">
        <label style="font-size: var(--text-sm); color: var(--color-text-muted); display:inline-flex; gap: var(--space-2); align-items: center;">
          ${t("hold.sortBy")}
          <select class="select" data-sort style="height:32px; width:auto;">
            <option value="unrealizedPnl_desc">${t("hold.sortBy.unrealizedPnl")} ▼</option>
            <option value="marketValue_desc">${t("hold.sortBy.marketValue")} ▼</option>
            <option value="symbol_asc" selected>${t("hold.sortBy.symbol")}</option>
          </select>
        </label>
        <button type="button" class="btn btn--secondary" data-action="refresh">
          <span aria-hidden="true">↻</span> ${t("action.refresh")}
        </button>
      </div>
    </div>
  `;
  root.appendChild(header);

  // Summary card
  const summary = document.createElement("div");
  summary.className = "card section";
  summary.innerHTML = `
    <h2 class="card__title">${t("hold.summary")}</h2>
    <div class="grid grid--three" data-summary></div>
  `;
  root.appendChild(summary);

  const summaryHost = summary.querySelector("[data-summary]");

  // Table host
  const tableHost = document.createElement("div");
  tableHost.className = "section";
  root.appendChild(tableHost);

  // Load data
  const [rows, accounts] = await Promise.all([
    api.holdings.list().catch(() => []),
    api.accounts.list().catch(() => []),
  ]);

  // Compute totals
  let totalCostTwd = 0, totalMarketTwd = 0, totalUnrealizedTwd = 0, totalTtmDividend = 0;
  rows.forEach((h) => {
    const fx = Number(h.fx_rate || 1);
    totalCostTwd += Number(h.avg_cost) * Number(h.qty) * fx;
    totalMarketTwd += Number(h.current_price) * Number(h.qty) * fx;
    totalUnrealizedTwd += (Number(h.current_price) - Number(h.avg_cost)) * Number(h.qty) * fx;
    totalTtmDividend += Number(h.ttm_per_share || 0) * Number(h.qty);
  });
  const unrealizedPct = totalCostTwd > 0 ? (totalUnrealizedTwd / totalCostTwd) * 100 : 0;
  const portfolioYield = totalMarketTwd > 0 ? (totalTtmDividend / totalMarketTwd) * 100 : null;

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

  // totalUnrealizedTwd / unrealizedPct are accumulated in the totals loop above
  // and are reused directly by the third summary card.

  summaryHost.appendChild(metricCard(t("metric.totalCost"), formatMoney(String(totalCostTwd.toFixed(0)), "TWD", { decimals: 0 })));
  summaryHost.appendChild(metricCard(
    t("metric.marketValue"),
    formatMoney(String(totalMarketTwd.toFixed(0)), "TWD", { decimals: 0 })
  ));
  summaryHost.appendChild(metricCard(
    t("metric.unrealizedPnl"),
    Number.isFinite(totalUnrealizedTwd) ? formatMoney(String(Math.round(totalUnrealizedTwd)), "TWD", { signed: true }) : "—",
    {
      value: formatPercent(String(unrealizedPct.toFixed(2))) + (totalUnrealizedTwd >= 0 ? " ▲" : " ▼"),
      direction: totalUnrealizedTwd >= 0 ? "up" : "down",
    },
    totalUnrealizedTwd > 0 ? "positive" : totalUnrealizedTwd < 0 ? "negative" : "neutral",
  ));

  // Build table
  let table;
  function buildTable(sortKey) {
    tableHost.innerHTML = "";
    let sorted = [...rows];
    if (sortKey === "unrealizedPnl_desc") {
      sorted.sort((a, b) => {
        const ua = (Number(b.current_price) - Number(b.avg_cost)) * Number(b.qty) * Number(b.fx_rate || 1);
        const ub = (Number(a.current_price) - Number(a.avg_cost)) * Number(a.qty) * Number(a.fx_rate || 1);
        return ua - ub;
      });
    } else if (sortKey === "marketValue_desc") {
      sorted.sort((a, b) => {
        const va = Number(b.current_price) * Number(b.qty) * Number(b.fx_rate || 1);
        const vb = Number(a.current_price) * Number(a.qty) * Number(a.fx_rate || 1);
        return va - vb;
      });
    } else if (sortKey === "symbol_asc") {
      sorted.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }

    table = createDataTable({
      columns: [
        {
          key: "symbol", header: t("hold.col.symbol"), sortable: true,
          cell: (row) => `<strong>${escapeHtml(row.symbol)}</strong> ${escapeHtml(row.name)}
            <div class="chip" style="margin-left: var(--space-1);">${escapeHtml(row.currency)}</div>`,
        },
        {
          key: "account", header: t("hold.col.account"),
          cell: (row) => nameOf(accounts, row.account_id),
        },
        {
          key: "qty", header: t("hold.col.qty"), numeric: true, align: "right",
          cell: (row) => `<span class="num">${formatQty(row.qty)}</span>`,
        },
        {
          key: "avgCost", header: t("hold.col.avgCost"), numeric: true, align: "right",
          cell: (row) => `<span class="num">${formatMoney(row.avg_cost, row.currency)}</span>`,
        },
        {
          key: "price", header: t("hold.col.price"), numeric: true, align: "right",
          cell: (row) => `<span class="num">${formatMoney(row.current_price, row.currency)}</span>`,
        },
        {
          key: "marketValue", header: t("hold.col.marketValue"), numeric: true, align: "right",
          cell: (row) => {
            const fx = Number(row.fx_rate || 1);
            const twd = Number(row.current_price) * Number(row.qty) * fx;
            if (!Number.isFinite(twd) || twd <= 0) return "—";
            return `<span class="num">${formatMoney(String(Math.round(Math.max(0, twd))), "TWD", { decimals: 0 })}</span>`;
          },
        },
        {
          key: "unrealizedPnl", header: t("hold.col.unrealizedPnl"), numeric: true, align: "right",
          cell: (row) => {
            const fx = Number(row.fx_rate || 1);
            const profit = (Number(row.current_price) - Number(row.avg_cost)) * Number(row.qty) * fx;
            const pct = Number(row.avg_cost) > 0
              ? ((Number(row.current_price) - Number(row.avg_cost)) / Number(row.avg_cost)) * 100
              : 0;
            if (!Number.isFinite(profit)) return "—";
            const cls = profit > 0 ? "value-positive" : profit < 0 ? "value-negative" : "";
            const arrow = profit > 0 ? " ▲" : profit < 0 ? " ▼" : " ─";
            return `
              <div class="${cls} num">${formatMoney(String(Math.round(profit)), "TWD", { signed: true })}${arrow}</div>
              <div style="font-size: var(--text-xs); color: var(--color-text-muted);">${formatPercent(String(pct.toFixed(2)))}</div>
            `;
          },
        },
      ],
      data: sorted,
      rowKey: (r) => `${r.security_id}::${r.account_id}`,
      caption: t("hold.title"),
    });
    tableHost.appendChild(table.el);
  }

  buildTable("symbol_asc");
  header.querySelector("[data-sort]").addEventListener("change", (e) => buildTable(e.target.value));

  header.querySelector("[data-action=refresh]").addEventListener("click", async () => {
    try {
      await api.maintenance.refreshPrices({ symbols: [] });
      location.reload();
    } catch (e) {
      console.error(e);
    }
  });
}

function nameOf(list, id) { return list.find(x => x.id === id)?.name ?? "—"; }
