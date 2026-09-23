/**
 * stock_hold — PieChart wrapper around Chart.js 4.x (UMD via CDN).
 *
 * Per COMPONENT-INVENTORY §6 <PieChart>:
 *   data: [{ label, value, color? }]
 *   onSliceClick?
 *   sr-only <table> appended for screen readers.
 *
 * Chart.js is loaded via <script src="https://cdn.jsdelivr.net/npm/chart.js@4">
 * in the HTML; the global `window.Chart` becomes available. We wait for it if
 * not yet ready (defensive against script load races).
 */

let _Chart = null;
let _ready = null;

function loadChartJs() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.Chart) { _Chart = window.Chart; return Promise.resolve(_Chart); }
  if (_ready) return _ready;
  _ready = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js@4";
    script.async = true;
    script.onload = () => { _Chart = window.Chart; resolve(_Chart); };
    script.onerror = () => reject(new Error("Failed to load Chart.js"));
    document.head.appendChild(script);
  });
  return _ready;
}

// CSS variables backing the design-token chart palette.
// Chart.js draws onto <canvas>, which cannot resolve `var(--…)` references —
// we must hand it concrete color strings via getComputedStyle(). See DESIGN-TOKENS §2.8.
const PALETTE_VARS = [
  "--chart-1", "--chart-2", "--chart-3",
  "--chart-4", "--chart-5", "--chart-6",
];

function resolveCssVar(name) {
  // getPropertyValue returns the *used* value of a custom property, resolving
  // chained `var()` references. Empty string only when the var is undefined.
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function resolveColor(v, i) {
  // No per-slice color: pick from the chart-palette CSS vars and resolve them
  // to concrete colors so Chart.js canvas can render them.
  if (!v) {
    const resolved = resolveCssVar(PALETTE_VARS[i % PALETTE_VARS.length]);
    return resolved || PALETTE_VARS[i % PALETTE_VARS.length];
  }
  if (v.startsWith("var(")) {
    const m = v.match(/var\(([^)]+)\)/);
    if (m) {
      const resolved = resolveCssVar(m[1]);
      if (resolved) return resolved;
    }
  }
  return v;
}

export async function createPieChart({
  data = [],
  title = "",
  onSliceClick = null,
  width = 320,
  height = 320,
} = {}) {
  const Chart = await loadChartJs();
  if (!Chart) throw new Error("Chart.js unavailable");

  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";
  wrap.style.position = "relative";
  wrap.style.width = "100%";
  wrap.style.maxWidth = `${width}px`;
  wrap.style.margin = "0 auto";

  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", title || "圓餅圖");
  wrap.appendChild(canvas);

  // sr-only table
  const srTable = document.createElement("table");
  srTable.className = "sr-only";
  const cap = document.createElement("caption");
  cap.textContent = title || "圓餅圖";
  srTable.appendChild(cap);
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>類別</th><th>金額</th><th>占比</th></tr>";
  srTable.appendChild(thead);
  const tbody = document.createElement("tbody");
  const total = data.reduce((s, d) => s + Number(d.value || 0), 0) || 1;
  data.forEach((d) => {
    const tr = document.createElement("tr");
    const pct = ((Number(d.value || 0) / total) * 100).toFixed(2);
    tr.innerHTML = `<td>${escape(d.label)}</td><td>${d.value}</td><td>${pct}%</td>`;
    tbody.appendChild(tr);
  });
  srTable.appendChild(tbody);
  wrap.appendChild(srTable);

  const labels = data.map((d) => d.label);
  const values = data.map((d) => Number(d.value || 0));
  const colors = data.map((d, i) => resolveColor(d.color, i));

  const chart = new Chart(canvas, {
    type: "pie",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim() || "#fff",
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: getComputedStyle(document.documentElement).getPropertyValue("--color-text").trim() },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const total = ctx.dataset.data.reduce((s, v) => s + v, 0) || 1;
              const pct = ((ctx.parsed / total) * 100).toFixed(2);
              return `${ctx.label}: ${ctx.parsed.toLocaleString()} (${pct}%)`;
            },
          },
        },
      },
      onClick(evt, elements) {
        if (!onSliceClick) return;
        if (elements.length) {
          const i = elements[0].index;
          onSliceClick(data[i], i);
        }
      },
    },
  });

  return {
    el: wrap,
    chart,
    destroy() { chart.destroy(); },
  };
}

function escape(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
