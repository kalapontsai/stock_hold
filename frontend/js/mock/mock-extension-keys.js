/**
 * stock_hold — Mock: Extension API Keys
 *
 * Mirrors the per-user encrypted storage for external provider credentials
 * (e.g. Fubon Neo API key). Real backend stores AES-256-CBC ciphertext +
 * IV; the mock just keeps an in-memory list so the UI can be exercised
 * without a live API. The plaintext is NEVER returned through the API
 * surface — same contract as the real endpoint.
 */

const EXTENSION_KEYS = [];

export async function listExtensionKeys() {
  return [...EXTENSION_KEYS].map((k) => ({
    id: k.id,
    provider: k.provider,
    key_prefix: k.key_prefix,
    created_at: k.created_at,
    updated_at: k.updated_at,
  }));
}

export async function upsertExtensionKey({ body } = {}) {
  const provider = String(body?.provider || "");
  const plain = String(body?.key || "");
  if (!provider || !plain) {
    const err = new Error("provider and key are required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const idx = EXTENSION_KEYS.findIndex((k) => k.provider === provider);
  const now = new Date().toISOString();
  const prefix = plain.slice(0, 8);
  if (idx === -1) {
    const row = {
      id: EXTENSION_KEYS.length + 1,
      provider,
      key_prefix: prefix,
      created_at: now,
      updated_at: now,
    };
    EXTENSION_KEYS.push(row);
    return { ...row };
  }
  EXTENSION_KEYS[idx] = {
    ...EXTENSION_KEYS[idx],
    key_prefix: prefix,
    updated_at: now,
  };
  return { ...EXTENSION_KEYS[idx] };
}

export async function deleteExtensionKey({ body } = {}) {
  const provider = String(body?.provider || "");
  const idx = EXTENSION_KEYS.findIndex((k) => k.provider === provider);
  if (idx === -1) {
    const err = new Error("No extension key for this provider.");
    err.code = "NOT_FOUND";
    throw err;
  }
  EXTENSION_KEYS.splice(idx, 1);
  return { provider, deleted: true };
}