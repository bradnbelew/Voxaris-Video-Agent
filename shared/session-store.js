/**
 * Unified session store facade — auto-selects Supabase or Google Sheets.
 *
 * Backend selection:
 *   - If SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set → Supabase
 *   - Else → Google Sheets (legacy, for dev/demo without a DB)
 *
 * Features on top of the raw store:
 *   - Automatic 3× retry with exponential backoff (500ms, 1.5s, 3.5s)
 *   - Dead-letter queue for permanently-failed writes (Supabase only)
 *   - Same interface as google-sheets.js so all callers do a one-line swap
 *
 * Exports:
 *   putSession(conversationId, data)  — upsert session (with retry)
 *   getSession(conversationId)         — read session (with retry)
 *   appendRow(tabName, values)         — passthrough to Sheets (for logs)
 *   getAccessToken()                   — passthrough to Sheets (for logs)
 *   withRetry(fn)                      — utility for callers that need it
 *   pushDlq(conversationId, vertical, eventType, payload, error) — DLQ
 */

const supabase = require("./supabase-store");
const sheets = require("./google-sheets");

const USE_SUPABASE = supabase.isConfigured();

const MAX_RETRIES = 3;
const BACKOFF_MS = [500, 1500, 3500];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retry a function up to MAX_RETRIES times with exponential backoff.
 * On final failure, rejects with the last error.
 */
async function withRetry(fn, label = "op") {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      // Don't retry client errors (4xx) — they won't succeed on retry.
      if (e.status && e.status >= 400 && e.status < 500) throw e;
      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_MS[attempt] || 3500;
        console.warn(
          `[session-store] ${label} attempt ${attempt + 1} failed: ${e.message}. Retrying in ${delay}ms`
        );
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Upsert session with retry. On permanent failure when using Supabase,
 * pushes the data to the DLQ so it's not lost.
 */
async function putSession(conversationId, data) {
  const backend = USE_SUPABASE ? supabase : sheets;
  try {
    return await withRetry(
      () => backend.putSession(conversationId, data),
      `putSession(${conversationId})`
    );
  } catch (e) {
    // DLQ — only available when Supabase is the backend.
    if (USE_SUPABASE) {
      try {
        await supabase.pushDlq(
          conversationId,
          data.vertical || "unknown",
          "putSession_failed",
          data,
          e.message
        );
        console.error(
          `[session-store] putSession(${conversationId}) failed after ${MAX_RETRIES} retries — pushed to DLQ:`,
          e.message
        );
      } catch (dlqErr) {
        console.error(
          `[session-store] putSession + DLQ both failed for ${conversationId}:`,
          e.message,
          dlqErr.message
        );
      }
    } else {
      console.error(
        `[session-store] putSession(${conversationId}) failed after ${MAX_RETRIES} retries (no DLQ available):`,
        e.message
      );
    }
    // Re-throw so the caller can decide how to handle it
    throw e;
  }
}

/**
 * Read session with retry. No DLQ here — reads are idempotent.
 */
async function getSession(conversationId) {
  const backend = USE_SUPABASE ? supabase : sheets;
  return withRetry(
    () => backend.getSession(conversationId),
    `getSession(${conversationId})`
  );
}

/**
 * Push to dead-letter queue directly (for webhook handlers that want
 * explicit DLQ control). No-op if Supabase is not configured.
 */
async function pushDlq(conversationId, vertical, eventType, payload, errorMessage) {
  if (!USE_SUPABASE) {
    console.warn("[session-store] pushDlq called but Supabase not configured — dropped");
    return;
  }
  return supabase.pushDlq(conversationId, vertical, eventType, payload, errorMessage);
}

// Passthrough to Sheets for log-specific callers (sheets-logger.js).
// These still hit Sheets even when Supabase is the primary session store
// because the log tabs (Realty Sessions, Staffing Sessions) are the
// recruiter/broker-facing dashboards.
const { appendRow, getAccessToken } = sheets;

module.exports = {
  putSession,
  getSession,
  pushDlq,
  withRetry,
  appendRow,
  getAccessToken,
  USE_SUPABASE,
};
