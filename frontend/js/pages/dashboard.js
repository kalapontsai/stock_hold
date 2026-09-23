/**
 * stock_hold — Dashboard page
 *
 * Wireframe §1: 4 metric cards + allocation chart + recent 5 transactions
 * + monthly P/L bar chart. Mobile-first; data-attr hooks for chart toggle.
 */

import * as api from "../api-client.js";
import { t } from "../i18n.js";
import { formatMoney, formatDateTime, formatPercent } from "../format.js";
import { createMetricCard } from "../components/metric-card.js";
import { createPieChart } from "../components/chart-pie.js";
import { createBarChart } from "../components/chart-bar.js";
import { toast } from "../components/modal.js";
import { escapeHtml } from "../utils/escape-html.js";

export async function mountDashboard(root) {
  root.innerHTML = "";

  const header = document.createElement("div");
  header.className = "page-header";
  header.innerHTML = `
    <div class="page-header__row">
      <h1 class="page-header__title">${t("nav.dashboard")} Dashboard</h1>
      <div class="page-header__actions">
        <button type="button" class="btn btn--secondary" data-action="refresh">
          <span aria-hidden="true">↻</span>
          ${t("action.refresh")}
        </button>
      </div>
    </div>
    <div class="page-header__as-of" data-as-of>—</div>
  `;
  root.appendChild(header);

  const metricsRow = document.createElement("div");
  metricsRow.className = "grid grid--metrics section";
  root.appendChild(metricsRow);

  const middleRow = document.createElement("div");
  middleRow.className = "grid grid--dashboard-bottom section";
  root.appendChild(middleRow);

  const monthlyWrap = document.createElement("div");
  monthlyWrap.className = "card section";
  monthlyWrap.innerHTML = `<div class="card__header">
    <h2 class="card__title">${t("dashboard.monthlyPnl")}</h2>
    <div class="legend" style="font-size: var(--text-xs); color: var(--color-text-muted);">
      <span class="badge badge--info" style="margin-right: var(--space-2);">${t("dashboard.realized")}</span>
      <span class="badge badge--neutral">${t("dashboard.unrealized")}</span>
    </div>
  </div><div data-monthly-chart></div>`;
  root.appendChild(monthlyWrap);

  const refreshBtn = header.querySelector("[data-action=refresh]");
  const asOfEl = header.querySelector("[data-as-of]");

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.setAttribute("aria-busy", "true");
    refreshBtn.disabled = true;
    try {
      await api.maintenance.refreshPrices({ symbols: [] });
      toast(t("action.refreshDone"), { tone: "success" });
    } catch (e) {
      toast(t("action.refreshFailed", { code: e.code || "ERROR" }), { tone: "error" });
    } finally {
      refreshBtn.removeAttribute("aria-busy");
      refreshBtn.disabled = false;
    }
  });

  // --- Load all dashboard data in parallel ---
  let summary, allocation, recent, monthly, lastUpdate;
  try {
    [summary, allocation, recent, monthly, lastUpdate] = await Promise.all([
      api.dashboard.summary(),
      api.dashboard.allocation(),
      api.dashboard.recent({ limit: 5 }),
      api.dashboard.monthlyPnl(),
      api.maintenance.lastPriceUpdate(),
    ]);
  } catch (e) {
    toast(t("error.server"), { tone: "error", title: e.code || "Error" });
    return;
  }

  if (lastUpdate?.as_of) {
    asOfEl.textContent = t("metric.dataAsOf", { ts: formatDateTime(lastUpdate.as_of) });
  }

  // --- 4 metric cards ---
  const totalAssetsDelta = summary.total_assets_prev
    ? delta(summary.total_assets, summary.total_assets_prev)
    : null;
  metricsRow.appendChild(createMetricCard({
    label: t("metric.totalAssets"),
    value: formatMoney(summary.total_assets, "TWD"),
    delta: totalAssetsDelta,
    period: t("metric.vsLastMonth", { pct: formatPercent(totalAssetsDelta?.percent ?? "0") }),
    progressPercent: summary.usage_pct,
    semantic: "neutral",
  }));
  metricsRow.appendChild(createMetricCard({
    label: t("metric.todayPnl"),
    value: formatMoney(summary.today_pnl, "TWD", { signed: true }),
    delta: {
      value: formatPercent(summary.today_pnl_pct),
      direction: Number(summary.today_pnl) >= 0 ? "up" : "down",
    },
    period: t("metric.usageProgress", { pct: summary.usage_pct }),
    semantic: Number(summary.today_pnl) >= 0 ? "positive" : "negative",
  }));
  metricsRow.appendChild(createMetricCard({
    label: t("metric.mtdPnl"),
    value: formatMoney(summary.mtd_pnl, "TWD", { signed: true }),
    delta: {
      value: formatPercent(summary.mtd_pnl_pct),
      direction: Number(summary.mtd_pnl) >= 0 ? "up" : "down",
    },
    period: `${t("dashboard.realized")} +${formatMoney(summary.realized_mtd, "TWD", { signed: false })}`,
    semantic: Number(summary.mtd_pnl) >= 0 ? "positive" : "negative",
  }));
  metricsRow.appendChild(createMetricCard({
    label: t("metric.unrealizedPnl"),
    value: formatMoney(summary.unrealized_pnl, "TWD", { signed: true }),
    delta: {
      value: formatPercent(summary.unrealized_pnl_pct),
      direction: Number(summary.unrealized_pnl) >= 0 ? "up" : "down",
    },
    period: `${summary.holdings_positive}/${summary.holdings_count} 持倉中 ${t("dashboard.realized")}`,
    semantic: Number(summary.unrealized_pnl) >= 0 ? "positive" : "negative",
  }));

  // --- Middle: Allocation + Recent ---
  const allocCard = document.createElement("div");
  allocCard.className = "card";
  allocCard.innerHTML = `
    <div class="card__header">
      <h2 class="card__title">${t("dashboard.allocation")}</h2>
      <div class="segmented" role="radiogroup" aria-label="圖表類型">
        <button type="button" class="segmented__btn" aria-pressed="true" data-chart="pie">${t("dashboard.chartPie")}</button>
        <button type="button" class="segmented__btn" aria-pressed="false" data-chart="bar">${t("dashboard.chartBar")}</button>
      </div>
    </div>
    <div data-chart-host></div>
  `;
  middleRow.appendChild(allocCard);

  const recentCard = document.createElement("div");
  recentCard.className = "card";
  recentCard.innerHTML = `
    <div class="card__header">
      <h2 class="card__title">${t("dashboard.recent")}</h2>
      <a class="btn btn--ghost btn--sm" href="${pageHref("transactions")}">${t("dashboard.viewAll")} →</a>
    </div>
    <div data-recent-host></div>
  `;
  middleRow.appendChild(recentCard);

  // Charts
  let pieChart, barChart;
  const chartHost = allocCard.querySelector("[data-chart-host]");

  async function showPie() {
    chartHost.innerHTML = "";
    if (barChart) { barChart.destroy(); barChart = null; }
    pieChart = await createPieChart({ data: allocation, title: t("dashboard.allocation"), height: 320 });
    chartHost.appendChild(pieChart.el);
  }
  async function showBar() {
    chartHost.innerHTML = "";
    if (pieChart) { pieChart.destroy(); pieChart = null; }
    const data = allocation.map((d) => ({ x: d.label, y: d.value }));
    barChart = await createBarChart({
      data,
      horizontal: true,
      title: t("dashboard.allocation"),
      height: 280,
    });
    chartHost.appendChild(barChart.el);
  }
  await showPie();
  allocCard.querySelectorAll("[data-chart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      allocCard.querySelectorAll("[data-chart]").forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
      if (btn.dataset.chart === "pie") showPie();
      else showBar();
    });
  });

  // Recent transactions list
  const recentHost = recentCard.querySelector("[data-recent-host]");
  recentHost.className = "recent-list";
  recent.slice(0, 5).forEach((r) => {
    const row = document.createElement("div");
    row.className = "recent-list__row";
    const amt = r.amount || "—";
    const positive = amt.startsWith("+");
    const negative = amt.startsWith("-");
    // H-4: every server-provided field that lands inside an innerHTML template
    // MUST be escaped. `t()` falls back to returning the key when a translation
    // is missing, so `t("txnType." + r.type)` echoes `r.type` raw — escape it.
    const dateStr = String(r.txn_date ?? "").slice(5).replace("-", "/");
    const typeLabel = escapeHtml(t("txnType." + r.type));
    const symbolLabel = escapeHtml(r.symbol);
    const qtyLabel = r.qty != null ? "\u00d7" + escapeHtml(r.qty) : "";
    const priceLabel = r.price != null ? "@" + escapeHtml(r.price) : "";
    const amtLabel = escapeHtml(amt);
    row.innerHTML = `
      <span class="recent-list__date">${escapeHtml(dateStr)}</span>
      <span class="recent-list__type">${typeLabel}</span>
      <span class="recent-list__detail">${symbolLabel} ${qtyLabel} ${priceLabel}</span>
      <span class="recent-list__amount ${positive ? "value-positive" : negative ? "value-negative" : ""}">${amtLabel}</span>
    `;
    recentHost.appendChild(row);
  });

  // --- Monthly P/L ---
  const monthlyHost = monthlyWrap.querySelector("[data-monthly-chart]");
  const monthlyChart = await createBarChart({
    labels: monthly.labels,
    datasets: [
      { label: t("dashboard.realized"),   values: monthly.realized.map(Number),   color: "var(--chart-1)" },
      { label: t("dashboard.unrealized"), values: monthly.unrealized.map(Number), color: "var(--chart-2)" },
    ],
    stacked: true,
    title: t("dashboard.monthlyPnl"),
    height: 280,
    yFormatter: (v) => formatMoney(String(v), "TWD", { signed: true }),
  });
  monthlyHost.appendChild(monthlyChart.el);
}

function pageHref(page) {
  return document.body?.dataset?.rootEntry === "true"
    ? `./frontend/${page}.html`
    : `./${page}.html`;
}

function delta(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  const diff = c - p;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const percent = (diff / p) * 100;
  return {
    value: Math.abs(diff).toLocaleString(),
    direction,
    percent: percent.toFixed(2),
  };
}
