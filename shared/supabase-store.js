/**
 * Supabase REST client (PostgREST) — zero-dependency.
 *
 * Uses the service-role key so RLS is bypassed. This module is the raw
 * data layer; retry logic, DLQ, and fallback live in session-store.js.
 *
 * Tables (see supabase/schema.sql):
 *   sessions    — per-conversation state blobs (JSONB)
 *   webhook_dlq — dead-letter queue for failed webhook processing
 *
 * Required env vars:
 *   SUPABASE_URL                — e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — service role secret (NOT anon key)
 */

const https = require("https");

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "Supabase not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required"
    );
  const parsed = new URL(url);
  return { host: parsed.host, basePath: "/rest/v1", key };
}

function request(method, path, body, headers = {}) {
  const { host, basePath, key } = getConfig();
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const allHeaders = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    };
    if (payload) allHeaders["Content-Length"] = Buffer.byteLength(payload);

    const req = https.request(
      { host, path: `${basePath}${path}`, method, headers: allHeaders },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          const status = res.statusCode || 0;
          if (status >= 200 && status < 300) {
            if (!raw || raw.trim() === "") return resolve(null);
            try {
              resolve(JSON.parse(raw));
            } catch {
              resolve({ raw });
            }
          } else {
            const err = new Error(
              `Supabase ${method} ${path} failed ${status}: ${raw || "<empty>"}`
            );
            err.status = status;
            try {
              err.body = JSON.parse(raw);
            } catch {
              err.body = raw;
            }
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Upsert a session. PostgREST upsert uses `Prefer: resolution=merge-duplicates`
 * with the table's PK constraint. Merges JSONB data into the existing row.
 */
async function putSession(conversationId, data) {
  if (!conversationId) throw new Error("putSession: conversationId required");
  const row = {
    conversation_id: conversationId,
    vertical: data.vertical || "unknown",
    data: data,
    updated_at: new Date().toISOString(),
  };
  return request("POST", "/sessions", row, {
    Prefer: "resolution=merge-duplicates,return=minimal",
  });
}

/**
 * Get a session by conversation_id. Returns parsed data blob or null.
 */
async function getSession(conversationId) {
  if (!conversationId) throw new Error("getSession: conversationId required");
  const path = `/sessions?conversation_id=eq.${encodeURIComponent(conversationId)}&select=data`;
  const rows = await request("GET", path);
  if (Array.isArray(rows) && rows.length > 0 && rows[0].data) {
    return rows[0].data;
  }
  return null;
}

/**
 * Push a failed webhook payload to the dead-letter queue.
 */
async function pushDlq(conversationId, vertical, eventType, payload, errorMessage) {
  return request("POST", "/webhook_dlq", {
    conversation_id: conversationId || null,
    vertical: vertical || "unknown",
    event_type: eventType || "unknown",
    payload: payload,
    error_message: errorMessage || null,
    attempts: 1,
    created_at: new Date().toISOString(),
  });
}

/**
 * Check if Supabase is configured. Used by session-store to decide backend.
 */
function isConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

module.exports = { putSession, getSession, pushDlq, isConfigured };
