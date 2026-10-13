/**
 * stock_hold — Dashboard page
 *
 * Wireframe §1: 3 metric cards + allocation chart + recent 5 transactions.
 * Mobile-first; data-attr hooks for chart toggle.
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

  // ────────────────────────────────────────────────────────────────
  // 2.3.0: P&L backfill + alert banner.
  //
  // Every dashboard mount fires a fire-and-forget snapshot backfill.
  // The endpoint is a no-op when the data is already up to date, so
  // the daily re-entry cost is one extra GET. Other pages do NOT
  // trigger this — per product decision the dashboard is the only
  // login-touchpoint.
  //
  // 2.3.1: when backfill pulled historical closes from the configured
  // provider, surface that to the user via a one-shot toast so they
  // know the new dots on the equity curve are reconstructed, not live.
  //
  // After backfill we pull /reports/pnl-alerts and, if any rule is
  // triggered, render a banner above the metric cards.
  // ────────────────────────────────────────────────────────────────
  let alertState = null;
  api.pnl.ensure().catch((e) => {
    // Backfill failure must NEVER block the dashboard. Log via toast
    // only if it's an actual API failure (not the mock path).
    console.warn("pnl.ensure failed", e);
    return { ok: false, historical_imported: 0 };
  }).then((ensureResult) => {
    const imported = Number(ensureResult?.historical_imported || 0);
    if (imported > 0) {
      // Provider display name is best-effort — we don't want to block
      // the toast on another GET. The string itself is enough.
      const provider = (ensureResult?.historical_skipped === "none") ? "歷史來源" : "歷史來源";
      toast(t("dash.historical.toast", { provider, count: imported }), { tone: "info" });
    }
    return api.reports.pnlAlerts();
  }).then((s) => {
    alertState = s;
    renderAlertBanner();
  }).catch(() => { /* alerts are best-effort */ });

  const bannerHost = document.createElement("div");
  bannerHost.className = "dashboard-alert-host";
  bannerHost.setAttribute("data-alert-host", "");
  root.appendChild(bannerHost);

  const metricsRow = document.createElement("div");
  metricsRow.className = "grid grid--metrics section";
  root.appendChild(metricsRow);

  const middleRow = document.createElement("div");
  middleRow.className = "grid grid--dashboard-bottom section";
  root.appendChild(middleRow);

  function renderAlertBanner() {
    if (!alertState) return;
    const triggered = Array.isArray(alertState.triggered) ? alertState.triggered : [];
    bannerHost.innerHTML = "";
    if (triggered.length === 0) return;
    const banner = document.createElement("div");
    banner.className = "alert-banner";
    banner.setAttribute("role", "alert");
    banner.style.cssText = [
      "display: flex",
      "flex-wrap: wrap",
      "align-items: center",
      "gap: var(--space-3)",
      "padding: var(--space-3) var(--space-4)",
      "margin-top: var(--space-3)",
      "border-left: 4px solid var(--color-danger)",
      "background: color-mix(in srgb, var(--color-danger) 8%, var(--color-surface))",
      "border-radius: var(--radius-sm)",
    ].join(";");
    const title = document.createElement("strong");
    title.textContent = t("dash.banner.title");
    title.style.cssText = "margin-right: var(--space-2);";
    banner.appendChild(title);
    for (const a of triggered) {
      const chip = document.createElement("span");
      chip.className = "alert-banner__chip";
      chip.style.cssText = [
        "display: inline-flex",
        "align-items: center",
        "gap: var(--space-1)",
        "padding: 2px var(--space-2)",
        "background: var(--color-bg)",
        "border: 1px solid var(--color-border)",
        "border-radius: var(--radius-sm)",
        "font-size: var(--text-sm)",
        "color: var(--color-danger)",
      ].join(";");
      if (a.type === "consecutive_down_days") {
        chip.textContent = t("dash.alert.consecutive", { n: a.value });
      } else if (a.type === "window_pct") {
        chip.textContent = t("dash.alert.windowPct", {
          days: a.window_days ?? alertState.window_days,
          pct: Number(a.value).toFixed(2),
        });
      } else {
        chip.textContent = String(a.type);
      }
      banner.appendChild(chip);
    }
    const link = document.createElement("a");
    link.href = "./settings.html#alerts";
    link.textContent = t("dash.alert.viewSettings");
    link.style.cssText = "margin-left: auto; color: var(--color-link); font-size: var(--text-sm);";
    banner.appendChild(link);
    bannerHost.appendChild(banner);
  }

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
  let summary, allocation, recent, lastUpdate, health;
  try {
    [summary, allocation, recent, lastUpdate, health] = await Promise.all([
      api.dashboard.summary(),
      api.dashboard.allocation(),
      api.dashboard.recent({ limit: 5 }),
      api.maintenance.lastPriceUpdate(),
      api.rawRequest("GET", "/health").catch(() => null),
    ]);
  } catch (e) {
    toast(t("error.server"), { tone: "error", title: e.code || "Error" });
    return;
  }

  if (lastUpdate?.as_of) {
    asOfEl.textContent = t("metric.dataAsOf", { ts: formatDateTime(lastUpdate.as_of) });
  }

  // --- Build / version / last-update footer + meta tags ---
  // Single source of truth: the backend's /health.version constant and the
  // latest prices.created_at (already loaded above as lastUpdate). The HTML
  // ships placeholders so the layout doesn't jump on hydration; we just fill
  // them in now.
  const version = (health && typeof health.version === "string") ? health.version : "—";
  const lastUpdateIso = lastUpdate?.as_of || null;
  applyAppMeta(version, lastUpdateIso);

  // --- 3 metric cards ---
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

}

function pageHref(page) {
  return document.body?.dataset?.rootEntry === "true"
    ? `./frontend/${page}.html`
    : `./${page}.html`;
}

/**
 * Write build version + last-update timestamp into the footer AND the
 * matching <meta name="app:version"> / <meta name="app:last-update">
 * tags. The footer is what users see; the meta tags are for devtools /
 * crawlers (filled at the same moment so both stay consistent).
 */
function applyAppMeta(version, lastUpdateIso) {
  const versionSafe = String(version || "—");
  const updateSafe = lastUpdateIso ? formatDateTime(lastUpdateIso) : "—";

  const targets = document.querySelectorAll("[data-app-version]");
  targets.forEach((el) => {
    if (el.tagName === "META") el.setAttribute("content", versionSafe);
    else el.textContent = `v${versionSafe}`;
  });
  const updateTargets = document.querySelectorAll("[data-app-last-update]");
  updateTargets.forEach((el) => {
    if (el.tagName === "META") el.setAttribute("content", lastUpdateIso || "");
    else el.textContent = `最後更新：${updateSafe}`;
  });
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
