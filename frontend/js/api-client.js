/**
 * stock_hold — API client (fetch wrapper aligned with SPEC §3.1 envelope)
 *
 * Envelope contract:
 *   {
 *     "status": "ok" | "error",
 *     "data": { ... },                    // on success
 *     "error": { code, message, detail }, // on failure
 *     "meta":  { request_id, ts }
 *   }
 *
 * The client never throws on `status: "error"` — it returns the envelope
 * so callers can branch on `.status` and inspect `.error` cleanly. Network
 * failures DO throw a typed ApiError so the boundary is explicit.
 *
 * Query-string convention: pass `?mock=1` (or set window.STOCK_HOLD_MOCK = true)
 * to short-circuit network and serve from `./mock/*.js` modules.
 */

import * as mockAccounts from "./mock/mock-accounts.js";
import * as mockTxns from "./mock/mock-transactions.js";
import * as mockHoldings from "./mock/mock-holdings.js";
import * as mockDashboard from "./mock/mock-dashboard.js";
import * as mockReports from "./mock/mock-reports.js";
import * as mockSecurities from "./mock/mock-securities.js";
import * as mockPrices from "./mock/mock-prices.js";
import * as mockSkills from "./mock/mock-skills.js";

export class ApiError extends Error {
  constructor(code, message, detail, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

/* ---------- Base URL ---------- */
// Apache serves /stock_hold/api/v1/* through the PHP front controller.
// Mock fixtures remain available for local UI development only.
const DEFAULT_BASE = "/stock_hold/api/v1";
let csrfToken = null;

function getBaseUrl() {
  if (typeof window === "undefined") return DEFAULT_BASE;
  if (window.STOCK_HOLD_API_BASE) return window.STOCK_HOLD_API_BASE;
  // Auto-detect: API and frontend share the same app root. Walk our own
  // import.meta.url to locate /frontend/ and strip it, so the same bundle
  // works whether stock_hold is mounted at the domain root or under a
  // sub-path (e.g. /stock_hold/). Detection runs once at module load.
  //   /frontend/js/api-client.js             → "/api/v1"
  //   /stock_hold/frontend/js/api-client.js  → "/stock_hold/api/v1"
  try {
    const here = import.meta.url;
    if (here) {
      const u = new URL(here);
      const m = u.pathname.match(/^(.*?)\/frontend\//);
      if (m) return (m[1] || "") + "/api/v1";
    }
  } catch (_) { /* fall through to DEFAULT_BASE */ }
  return DEFAULT_BASE;
}

/* ---------- Mock router ---------- */
function shouldUseMock() {
  if (typeof window === "undefined") return true;
  if (window.STOCK_HOLD_MOCK === true) return true;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mock") === "1") return true;
  } catch (_) { /* ignore */ }
  return false;
}

const MOCK_TABLE = {
  // GET
  "GET /accounts":           mockAccounts.listAccounts,
  "GET /accounts/{id}":      mockAccounts.getAccount,
  "POST /accounts/create":   mockAccounts.createAccount,
  "POST /accounts/update":   mockAccounts.updateAccount,
  "POST /accounts/delete":   mockAccounts.deleteAccount,
  "POST /accounts/disable":  mockAccounts.deleteAccount,
  "GET /securities":         mockSecurities.listSecurities,
  "GET /securities/{id}":    mockSecurities.getSecurity,
  "POST /securities/create":  mockSecurities.createSecurity,
  "POST /securities/update":  mockSecurities.updateSecurity,
  "POST /securities/delete":  mockSecurities.deleteSecurity,
  "POST /securities/disable": mockSecurities.deleteSecurity,
  "GET /transactions":       mockTxns.listTransactions,
  "GET /transactions/{id}":  mockTxns.getTransaction,
  "POST /transactions/create":       mockTxns.createTransaction,
  "POST /transactions/update":       mockTxns.updateTransaction,
  "POST /transactions/delete":       mockTxns.deleteTransaction,
  "POST /transactions/batch-delete": mockTxns.batchDeleteTransactions,
  "GET /holdings":           mockHoldings.listHoldings,
  "GET /dashboard/summary":  mockDashboard.summary,
  "GET /dashboard/allocation": mockDashboard.allocation,
  "GET /dashboard/recent":   mockDashboard.recent,
  "GET /reports/realized":   mockReports.realized,
  "GET /reports/unrealized": mockHoldings.listHoldings,
  "GET /reports/dividends":  mockReports.dividends,
  "GET /dividends":           mockReports.dividends,
  "GET /reports/tax-estimate": mockReports.taxEstimate,
  "GET /prices/last-update": mockPrices.lastUpdate,
  "GET /skills":             mockSkills.listSkills,
  "GET /health":              async () => ({ service: "stock_hold", version: "mock" }),
};

/* ---------- Internal request ---------- */
async function request(method, path, body, opts = {}) {
  const { query = null, signal = null, headers = {} } = opts;

  // Mock branch
  if (shouldUseMock()) {
    const envelope = await mockDispatch(method, path, body, query);
    if (envelope?.status === "ok") return envelope.data;
    throw new ApiError(
      envelope?.error?.code || "MOCK_ERROR",
      envelope?.error?.message || "Mock request failed",
      envelope?.error?.detail || null,
      0,
    );
  }

  // Real fetch branch
  if (method !== "GET" && method !== "HEAD") {
    await ensureCsrfToken();
  }
  const url = buildUrl(getBaseUrl() + path, query);
  const init = {
    method,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...headers,
    },
    signal,
  };
  if (body !== undefined && body !== null) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new ApiError("NETWORK_ERROR", e?.message || "Network error", null, 0);
  }

