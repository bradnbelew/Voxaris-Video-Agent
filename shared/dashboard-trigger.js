/**
 * Dashboard webhook trigger — fire-and-forget POST to the Voxaris recruiter dashboard.
 * Pattern mirrors n8n-trigger.js — never throws, caller can fire without try/catch.
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");

const DASHBOARD_URL = process.env.DASHBOARD_WEBHOOK_URL;
const DASHBOARD_SECRET = process.env.DASHBOARD_WEBHOOK_SECRET;
const ORG_ID = process.env.DASHBOARD_ORG_ID;

/**
 * @param {string} eventType — "interview_started" | "objective_completed" | "conversation_ended" | "guardrail_triggered"
 * @param {string} conversationId
 * @param {object} data — event-specific payload
 */
async function triggerDashboard(eventType, conversationId, data) {
  if (!DASHBOARD_URL) {
    return { ok: false, error: "DASHBOARD_WEBHOOK_URL not configured" };
  }
  if (!ORG_ID) {
    return { ok: false, error: "DASHBOARD_ORG_ID not configured" };
  }

  let parsed;
  try {
    parsed = new URL(DASHBOARD_URL);
  } catch (e) {
    return { ok: false, error: `Invalid dashboard URL: ${e.message}` };
  }

  const body = JSON.stringify({
    organization_id: ORG_ID,
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
