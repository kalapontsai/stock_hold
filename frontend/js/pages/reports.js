/**
 * stock_hold — Reports page (2 tabs: dividends, pnl history)
 *
 * 2.3.0: removed "realized" / "unrealized" / "tax" tabs (replaced by
 * /reports/pnl-history which lives in the new "history" tab). The chart
 * here are hand-rolled SVG charts — no Chart.js dep, no CDN hit, full
 * control over the shared time axis and reconstructed-data markers.
 * Dividend tab uses the existing data-table component.
 */

import * as api from "../api-client.js";
import { t } from "../i18n.js";
import { formatMoney, formatDate } from "../format.js";
import { createDataTable } from "../components/data-table.js";
import { escapeHtml } from "../utils/escape-html.js";

const TABS = [
  { key: "history",   label: "rpt.tab.history" },
  { key: "dividends", label: "rpt.tab.dividends" },
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
        <input type="date" class="input" data-period-from value="${defaultFrom()}" style="height:32px; width:auto">
        <span aria-hidden="true">~</span>
        <input type="date" class="input" data-period-to value="${defaultTo()}" style="height:32px; width:auto">
        <button type="button" class="btn btn--sm btn--secondary" data-preset="last90">近 90 天</button>
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
      if (p === "last90") {
        const to = new Date();
        const from = new Date(to.getTime() - 89 * 86400000);
        fromInput.value = isoDate(from);
        toInput.value = isoDate(to);
      } else if (p === "thisYear") {
        const t0 = new Date();
        fromInput.value = `${t0.getUTCFullYear()}-01-01`;
        toInput.value = isoDate(t0);
      }
      reloadAll();
    });
  });
  fromInput.addEventListener("change", reloadAll);
  toInput.addEventListener("change", reloadAll);

  // --- History tab
  async function renderHistory() {
    const p = panelEls.history;
    p.innerHTML = "";
    let data;
    try {
      data = await api.reports.pnlHistory({
        from: fromInput.value,
        to: toInput.value,
        granularity: "D",
      });
    } catch (e) {
      p.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
      return;
    }

    const labels = data.labels || [];
    if (labels.length === 0) {
      const empty = document.createElement("div");
      empty.className = "card section";
      empty.innerHTML = `<p>${escapeHtml(t("rpt.history.empty"))}</p>`;
      p.appendChild(empty);
      return;
    }

    // Metric strip: latest values + a one-line sparkline context.
    const lastIdx = labels.length - 1;
    const last = {
      total: Number(data.total_assets[lastIdx] || 0),
      market: Number(data.market_value[lastIdx] || 0),
      cash: Number(data.cash_balance[lastIdx] || 0),
      unrealized: Number(data.unrealized_pnl[lastIdx] || 0),
      realized: Number(data.realized_pl[lastIdx] || 0),
      daily: Number(data.daily_change[lastIdx] || 0),
      dailyPct: Number(data.daily_change_pct[lastIdx] || 0),
    };
    const cards = document.createElement("div");
    cards.className = "grid grid--metrics section";
    cards.appendChild(metricCard(t("rpt.history.metric.total"), formatMoney(String(last.total), "TWD", { decimals: 0 }),
      { value: formatPctLabel(last.daily, last.dailyPct), direction: last.daily >= 0 ? "up" : "down" },
      last.daily >= 0 ? "positive" : "negative"));
    cards.appendChild(metricCard(t("rpt.history.metric.market"), formatMoney(String(last.market), "TWD", { decimals: 0 })));
    cards.appendChild(metricCard(t("rpt.history.metric.cash"), formatMoney(String(last.cash), "TWD", { decimals: 0 })));
    cards.appendChild(metricCard(t("rpt.history.metric.unrealized"), formatMoney(String(last.unrealized), "TWD", { signed: true }),
      {}, last.unrealized >= 0 ? "positive" : "negative"));
    cards.appendChild(metricCard(t("rpt.history.metric.realized"), formatMoney(String(last.realized), "TWD", { signed: true, decimals: 0 }),
      {}, last.realized >= 0 ? "positive" : "negative"));
    p.appendChild(cards);

    // Both charts intentionally use the same viewBox, horizontal padding,
    // and tick indexes. This keeps their time axes physically aligned while
    // allowing each chart to have its own Y scale.
    const chartCard = document.createElement("div");
    chartCard.className = "card section";
    chartCard.innerHTML = `
      <div class="card__header">
        <h2 class="card__title">${escapeHtml(t("rpt.history.chart.total"))}</h2>
        <span class="card__hint" style="font-size: var(--text-xs); color: var(--color-text-muted);">${escapeHtml(t("rpt.history.partial"))}</span>
      </div>
      <div data-pnl-assets-chart></div>
      <div data-pnl-assets-legend style="display:flex; flex-wrap:wrap; gap: var(--space-3); margin-top: var(--space-2); font-size: var(--text-xs); color: var(--color-text-muted);"></div>
    `;
    p.appendChild(chartCard);
    chartCard.querySelector("[data-pnl-assets-chart]").appendChild(buildLineChart({
      labels,
      series: [
        { label: t("rpt.history.legend.total"), values: data.total_assets, color: "var(--chart-1)" },
        { label: t("rpt.history.legend.market"), values: data.market_value, color: "var(--chart-2)" },
        { label: t("rpt.history.legend.cash"), values: data.cash_balance, color: "var(--chart-3)" },
      ],
      dailyPct: data.daily_change_pct,
      source: Array.isArray(data.source) ? data.source : null,
      height: 320,
    }));
    chartCard.querySelector("[data-pnl-assets-legend]").innerHTML = [
      ["var(--chart-1)", t("rpt.history.legend.total")],
      ["var(--chart-2)", t("rpt.history.legend.market")],
      ["var(--chart-3)", t("rpt.history.legend.cash")],
      ["var(--chart-2)", t("rpt.history.legend.live"), "solid"],
      ["var(--chart-2)", t("rpt.history.legend.historical"), "hollow"],
    ].map(([color, label, marker]) => marker
      ? `<span><span style="display:inline-block; width:10px; height:10px; border-radius:50%; ${marker === "solid" ? `background:${color};` : `border:1.5px solid ${color}; background:var(--color-bg);`} vertical-align:middle;"></span> ${escapeHtml(label)}</span>`
      : `<span><span style="display:inline-block; width:18px; border-top:2px solid ${color}; vertical-align:middle;"></span> ${escapeHtml(label)}</span>`
    ).join("");

    const pnlChartCard = document.createElement("div");
    pnlChartCard.className = "card section";
    pnlChartCard.innerHTML = `
      <div class="card__header">
        <h2 class="card__title">${escapeHtml(t("rpt.history.chart.daily"))}</h2>
      </div>
      <div data-pnl-bars-chart></div>
      <div data-pnl-bars-legend style="display:flex; gap:var(--space-3); margin-top:var(--space-2); font-size:var(--text-xs); color:var(--color-text-muted);"></div>
    `;
    p.appendChild(pnlChartCard);
    pnlChartCard.querySelector("[data-pnl-bars-chart]").appendChild(buildBarChart({
      labels,
      values: data.daily_diff || [],
      height: 280,
    }));
    pnlChartCard.querySelector("[data-pnl-bars-legend]").innerHTML = [
      ["var(--color-positive)", t("rpt.history.legend.up")],
      ["var(--color-negative)", t("rpt.history.legend.down")],
    ].map(([color, label]) => `<span><span style="display:inline-block; width:10px; height:10px; background:${color}; vertical-align:middle;"></span> ${escapeHtml(label)}</span>`).join("");

    // Note (data source) — small, low-contrast.
    const note = document.createElement("p");
    note.style.cssText = "color: var(--color-text-muted); font-size: var(--text-xs); margin-top: var(--space-3);";
    note.textContent = t("rpt.history.note");
    p.appendChild(note);
  }

  // --- Dividends tab (unchanged structure; amount_twd is now correctly
  //     computed by the backend in 2.3.0).
  async function renderDividends() {
    const p = panelEls.dividends;
    p.innerHTML = "";
    let rows;
    try {
      rows = await api.reports.dividends({ from: fromInput.value, to: toInput.value });
    } catch (e) {
      p.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
      return;
    }
    if (!rows || rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "card section";
      empty.innerHTML = `<p>${escapeHtml(t("rpt.dividend.empty"))}</p>`;
      p.appendChild(empty);
      return;
    }
    const totalTwd = rows.reduce((s, r) => s + Number(r.amount_twd || 0), 0);
    const totalUsd = rows.filter((r) => r.currency === "USD")
      .reduce((s, r) => s + Number(r.qty) * Number(r.per_share), 0);
    // Try to read a real FX from app_settings; fall back to 30 (matches backend).
    let fx = 30;
    try {
      const s = await api.quoteSettings.get();
      // The quote-settings endpoint doesn't return FX; keep the demo
      // value. The backend computes amount_twd correctly with the
      // configured FX anyway, so this summary stays consistent.
      fx = 30;
      void s;
    } catch (_) { /* ignore */ }
    const approxTwd = Math.round(totalUsd * fx);

    const sum = document.createElement("div");
    sum.className = "card section";
    sum.innerHTML = `<h2 class="card__title">合計配息</h2>
      <div class="metric-card__value num value-positive">${formatMoney(String(totalTwd), "TWD", { decimals: 0 })} + ${totalUsd.toFixed(2)} USD</div>
      <div class="metric-card__period">≈ ${formatMoney(String(approxTwd), "TWD", { decimals: 0 })} (TWD 估算)</div>`;
    p.appendChild(sum);

    const tbl = createDataTable({
      columns: [
        { key: "symbol", header: t("rpt.col.symbol") },
        { key: "ex_date", header: t("rpt.col.exDate"), cell: (r) => `<span class="num">${escapeHtml(formatDate(r.ex_date))}</span>` },
        { key: "pay_date", header: t("rpt.col.payDate"), cell: (r) => `<span class="num">${escapeHtml(formatDate(r.pay_date))}</span>` },
        { key: "per_share", header: t("rpt.col.perShare"), numeric: true, align: "right",
          cell: (r) => `<span class="num">${formatMoney(r.per_share, r.currency)}</span>` },
        { key: "qty", header: t("rpt.col.qty"), numeric: true, align: "right",
          cell: (r) => `<span class="num">${Number(r.qty || 0).toLocaleString()}</span>` },
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
    await Promise.all([renderHistory(), renderDividends()]);
  }
  await reloadAll();
}

// ────────────────────────────────────────────────────────────────────
// Hand-rolled SVG line chart (no Chart.js dep)
// ────────────────────────────────────────────────────────────────────

function buildLineChart({ labels, series, dailyPct, source = null, height = 320 }) {
  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";
  wrap.style.cssText = `position: relative; width: 100%; height: ${height}px;`;

  // Responsive: use viewBox so the SVG scales with container width.
  const W = 1000;
  const H = height;
  const padL = 56, padR = 16, padT = 16, padB = 36;

  const n = labels.length;
  const xs = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const allValues = series.flatMap((s) => s.values).map(Number).filter(Number.isFinite);
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const span = Math.max(1, maxV - minV);
  const padY = span * 0.08;
  const yMin = minV - padY;
  const yMax = maxV + padY;
  const ys = (v) => padT + (1 - (Number(v) - yMin) / (yMax - yMin)) * (H - padT - padB);

  // Y-axis gridlines (5 ticks).
  const ticks = 5;
  let gridLines = "";
  let yLabels = "";
  for (let k = 0; k <= ticks; k++) {
    const v = yMin + (k / ticks) * (yMax - yMin);
    const y = ys(v);
    gridLines += `<line x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--color-border)" stroke-dasharray="2 4" />`;
    yLabels += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--color-text-muted)">${shortMoney(v)}</text>`;
  }
  // X-axis labels: first, middle, last + 1/4, 3/4 to avoid label collision.
  const xTickIdxs = chartTickIndexes(n);
  let xLabels = "";
  for (const i of xTickIdxs) {
    const x = xs(i);
    const label = labels[i] || "";
    xLabels += `<text x="${x.toFixed(1)}" y="${(H - padB + 16).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--color-text-muted)">${label.slice(5)}</text>`;
  }

  // Markers — solid fill, but if dailyPct[i] is missing (NaN/undefined) we
  // render a hollow ring to indicate partial data. 2.3.1: when the
  // backend reports source='historical_import' for a point, render a
  // semi-transparent ring to mark it as a reconstructed backfill.
  let paths = "";
  let markers = "";
  series.forEach((s) => {
    const path = s.values.map((v, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
    paths += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" />`;
  });
  // Markers use the total-assets daily completeness/source signal. The same
  // marker is repeated on each series so reconstructed days stay visible.
  series.forEach((s) => {
    for (let i = 0; i < n; i++) {
      const pct = dailyPct ? Number(dailyPct[i]) : null;
      const partial = pct === null || !Number.isFinite(pct);
      const x = xs(i);
      const y = ys(s.values[i]);
      const isHistorical = Array.isArray(source) && source[i] === "historical_import";
      if (partial) {
        markers += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="var(--color-bg)" stroke="${s.color}" stroke-width="1.5" />`;
      } else if (isHistorical) {
        markers += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="var(--color-bg)" stroke="${s.color}" stroke-width="1.5" opacity="0.7" />`;
      } else {
        markers += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${s.color}" />`;
      }
    }
  });

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" role="img" aria-label="總資產、市值與現金歷史走勢">
      ${gridLines}
      ${paths}
      ${markers}
      ${yLabels}
      ${xLabels}
    </svg>
  `;
  wrap.innerHTML = svg;
  return wrap;
}

function buildBarChart({ labels, values, height = 280 }) {
  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";
  wrap.style.cssText = `position:relative; width:100%; height:${height}px;`;
  const W = 1000, H = height;
  const padL = 56, padR = 16, padT = 16, padB = 36;
  const n = labels.length;
  const xs = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const nums = values.map(Number).filter(Number.isFinite);
  const minV = Math.min(0, ...nums), maxV = Math.max(0, ...nums);
  const span = Math.max(1, maxV - minV);
  const yMin = minV - span * 0.08, yMax = maxV + span * 0.08;
  const ys = (v) => padT + (1 - (Number(v) - yMin) / (yMax - yMin)) * (H - padT - padB);
  const zeroY = ys(0);
  let gridLines = "", yLabels = "";
  for (let k = 0; k <= 5; k++) {
    const v = yMin + (k / 5) * (yMax - yMin);
    const y = ys(v);
    gridLines += `<line x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--color-border)" stroke-dasharray="2 4" />`;
    yLabels += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--color-text-muted)">${shortMoney(v)}</text>`;
  }
  gridLines += `<line x1="${padL}" x2="${W - padR}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="var(--color-text-muted)" stroke-width="1.2" />`;
  const barWidth = Math.max(2, Math.min(14, (W - padL - padR) / Math.max(n, 1) * 0.68));
  const bars = values.map((v, i) => {
    const value = Number(v) || 0;
    const y = value >= 0 ? ys(value) : zeroY;
    const h = Math.max(1, Math.abs(ys(value) - zeroY));
    const color = value >= 0 ? "var(--color-positive)" : "var(--color-negative)";
    return `<rect x="${(xs(i) - barWidth / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" opacity="0.88"><title>${labels[i]}: ${shortMoney(value)}</title></rect>`;
  }).join("");
  const xTickIdxs = chartTickIndexes(n);
  const xLabels = xTickIdxs.map((i) => `<text x="${xs(i).toFixed(1)}" y="${(H - padB + 16).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--color-text-muted)">${labels[i].slice(5)}</text>`).join("");
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" role="img" aria-label="每日未實現損益長條圖">${gridLines}${bars}${yLabels}${xLabels}</svg>`;
  return wrap;
}

function chartTickIndexes(n) {
  return n <= 4 ? [...Array(n).keys()] : [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1];
}

function shortMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(2) + "億";
  if (a >= 1e4) return (n / 1e4).toFixed(1) + "萬";
  return Math.round(n).toString();
}

function formatPctLabel(delta, pct) {
  const d = Number(delta) || 0;
  const p = Number(pct) || 0;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${shortMoney(d)} (${p >= 0 ? "+" : ""}${p.toFixed(2)}%)`;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function defaultFrom() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 89);
  return isoDate(d);
}

function defaultTo() {
  return isoDate(new Date());
}