  let envelope = null;
  try {
    envelope = await res.json();
  } catch (_) {
    envelope = null;
  }

  if (!envelope || typeof envelope !== "object") {
    throw new ApiError("BAD_RESPONSE", `Non-JSON response from ${url}`, null, res.status);
  }
  // A protected profile check is the auth gate for every business page.
  // Login/register 401 responses must remain on the login form so the user
  // can see the validation error instead of being redirected in a loop.
  if (res.status === 401 && (path === "/auth/me" || !path.startsWith("/auth/"))) {
    csrfToken = null;
    window.dispatchEvent(new CustomEvent("stock-hold:unauthorized"));
  }
  if (envelope.status === "ok") {
    return envelope.data;
  }
  throw new ApiError(
    envelope.error?.code || "API_ERROR",
    envelope.error?.message || "Request failed",
    envelope.error?.detail || null,
    res.status,
  );
}

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  const res = await fetch(`${getBaseUrl()}/auth/session`, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });
  const envelope = await res.json();
  if (!res.ok || envelope.status !== "ok" || !envelope.data?.csrf_token) {
    throw new ApiError("CSRF_SESSION_ERROR", "Unable to establish browser session.", null, res.status);
  }
  csrfToken = envelope.data.csrf_token;
  return csrfToken;
}

function buildUrl(path, query) {
  if (!query) return path;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return qs ? `${path}?${qs}` : path;
}

// Backend list endpoints return `{ items, pagination }`; mock fixtures return
// arrays. Normalize both forms before page modules consume the result.
function listItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

/* ---------- Mock dispatch (no I/O; in-memory fixtures) ---------- */
async function mockDispatch(method, path, body, query) {
  // Simulate small latency for realistic UX.
  await new Promise((r) => setTimeout(r, 80 + Math.random() * 200));

  const key = `${method} ${path}`;
  const handler = MOCK_TABLE[key];
  if (!handler) {
    return {
      status: "error",
      error: { code: "NOT_FOUND_MOCK", message: `No mock for ${key}` },
      meta: { request_id: genId(), ts: nowIso() },
    };
  }
  try {
    const result = await handler({ body, query });
    return {
      status: "ok",
      data: result,
      meta: { request_id: genId(), ts: nowIso() },
    };
  } catch (e) {
    return {
      status: "error",
      error: { code: e.code || "MOCK_ERROR", message: e.message || "Mock failed", detail: e.detail },
      meta: { request_id: genId(), ts: nowIso() },
    };
  }
}

function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "req_" + Math.random().toString(36).slice(2, 12);
}
function nowIso() {
  return new Date().toISOString();
}

/* ---------- Public typed-ish helpers (per resource) ---------- */

