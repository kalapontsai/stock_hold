/**
 * stock_hold — MetricCard component
 *
 * Per COMPONENT-INVENTORY §2 <MetricCard>:
 *   { label, value, delta?: { value, direction, period }, semantic, href }
 *
 * Pure DOM, no framework. Returns the root element so callers can append.
 */

export function createMetricCard({
  label,
  value,
  delta = null,
  period = null,
  semantic = "neutral",
  href = null,
  progressPercent = null,
} = {}) {
  const card = document.createElement(href ? "a" : "article");
  card.className = "metric-card";
  card.setAttribute("aria-label", label);
  if (href) {
    card.href = href;
    card.classList.add("card--clickable");
  }

  const lbl = document.createElement("p");
  lbl.className = "metric-card__label";
  lbl.textContent = label;
  card.appendChild(lbl);

  const val = document.createElement("div");
  val.className = "metric-card__value num";
  if (semantic === "positive") val.classList.add("value-positive");
  if (semantic === "negative") val.classList.add("value-negative");
  val.textContent = value;
  card.appendChild(val);

  if (delta) {
    const d = document.createElement("div");
    d.className = "metric-card__delta";
    if (delta.direction === "up")   d.classList.add("metric-card__delta--positive");
    if (delta.direction === "down") d.classList.add("metric-card__delta--negative");
    if (delta.direction === "flat") d.classList.add("metric-card__delta--neutral");
    const arrow = delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "─";
    const sign = delta.direction === "down" ? "-" : delta.direction === "up" ? "+" : "";
    d.textContent = `${sign}${delta.value}${arrow}`;
    card.appendChild(d);
  }

  if (period) {
    const p = document.createElement("div");
    p.className = "metric-card__period";
    p.textContent = period;
    card.appendChild(p);
  }

  if (progressPercent !== null && progressPercent !== undefined) {
    const wrap = document.createElement("div");
    wrap.className = "metric-card__progress";
    const fill = document.createElement("div");
    fill.className = "metric-card__progress-bar";
    fill.style.width = `${Math.max(0, Math.min(100, progressPercent))}%`;
    fill.setAttribute("role", "presentation");
    wrap.appendChild(fill);
    wrap.setAttribute("role", "progressbar");
    wrap.setAttribute("aria-valuenow", String(progressPercent));
    wrap.setAttribute("aria-valuemin", "0");
    wrap.setAttribute("aria-valuemax", "100");
    wrap.setAttribute("aria-label", `${label} 使用率 ${progressPercent}%`);
    card.appendChild(wrap);
  }

  return card;
}
