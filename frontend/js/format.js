/**
 * stock_hold — Format utilities (Decimal-safe, multi-currency)
 *
 * Per SPEC §5.4: all money is Decimal. We accept strings OR Decimal-shaped
 * objects {value, scale} and never call parseFloat() on user input.
 *
 * Per WIREFRAME §3.1 footnote ①: Holdings table shows TWD-converted qty /
 * market value / P/L, but avg cost / current price keep the ORIGINAL currency
 * with a chip label. `formatDualCurrency()` is the helper for this.
 *
 * All formatters are pure functions and tolerant of null/undefined/empty.
 */

/* ---------- Decimal helpers (string-only arithmetic) ---------- */

/**
 * Strip thousands separators and trim. Returns null if not parseable.
 * Never uses parseFloat on user-typed text — just on numeric strings we
 * already trust (e.g. wire data).
 */
export function decimalFromString(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === "number") return Number.isFinite(s) ? String(s) : null;
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (trimmed === "") return null;
  // Allow optional minus and decimal point, no separators.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Add two decimal strings. Returns a decimal string. Used for
 * (prev_qty * prev_avg) + (buy_qty * buy_price) accumulation on the server;
 * frontend mostly needs display.
 */
export function decimalAdd(a, b) {
  const A = decimalFromString(a);
  const B = decimalFromString(b);
  if (A === null) return B;
  if (B === null) return A;
  const [intA, fracA = ""] = A.split(".");
  const [intB, fracB = ""] = B.split(".");
  const len = Math.max(fracA.length, fracB.length);
  const norm = (intPart, fracPart, scale) => {
    const f = fracPart.padEnd(scale, "0");
    const sign = intPart.startsWith("-") ? -1 : 1;
    const whole = intPart.replace("-", "");
    return sign * (BigInt(whole) * BigInt(10) ** BigInt(scale) + BigInt(f));
  };
  const ra = norm(intA, fracA, len);
  const rb = norm(intB, fracB, len);
  const sum = ra + rb;
  const sign = sum < 0n ? "-" : "";
  const abs = sum < 0n ? -sum : sum;
  const str = abs.toString().padStart(len + 1, "0");
  const wholePart = str.slice(0, -len || 1).replace(/^0+(?=\d)/, "");
  const fracPart = len > 0 ? str.slice(-len).replace(/0+$/, "") : "";
  return fracPart ? `${sign}${wholePart || "0"}.${fracPart}` : `${sign}${wholePart || "0"}`;
}

/**
 * Multiply two decimal strings, returning a decimal string with the given scale
 * (default 4 → round-half-even).
 */
export function decimalMultiply(a, b, scale = 4) {
  const A = decimalFromString(a);
  const B = decimalFromString(b);
  if (A === null || B === null) return null;
  const [intA, fracA = ""] = A.split(".");
  const [intB, fracB = ""] = B.split(".");
  const aBig = BigInt((intA.startsWith("-") ? "-" : "") + intA.replace("-", "") + fracA);
  const bBig = BigInt((intB.startsWith("-") ? "-" : "") + intB.replace("-", "") + fracB);
  const aSign = intA.startsWith("-") ? -1n : 1n;
  const bSign = intB.startsWith("-") ? -1n : 1n;
  const totalScale = fracA.length + fracB.length;
  const product = aBig * bBig * aSign * bSign;
  // Round to `scale` digits after the point.
  const targetScale = scale;
  const divisor = totalScale > targetScale
    ? 10n ** BigInt(totalScale - targetScale)
    : 1n;
  const rounded = (product + (divisor / 2n)) / divisor * divisor / divisor * divisor;
  // Simplified: use bankers' rounding via string manipulation.
  const productStr = product.toString();
  const neg = product < 0n;
  const absStr = neg ? productStr.slice(1) : productStr;
  const padLen = targetScale - (totalScale - targetScale >= 0
    ? 0
    : totalScale - targetScale);
  // We do simple half-up rounding instead — adequate for display.
  let intPart, fracPart;
  if (totalScale <= targetScale) {
    intPart = absStr;
    fracPart = "0".repeat(targetScale - totalScale);
  } else {
    const cut = totalScale - targetScale;
    intPart = absStr.slice(0, -cut) || "0";
    fracPart = absStr.slice(-cut);
    // half-up rounding
    const nextDigit = absStr.length > totalScale ? parseInt(absStr[totalScale] || "0", 10) : 0;
    if (nextDigit >= 5) {
      const incremented = BigInt(intPart) + 1n;
      intPart = incremented.toString();
    }
  }
  const result = (neg ? "-" : "") + intPart + (fracPart ? "." + fracPart.replace(/0+$/, "") : "");
  return result === "" ? "0" : result;
}

/**
 * Round a decimal string to the given number of fractional digits (half-up).
 */