/* Accounts */
export const accounts = {
  list: (q) => request("GET", "/accounts", null, { query: q }).then(listItems),
  get:  (id) => request("GET", `/accounts/${id}`, null),
  create: (body) => request("POST", "/accounts/create", body),
  update: (id, body) => request("POST", "/accounts/update", { ...body, id }),
  remove: (id) => request("POST", "/accounts/disable", { id }),
};

/* Authentication */
export const auth = {
  login: (body) => request("POST", "/auth/login", body),
  register: (body) => request("POST", "/auth/register", body),
  logout: () => request("POST", "/auth/logout", {}),
  me: () => request("GET", "/auth/me"),
  updateProfile: (body) => request("POST", "/auth/profile", body),
  session: () => request("GET", "/auth/session"),
};

/* Securities */
export const securities = {
  list: (q) => request("GET", "/securities", null, { query: q }).then(listItems),
  get:  (id) => request("GET", `/securities/${id}`, null),
  create: (body) => request("POST", "/securities/create", body),
  update: (id, body) => request("POST", "/securities/update", { ...body, id }),
  remove: (id) => request("POST", "/securities/disable", { id }),
};

/* Transactions */
export const transactions = {
  list: (q) => request("GET", "/transactions", null, { query: q }).then(listItems),
  get:  (id) => request("GET", `/transactions/${id}`, null),
  create: (body) => request("POST", "/transactions/create", body),
  update: (id, body) => request("POST", "/transactions/update", { ...body, id }),
  remove: (id) => request("POST", "/transactions/delete", { id }),
  batchRemove: (ids) => request("POST", "/transactions/batch-delete", { ids }),
};

/* Holdings */
export const holdings = {
  list: (q) => request("GET", "/holdings", null, { query: q }).then(listItems),
};

/* Dashboard */
export const dashboard = {
  summary:       () => request("GET", "/dashboard/summary"),
  allocation:    () => request("GET", "/dashboard/allocation"),
  recent:        () => request("GET", "/dashboard/recent", null, { query: { limit: 5 } }),
};

/* Reports */
export const reports = {
  realized:    (q) => request("GET", "/reports/realized", null, { query: q }),
  unrealized:  (q) => request("GET", "/reports/unrealized", null, { query: q }),
  dividends:   (q) => request("GET", "/dividends", null, { query: q }).then(listItems),
  taxEstimate: (q) => request("GET", "/reports/tax-estimate", null, { query: q }),
};

/* Maintenance */
// F-02 fix: backup/restore removed from the HTTP API. Use the CLI tools
// (cli/backup.php, cli/restore.php) from the server shell instead.
export const maintenance = {
  reconcile:   (body) => request("POST", "/maintenance/reconcile", body),
  lastPriceUpdate: () => request("GET", "/prices/last-update"),
  refreshPrices:   (body) => request("POST", "/prices/batch-update", body),
};

/* Quote settings */
export const quoteSettings = {
  get:    () => request("GET", "/settings/quotes"),
  update: (body) => request("POST", "/settings/quotes", body),
};

/* FX */
export const fx = {
  refresh: () => request("POST", "/fx/refresh"),
};

/* Skills */
export const skills = {
  list:    () => request("GET", "/skills"),
  run:     (name, body) => request("POST", `/skills/${name}/run`, body),
  toggle:  (name, body) => request("POST", `/skills/${name}/toggle`, body),
};

/* API Token management */
export const apiTokens = {
  list:     () => request("GET", "/api-tokens/me").then(listItems),
  create:   (purpose) => request("POST", "/api-tokens/create", { purpose }),
  revoke:   (id) => request("POST", "/api-tokens/revoke", { id }),
};

/* Schema introspection (Agent use) */
export const schema = {
  get:      () => request("GET", "/schema"),
  entity:   (name) => request("GET", `/schema/${name}`),
};

/* Update check (Settings → Maintenance → 檢查更新)
 *
 * Backend proxies the GitHub Releases API, caches the response for an
 * hour, and compares against STOCK_HOLD_VERSION. Returns:
 *   { status: "ok" | "no_releases" | "error",
 *     current_version, latest_version, has_update,
 *     release_url, published_at, summary, repo, stale, checked_at }
 */
export const updates = {
  check: () => request("GET", "/update"),
};

/* ---------- Low-level escape hatch ---------- */
export function rawRequest(method, path, body, opts) {
  return request(method, path, body, opts);
}

export function isMock() {
  return shouldUseMock();
}
