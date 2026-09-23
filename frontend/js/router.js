/**
 * stock_hold — Hash router (~30 lines per ADR-002)
 *
 * Lightweight client-side router for hash-based deep links (e.g.
 * `#/reports?tab=dividends` or `#/transactions?account=xxx`). Full page
 * navigation is server-side via 5 separate HTML files.
 *
 * Usage:
 *   router.start({ "/": dashboardHandler });
 *   router.go("/transactions?account=abc");
 *   router.onChange((path, query) => ...);
 */

const routes = new Map();
let listeners = new Set();
let started = false;

function parseHash() {
  let raw = (window.location.hash || "").replace(/^#/, "");
  if (!raw || raw === "/") raw = "/";
  const [path, qs = ""] = raw.split("?");
  const query = {};
  qs.split("&").filter(Boolean).forEach((kv) => {
    const [k, v = ""] = kv.split("=");
    query[decodeURIComponent(k)] = decodeURIComponent(v);
  });
  return { path, query };
}

function emit() {
  const { path, query } = parseHash();
  const handler = routes.get(path) || routes.get("*");
  if (handler) handler({ path, query });
  listeners.forEach((fn) => { try { fn({ path, query }); } catch (_) {} });
}

export const router = {
  start(routeMap, defaultPath = "/") {
    Object.entries(routeMap).forEach(([p, fn]) => routes.set(p, fn));
    if (!window.location.hash) window.location.hash = defaultPath;
    window.addEventListener("hashchange", emit);
    started = true;
    emit();
  },
  go(path) {
    if (window.location.hash === "#" + path) emit();
    else window.location.hash = path;
  },
  onChange(fn) {
    listeners.add(fn);
    if (started) {
      const { path, query } = parseHash();
      try { fn({ path, query }); } catch (_) {}
    }
    return () => listeners.delete(fn);
  },
  current() { return parseHash(); },
};
