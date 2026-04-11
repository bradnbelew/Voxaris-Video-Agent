/**
 * POST /api/staffing/conversations
 *
 * Creates a Tavus CVI screening session for a candidate applying to a role.
 * Body: { candidate_name, role, agency_name, language }
 * Response: { conversation_id, conversation_url, role, status }
 */

const https = require("https");
const { config } = require("../../../staffing/config/staffing-config");
const { buildRoleContext } = require("../../../staffing/lib/role-context");
const { putSession } = require("../../../shared/google-sheets");

const TAVUS_HOST = "tavusapi.com";

function tavusCreate(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        host: TAVUS_HOST,
        path: "/v2/conversations",
        method: "POST",
        headers: {
          "x-api-key": process.env.TAVUS_API_KEY || "",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Accept: "application/json",
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          const status = res.statusCode || 0;
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = { raw };
          }
          if (status >= 200 && status < 300) resolve(parsed);
          else {
            const err = new Error(`Tavus create conversation ${status}: ${raw}`);
            err.status = status;
            err.body = parsed;
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!config.apiKey || !config.personaId || !config.replicaId) {
    res.status(500).json({
      error: "Staffing vertical not configured",
      missing: {
        TAVUS_API_KEY: !config.apiKey,
        TAVUS_STAFFING_PERSONA_ID: !config.personaId,
        TAVUS_STAFFING_REPLICA_ID: !config.replicaId,
      },
    });
    return;
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const {
      candidate_name = "there",
      role = "general",
      agency_name = "our staffing team",
    } = body;

    const baseUrl =
      process.env.STAFFING_BASE_URL ||
      `https://${req.headers["x-forwarded-host"] || req.headers.host || "localhost"}`;
    const callbackUrl = `${baseUrl}/api/staffing/tools`;

    const { contextString, role: roleData } = buildRoleContext(
      role,
      candidate_name,
      agency_name
    );

    const greeting = `Hey ${candidate_name}! Thanks so much for taking the time — I'm Jordan, and I'll be doing your pre-screening today for the ${roleData.title} role with ${agency_name}. This should take about 10 minutes and it's really just a conversation, so feel free to be yourself. Sound good?`;

    // See note in api/realty/conversations — Tavus /v2 does not accept
    // conversation_rules at conversation creation time. Objectives live on
    // the persona.
    const tavusBody = {
      persona_id: config.personaId,
      replica_id: config.replicaId,
      conversation_name: `Jordan Screen – ${candidate_name} – ${roleData.title}`,
      custom_greeting: greeting,
      conversational_context: contextString,
      callback_url: callbackUrl,
      properties: { ...config.conversationDefaults },
    };

    const tavus = await tavusCreate(tavusBody);
    const conversationId = tavus.conversation_id;
    const conversationUrl = tavus.conversation_url;

    const seed = {
      conversation_id: conversationId,
      vertical: "staffing",
      candidate_name,
      applied_role: roleData.title,
      role_key: role,
      agency_name,
      started_at: new Date().toISOString(),
      objectives_completed: [],
    };
    try {
      await putSession(conversationId, seed);
    } catch (e) {
      console.warn("putSession seed failed:", e.message);
    }

    res.status(200).json({
      ok: true,
      conversation_id: conversationId,
      conversation_url: conversationUrl,
      role: roleData.title, // string — backward compat
      role_details: {
        key: role,
        title: roleData.title,
        venue_type: roleData.venue_type,
        pay_range: roleData.pay_range,
        shift: roleData.shift,
        must_haves: roleData.must_haves,
      },
      candidate_name,
      agency_name,
      status: tavus.status || "created",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, body: e.body });
  }
};
