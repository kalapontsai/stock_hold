/**
 * stock_hold — Mock: Accounts
 *
 * Per SPEC §1.1 entity `accounts` (id, type, name, currency, broker, account_no, status).
 */

const ACCOUNTS = [
  {
    id: "acc-bank-ctbc",
    type: "BANK",
    name: "中信活存",
    currency: "TWD",
    broker: null,
    account_no: "****1234",
    status: "active",
    balance: "523400",
    created_at: "2025-04-12T08:30:00Z",
  },
  {
    id: "acc-bank-sinopac",
    type: "BANK",
    name: "永豐活存",
    currency: "TWD",
    broker: null,
    account_no: "****5678",
    status: "active",
    balance: "180000",
    created_at: "2025-05-03T08:30:00Z",
  },
  {
    id: "acc-broker-firstsec",
    type: "BROKER",
    name: "FirstSec 美股",
    currency: "USD",
    broker: "Firstrade",
    account_no: "****9012",
    status: "active",
    balance: "3200",
    created_at: "2025-06-21T08:30:00Z",
  },
  {
    id: "acc-broker-sinopac",
    type: "BROKER",
    name: "永豐台股",
    currency: "TWD",
    broker: "永豐金",
    account_no: "****3456",
    status: "active",
    balance: "0",
    created_at: "2025-06-21T08:30:00Z",
  },
  {
    id: "acc-bank-disabled",
    type: "BANK",
    name: "舊帳戶",
    currency: "TWD",
    broker: null,
    account_no: "****0000",
    status: "disabled",
    balance: "0",
    created_at: "2025-01-01T08:30:00Z",
  },
];

export async function listAccounts() {
  return [...ACCOUNTS];
}

export async function getAccount({ body, query } = {}) {
  // not used in current router; here for completeness
  return ACCOUNTS[0];
}

export async function createAccount({ body } = {}) {
  const account = {
    id: `acc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: body.type || "BANK",
    name: body.name,
    currency: body.currency || "TWD",
    broker: body.broker || null,
    account_no: body.account_no || null,
    status: "active",
    balance: "0",
    created_at: new Date().toISOString(),
  };
  ACCOUNTS.push(account);
  return { ...account };
}

export async function updateAccount({ body } = {}) {
  const account = ACCOUNTS.find((item) => item.id === body.id);
  if (!account) throw new Error("帳戶不存在");
  Object.assign(account, body);
  return { ...account };
}

export async function deleteAccount({ body } = {}) {
  const account = ACCOUNTS.find((item) => item.id === body.id);
  if (!account) throw new Error("帳戶不存在");
  account.status = "disabled";
  return { id: account.id, deleted: true, status: account.status };
}
