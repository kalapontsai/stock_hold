/**
 * stock_hold — Shared HTML escape helper (Phase 5-fix H-4).
 *
 * Centralised so every page applies the same escaping rules when it has to
 * build markup via innerHTML. For NEW code prefer textContent / DOM APIs
 * over innerHTML; this helper exists for the cases where innerHTML is
 * unavoidable (templating with embedded structure, table cells that contain
 * `<strong>` / `<span>` decorations, etc.).
 *
 * Escape table covers the five characters that can break out of a double-
 * quoted HTML attribute or element body:
 *
 *   & → &amp;   (MUST be first, otherwise we'd double-escape later replacements)
 *   < → &lt;
 *   > → &gt;
 *   " → &quot;
 *   ' → &#39;
 *
 * Non-string values (null / undefined / numbers) are coerced so callers
 * don't have to guard at every site.
 */

const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape a single value for safe insertion into an HTML body or attribute. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

/** Escape a value for safe use inside a `<script>` block or JS string literal. */
export function escapeJs(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
