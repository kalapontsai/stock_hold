/**
 * stock_hold — CurrencyInput component
 *
 * Per COMPONENT-INVENTORY §4 <CurrencyInput>:
 *   { currency: "TWD" | "USD" | ..., decimal: 2 | 4, signed? }
 *
 * String-only arithmetic — never parseFloat on user text.
 * Focus: raw value shown. Blur: auto-formatted with thousands separators.
 * Returns: the input element + a `getRawValue()` helper.
 */

const CCY_PREFIX = {
  TWD: "NT$", USD: "USD", JPY: "¥", EUR: "€", GBP: "£", HKD: "HK$", CNY: "¥",
};

function decimalFromString(s) {
  if (s === null || s === undefined) return null;
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (trimmed === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  return trimmed;
}

function decimalRound(v, digits) {
  const neg = v.startsWith("-");
  const abs = neg ? v.slice(1) : v;
  const [intPart, fracPart = ""] = abs.split(".");
  if (fracPart.length <= digits) {
    return (neg ? "-" : "") + intPart +
      (digits > 0 ? "." + (fracPart + "0".repeat(digits - fracPart.length)) : "");
  }
  const truncated = intPart + fracPart.slice(0, digits);
  const nextDigit = parseInt(fracPart.charAt(digits) || "0", 10);
  const incremented = nextDigit >= 5 ? BigInt(truncated) + 1n : BigInt(truncated);
  const result = incremented.toString();
  const newInt = result.slice(0, result.length - digits) || "0";
  const newFrac = digits > 0 ? result.slice(-digits) : "";
  return (neg ? "-" : "") + newInt + (newFrac ? "." + newFrac : "");
}

function formatNumber(value, digits) {
  const v = decimalFromString(value);
  if (v === null) return "";
  const rounded = decimalRound(v, digits);
  const isNeg = rounded.startsWith("-");
  const abs = isNeg ? rounded.slice(1) : rounded;
  const [intPart, fracPart = ""] = abs.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (isNeg ? "-" : "") + (digits > 0 ? `${grouped}.${fracPart}` : grouped);
}

export function createCurrencyInput({
  name = "",
  currency = "TWD",
  decimals = 2,
  value = "",
  placeholder = "0",
  ariaLabel = "",
  required = false,
  id = "",
} = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "input-group";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "input input--number input--currency";
  input.name = name;
  input.id = id || name;
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.placeholder = placeholder;
  if (required) input.required = true;
  if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
  input.dataset.currency = currency;
  input.dataset.decimals = String(decimals);
  if (value !== "" && value !== null && value !== undefined) {
    input.value = formatNumber(String(value), decimals);
  }

  const suffix = document.createElement("span");
  suffix.className = "input-group__suffix";
  suffix.textContent = currency;
  suffix.setAttribute("aria-hidden", "true");

  wrapper.appendChild(input);
  wrapper.appendChild(suffix);

  input.addEventListener("focus", () => {
    // Strip thousands separators, show raw editable text.
    const raw = (input.value || "").replace(/[,\s]/g, "");
    input.value = raw;
    setTimeout(() => input.select(), 0);
  });

  input.addEventListener("blur", () => {
    const raw = (input.value || "").trim();
    if (raw === "") { return; }
    const v = decimalFromString(raw);
    if (v === null) {
      input.value = "";
      return;
    }
    input.value = formatNumber(v, decimals);
  });

  // Allow only digits / dot / minus while typing
  input.addEventListener("keydown", (e) => {
    const allowed = ["Backspace","Delete","Tab","Escape","Enter","Home","End","ArrowLeft","ArrowRight"];
    if (allowed.includes(e.key)) return;
    if ((e.ctrlKey || e.metaKey) && ["a","c","v","x"].includes(e.key.toLowerCase())) return;
    if (/^[0-9.\\-]$/.test(e.key)) return;
    e.preventDefault();
  });

  input.addEventListener("input", () => {
    // Sanitize on input
    let v = input.value.replace(/[^0-9.\-]/g, "");
    // Only one minus, only at start
    v = v.replace(/(?!^)-/g, "");
    // Only one dot
    const firstDot = v.indexOf(".");
    if (firstDot !== -1) {
      v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
    }
    input.value = v;
  });

  return {
    el: wrapper,
    input,
    getRawValue() {
      const raw = (input.value || "").replace(/[,\s]/g, "");
      return decimalFromString(raw);
    },
    setValue(v) {
      if (v === null || v === undefined || v === "") input.value = "";
      else input.value = formatNumber(String(v), decimals);
    },
  };
}

/* Also expose the CCY_PREFIX map for callers that want to mirror the
 * visual cue outside an input (e.g. in a chip). */
export { CCY_PREFIX };