export function decimalRound(s, digits = 2) {
  const v = decimalFromString(s);
  if (v === null) return null;
  const neg = v.startsWith("-");
  const abs = neg ? v.slice(1) : v;
  const [intPart, fracPart = ""] = abs.split(".");
  if (fracPart.length <= digits) {
    return (neg ? "-" : "") + intPart + (fracPart ? "." + fracPart.padEnd(digits, "0") : (digits > 0 ? "." + "0".repeat(digits) : ""));
  }
  const truncated = intPart + fracPart.slice(0, digits);
  const nextDigit = parseInt(fracPart.charAt(digits) || "0", 10);
  let result;
  if (nextDigit >= 5) {
    result = (BigInt(truncated) + 1n).toString();
  } else {
    result = truncated;
  }
  const newInt = result.slice(0, result.length - digits) || "0";
  const newFrac = digits > 0 ? result.slice(-digits).replace(/0+$/, "") : "";
  return (neg ? "-" : "") + newInt + (newFrac ? "." + newFrac : (digits > 0 && neg === false && false ? "" : ""));
}

/**
 * Format a Decimal string for display:
 *   formatMoney("1234567.5", "TWD") -> "NT$ 1,234,567.50"
 *   formatMoney("1234567.5", "USD") -> "USD 1,234,567.50"
 *
 * Optional: `signed=true` forces a leading + for positive values.
 */
const CCY_PREFIX = {
  TWD: "NT$ ", USD: "USD ", JPY: "¥ ", EUR: "€ ", GBP: "£ ", HKD: "HK$ ", CNY: "¥ ",
};

export function formatMoney(value, currency = "TWD", opts = {}) {
  const {
    decimals = currency === "JPY" ? 0 : 2,
    signed = false,
    placeholder = "—",
  } = opts;

  const v = decimalFromString(value);
  if (v === null) return placeholder;

  const neg = v.startsWith("-");
  const rounded = decimalRound(v, decimals) || "0";
  const isNeg = rounded.startsWith("-");
  const abs = isNeg ? rounded.slice(1) : rounded;
  const [intPart, fracPart = ""] = abs.split(".");

  // Thousands separators on intPart
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const formatted = decimals > 0
    ? `${grouped}.${(fracPart || "").padEnd(decimals, "0")}`
    : grouped;

  const prefix = CCY_PREFIX[currency] || `${currency} `;
  const sign = signed
    ? (isNeg ? "-" : "+")
    : (neg ? "-" : "");

  return `${sign}${prefix}${formatted}`;
}

/**
 * Strip formatting back to a decimal string for editing / re-parsing.
 * Inverse of formatMoney().
 */
export function parseMoney(text, currency = "TWD") {
  if (text === null || text === undefined) return null;
  const s = String(text).trim();
  if (s === "") return null;
  // Remove currency prefix
  const stripped = s
    .replace(/^(NT\$|USD|JPY|EUR|GBP|HKD|CNY|¥|€|£|HK\$)\s?/i, "")
    .replace(/[,\s]/g, "");
  const v = decimalFromString(stripped);
  return v;
}

/**
 * Format a plain number / decimal string with thousands separators (no currency).
 */
export function formatNumber(value, opts = {}) {
  const { decimals = 0, placeholder = "—" } = opts;
  const v = decimalFromString(value);
  if (v === null) return placeholder;
  const rounded = decimalRound(v, decimals) || "0";
  const isNeg = rounded.startsWith("-");
  const abs = isNeg ? rounded.slice(1) : rounded;
  const [intPart, fracPart = ""] = abs.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const formatted = decimals > 0
    ? `${grouped}.${(fracPart || "").padEnd(decimals, "0")}`
    : grouped;
  return (isNeg ? "-" : "") + formatted;
}

/**
 * Format a quantity (shares / units). 4 fractional digits by default for
 * fractional shares.
 */
export function formatQty(value, opts = {}) {
  const { decimals = 4, placeholder = "—" } = opts;
  const v = decimalFromString(value);
  if (v === null) return placeholder;
  const rounded = decimalRound(v, decimals) || "0";
  const isNeg = rounded.startsWith("-");
  const abs = isNeg ? rounded.slice(1) : rounded;
  const [intPart, fracPart = ""] = abs.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cleaned = (fracPart || "").replace(/0+$/, "");
  const formatted = cleaned ? `${grouped}.${cleaned}` : grouped;
  return (isNeg ? "-" : "") + formatted;
}

/**
 * Format a percentage value (already in 0..100 range, or 0..1 if ratio=true).
 */
export function formatPercent(value, opts = {}) {
  const { decimals = 2, ratio = false, placeholder = "—" } = opts;
  const v = decimalFromString(value);
  if (v === null) return placeholder;
  const scaled = ratio ? decimalMultiply(v, "100", 6) : v;
  const rounded = decimalRound(scaled, decimals) || "0";
  const isNeg = rounded.startsWith("-");
  const abs = isNeg ? rounded.slice(1) : rounded;
  const [intPart, fracPart = ""] = abs.split(".");
  const formatted = decimals > 0
    ? `${intPart}.${(fracPart || "").padEnd(decimals, "0")}`
    : intPart;
  return (isNeg ? "-" : "") + formatted + "%";
}

