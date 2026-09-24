/**
 * stock_hold — Holdings page (multi-currency display per WIREFRAME §3.1 footnote ①)
 *
 * Table shows TWD-converted market value / P/L, but avg cost / current price
 * keep ORIGINAL currency with a chip. Implements formatDualCurrency via the
 * HTML helper returned by format.js.
 */

import * as api from "../api-client.js";
import { t } from "../i18n.js";
import { formatMoney, formatQty, formatPercent, formatDualCurrency, formatDate } from "../format.js";
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
            <option value="symbol_asc">${t("hold.sortBy.symbol")}</option>
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

  summaryHost.appendChild(metricCard(t("metric.totalCost"), formatMoney(String(totalCostTwd.toFixed(0)), "TWD", { decimals: 0 })));
  summaryHost.appendChild(metricCard(
    t("metric.marketValue"),
    formatMoney(String(totalMarketTwd.toFixed(0)), "TWD", { decimals: 0 }),
    {
      value: formatPercent(String(unrealizedPct.toFixed(2))) + " ▲",
      direction: unrealizedPct >= 0 ? "up" : "down",
    },
    unrealizedPct >= 0 ? "positive" : "negative",
  ));
  summaryHost.appendChild(metricCard(
    t("metric.dividendYield"),
    portfolioYield !== null ? formatPercent(portfolioYield.toFixed(2)) : "—",
    portfolioYield !== null ? { value: formatMoney(String(Math.round(totalTtmDividend)), "TWD", { decimals: 0 }), direction: "flat" } : { value: "—", direction: "flat" },
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
            <div class="chip" style="margin-left: var(--space-1);">${escapeHtml(row.currency)}</div>
            <div style="font-size: var(--text-xs); color: var(--color-text-muted); margin-top: 2px;">
              ${changePct(row)}
            </div>`,
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
          cell: (row) => {
            const curr = Number(row.current_price);
            const prev = Number(row.prev_close);
            const pctCell = (Number.isFinite(curr) && Number.isFinite(prev) && prev > 0)
              ? (() => {
                  const pct = ((curr - prev) / prev) * 100;
                  const cls = pct >= 0 ? "value-positive" : "value-negative";
                  const arrow = pct >= 0 ? " ▲" : " ▼";
                  return `<span class="${cls}" style="font-size: var(--text-xs);">${formatPercent(pct.toFixed(2))}${arrow}</span>`;
                })()
              : "—";
            return `<span class="num">${formatMoney(row.current_price, row.currency)}</span>
              <div style="font-size: var(--text-xs);">${pctCell}</div>
              <div style="font-size: var(--text-xs); color: var(--color-text-muted);">${formatDate(row.price_date)}</div>`;
          },
        },
        {
          key: "marketValue", header: t("hold.col.marketValue"), numeric: true, align: "right",
          cell: (row) => {
            const fx = Number(row.fx_rate || 1);
            const orig = Number(row.current_price) * Number(row.qty);
            const twd = orig * fx;
            if (!Number.isFinite(orig) || orig <= 0) return "—";
            return formatDualCurrency({
              originalValue: String(Math.max(0, orig)),
              originalCurrency: row.currency,
              twdValue: String(Math.max(0, Math.round(twd))),
              field: "money",
            });
          },
        },
        {
          key: "unrealizedPnl", header: t("hold.col.unrealizedPnl"), numeric: true, align: "right",
          cell: (row) => {
            const orig = (Number(row.current_price) - Number(row.avg_cost)) * Number(row.qty);
            const twd = orig * Number(row.fx_rate);
            const pct = Number(row.avg_cost) > 0
              ? ((Number(row.current_price) - Number(row.avg_cost)) / Number(row.avg_cost)) * 100
              : 0;
            const cls = twd > 0 ? "value-positive" : twd < 0 ? "value-negative" : "";
            const arrow = twd > 0 ? " ▲" : twd < 0 ? " ▼" : " ─";
            return `
              <div class="${cls} num">${formatMoney(String(Math.round(twd)), "TWD", { signed: true })}${arrow}</div>
              <div style="font-size: var(--text-xs); color: var(--color-text-muted);">${formatPercent(String(pct.toFixed(2)))}</div>
            `;
          },
        },
        {
          key: "yield", header: t("hold.col.yield"), numeric: true, align: "right", width: "80px",
          cell: (row) => {
            const y = yieldPercent(row);
            return y !== null ? `<span class="num">${formatPercent(y.toFixed(2))}</span>` : "—";
          },
        },
      ],
      data: sorted,
      rowKey: (r) => `${r.security_id}::${r.account_id}`,
      caption: t("hold.title"),
    });
    tableHost.appendChild(table.el);
  }

  buildTable("unrealizedPnl_desc");
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

function changePct(row) {
  const a = Number(row.avg_cost), b = Number(row.current_price);
  if (!a) return "—";
  const pct = ((b - a) / a) * 100;
  const cls = pct >= 0 ? "value-positive" : "value-negative";
  const arrow = pct >= 0 ? " ▲" : " ▼";
  return `<span class="${cls}" style="font-size: var(--text-xs);">${formatPercent(String(pct.toFixed(2)))}${arrow}</span>`;
}

function yieldPercent(row) {
  const ttm = Number(row.ttm_per_share);
  const price = Number(row.current_price);
  if (!Number.isFinite(ttm) || ttm <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  return (ttm / price) * 100;
}

function nameOf(list, id) { return list.find(x => x.id === id)?.name ?? "—"; }
