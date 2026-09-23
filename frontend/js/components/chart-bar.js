/**
 * stock_hold — BarChart wrapper around Chart.js 4.x (UMD via CDN).
 *
 * Per COMPONENT-INVENTORY §6 <BarChart>:
 *   data: [{ x, y, stack? }]
 *   stacked?, horizontal?
 *   sr-only <table> for screen readers.
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

function resolveColor(v) {
  if (!v) return null;
  if (v.startsWith("var(")) {
    const m = v.match(/var\(([^)]+)\)/);
    if (m) return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || v;
  }
  return v;
}

export async function createBarChart({
  data = [],          // [{ x, y, stack? }]
  labels = null,      // optional x labels (overrides per-row x)
  datasets = null,    // alternative: [{ label, values, color }]
  title = "",
  stacked = false,
  horizontal = false,
  height = 280,
  yFormatter = null,  // (val) => string for tooltip/axis
} = {}) {
  const Chart = await loadChartJs();
  if (!Chart) throw new Error("Chart.js unavailable");

  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";
  wrap.style.position = "relative";
  wrap.style.width = "100%";
  wrap.style.height = `${height}px`;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", title || "長條圖");
  wrap.appendChild(canvas);

  // sr-only table
  const srTable = document.createElement("table");
  srTable.className = "sr-only";
  const cap = document.createElement("caption");
  cap.textContent = title || "長條圖";
  srTable.appendChild(cap);
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>X</th><th>值</th></tr>";
  srTable.appendChild(thead);
  const tbody = document.createElement("tbody");
  data.forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${String(d.x)}</td><td>${d.y}</td>`;
    tbody.appendChild(tr);
  });
  srTable.appendChild(tbody);
  wrap.appendChild(srTable);

  let chartData;
  if (datasets) {
    chartData = {
      labels: labels || datasets[0]?.values.map((_, i) => data[i]?.x ?? i) || [],
      datasets: datasets.map((ds) => ({
        label: ds.label,
        data: ds.values,
        backgroundColor: resolveColor(ds.color) || "var(--chart-1)",
        stack: stacked ? (ds.stack || "default") : undefined,
      })),
    };
  } else {
    const xs = data.map((d) => d.x);
    chartData = {
      labels: labels || xs,
      datasets: [{
        label: title || "數值",
        data: data.map((d) => Number(d.y || 0)),
        backgroundColor: data.map((d, i) =>
          resolveColor(d.color) ||
          ["var(--chart-1)","var(--chart-2)","var(--chart-3)","var(--chart-4)","var(--chart-5)","var(--chart-6)"][i % 6]
        ),
        stack: stacked ? (data[0]?.stack || "default") : undefined,
      }],
    };
  }

  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--color-text").trim();
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--color-border").trim();

  const chart = new Chart(canvas, {
    type: "bar",
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? "y" : "x",
      scales: {
        x: {
          stacked,
          ticks: { color: textColor },
          grid:  { color: gridColor },
        },
        y: {
          stacked,
          ticks: {
            color: textColor,
            callback: yFormatter || ((v) => v.toLocaleString()),
          },
          grid: { color: gridColor },
        },
      },
      plugins: {
        legend: { position: "bottom", labels: { color: textColor } },
        tooltip: {
          callbacks: {
            label(ctx) {
              return `${ctx.dataset.label || ""}: ${(yFormatter ? yFormatter(ctx.parsed[horizontal ? "x" : "y"]) : ctx.parsed[horizontal ? "x" : "y"].toLocaleString())}`;
            },
          },
        },
      },
    },
  });

  return {
    el: wrap,
    chart,
    destroy() { chart.destroy(); },
  };
}
