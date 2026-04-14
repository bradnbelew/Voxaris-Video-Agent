/**
 * Dashboard webhook trigger — fire-and-forget POST to the Voxaris recruiter dashboard.
 * Pattern mirrors n8n-trigger.js — never throws, caller can fire without try/catch.
 *
 * org_id is now passed explicitly per-request (resolved from client token)
 * rather than read from DASHBOARD_ORG_ID env var. Falls back to env var
 * for backward compatibility with legacy single-tenant deployments.
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");

const DASHBOARD_URL = process.env.DASHBOARD_WEBHOOK_URL;
const DASHBOARD_SECRET = process.env.DASHBOARD_WEBHOOK_SECRET;

/**
 * @param {string} eventType — "interview_started" | "objective_completed" | "conversation_ended" | "guardrail_triggered"
 * @param {string} conversationId
 * @param {object} data — event-specific payload
 * @param {string|null} orgId — organization_id resolved from client token (or null to fall back to env)
 */
async function triggerDashboard(eventType, conversationId, data, orgId = null) {
  if (!DASHBOARD_URL) {
    return { ok: false, error: "DASHBOARD_WEBHOOK_URL not configured" };
  }

  // Use passed orgId first, fall back to env var for legacy deployments
  const organizationId = orgId || process.env.DASHBOARD_ORG_ID || null;

  if (!organizationId) {
    return { ok: false, error: "No organization_id — set DASHBOARD_ORG_ID or pass a client token" };
  }

  let parsed;
  try {
    parsed = new URL(DASHBOARD_URL);
  } catch (e) {
    return { ok: false, error: `Invalid dashboard URL: ${e.message}` };
  }

  const body = JSON.stringify({
    organization_id: organizationId,
    conversation_id: conversationId,
    event_type: eventType,
    data: data || {},
  });

  const isHttps = parsed.protocol === "https:";
  const lib = isHttps ? https : http;

  const options = {
    host: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: `${parsed.pathname}${parsed.search || ""}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "x-webhook-secret": DASHBOARD_SECRET || "",
      Accept: "application/json",
    },
  };

  return new Promise((resolve) => {
    const req = lib.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) {
          resolve({ ok: true, status });
        } else {
          console.warn(`[dashboard-trigger] ${eventType} returned ${status}: ${raw}`);
          resolve({ ok: false, status, error: raw });
        }
      });
    });
    req.on("error", (err) => {
      console.warn(`[dashboard-trigger] ${eventType} failed: ${err.message}`);
      resolve({ ok: false, error: err.message });
    });
    req.write(body);
    req.end();
  });
}

module.exports = { triggerDashboard };