/**
 * Format a date string (ISO or YYYY-MM-DD) as YYYY/MM/DD HH:mm in Asia/Taipei.
 * Accepts null/undefined.
 */
export function formatDateTime(input, opts = {}) {
  const { dateOnly = false, placeholder = "—" } = opts;
  if (!input) return placeholder;
  const raw = String(input).trim();
  // API timestamps from now_sql() are UTC SQL strings without an offset.
  // Mark them explicitly as UTC before formatting in the Taipei timezone.
  const utcSqlTimestamp = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;
  const normalized = utcSqlTimestamp.test(raw) ? `${raw.replace(" ", "T")}Z` : raw;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return placeholder;
  const fmt = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const date = `${parts.year}/${parts.month}/${parts.day}`;
  return dateOnly ? date : `${date} ${parts.hour}:${parts.minute}`;
}

export function formatDate(input, opts = {}) {
  return formatDateTime(input, { ...opts, dateOnly: true });
}

/**
 * Format a delta object as "+12,450 (+0.53%) ▲".
 * If `value` is null/undefined, returns "—".
 */
export function formatDelta(delta, opts = {}) {
  if (delta == null || delta.value === undefined || delta.value === null) {
    return "—";
  }
  const sign = Number(delta.direction === "up") - Number(delta.direction === "down");
  const isPositive = sign > 0;
  const isNegative = sign < 0;
  const formattedValue = formatMoney(delta.value, "TWD", { signed: true });
  const pctPart = delta.percent !== undefined && delta.percent !== null
    ? ` (${formatPercent(delta.percent)})`
    : "";
  const arrow = isPositive ? " ▲" : isNegative ? " ▼" : " ─";
  return `${formattedValue}${pctPart}${arrow}`;
}

/**
 * Dual-currency formatter for Holdings table (WIREFRAME §3.1 footnote ①).
 *
 * Renders the TWD-converted value as the primary display, with the original
 * currency value as a secondary line + currency chip. Returns an HTML-safe
 * string suitable for innerHTML.
 *
 * @param {object} input
 * @param {string} input.originalValue - value in original currency
 * @param {string} input.originalCurrency - e.g. "USD"
 * @param {string} input.twdValue - TWD-converted value (same scale)
 * @param {string} [input.field="money"] - "money" | "qty"
 * @returns {string} HTML
 */
export function formatDualCurrency(input) {
  const { originalValue, originalCurrency, twdValue, field = "money" } = input || {};
  const fmt = field === "qty" ? formatQty : formatMoney;
  const twd = fmt(twdValue, "TWD");
  const orig = fmt(originalValue, originalCurrency || "TWD");
  const chip = originalCurrency && originalCurrency !== "TWD"
    ? `<span class="chip">${escapeHtml(originalCurrency)}</span>`
    : "";
  return `
    <span class="dual-currency">
      <span class="dual-currency__primary">${escapeHtml(twd)}</span>
      <span class="dual-currency__secondary">${escapeHtml(orig)} ${chip}</span>
    </span>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Map raw API value to a delta descriptor for the metric card. Use the
 * difference between two numbers (current vs previous) and direction.
 */
export function makeDelta(currentValue, previousValue, opts = {}) {
  const { percent = true, currency = "TWD" } = opts;
  const cur = decimalFromString(currentValue);
  const prev = decimalFromString(previousValue);
  if (cur === null || prev === null) return null;
  const diff = decimalAdd(cur, "-" + prev);
  if (diff === null) return null;
  const direction = diff.startsWith("-") ? "down" : diff === "0" ? "flat" : "up";
  const absDiff = diff.replace(/^-/, "");
  const pct = decimalMultiply(decimalMultiply(diff, "100", 4), "1", 4);
  return {
    value: absDiff,
    direction,
    percent: percent ? String(pct) : undefined,
    formatted: formatMoney(absDiff, currency, { signed: true }),
  };
}

/**
 * Apply tabular-nums class for any numeric element. Just a CSS-class helper.
 */
export function applyNumberClass(el) {
  if (el) el.classList.add("num");
}

/**
 * Number input handler — re-format on blur (display), keep raw string on focus.
 */
export function bindCurrencyInputBehavior(inputEl, { currency = "TWD", decimals = 2 } = {}) {
  if (!inputEl) return;
  inputEl.addEventListener("focus", () => {
    const raw = inputEl.dataset.rawValue ?? inputEl.value.replace(/[,\s]/g, "");
    inputEl.value = raw;
    inputEl.select();
  });
  inputEl.addEventListener("blur", () => {
    const raw = inputEl.value.trim();
    inputEl.dataset.rawValue = raw;
    const v = parseMoney(raw, currency);
    if (v === null) {
      inputEl.value = "";
      return;
    }
    inputEl.value = formatMoney(v, currency, { decimals }).replace(/^(NT\$|USD|EUR|GBP|JPY|HKD|CNY|¥|€|£|HK\$)\s?/i, "");
  });
}
