/**
 * POST /api/realty/setup
 *
 * One-time Aria persona creation. Run once after first deploy, copy the
 * returned persona_id into TAVUS_REALTY_PERSONA_ID env var, then redeploy.
 *
 * Response: { ok, persona_id, persona_name }
 */

const { createPersona } = require("../../../shared/tavus-client");
const { config } = require("../../../realty/config/realty-config");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.TAVUS_API_KEY) {
    res.status(500).json({ error: "TAVUS_API_KEY not set" });
    return;
  }
  if (!process.env.TAVUS_REALTY_REPLICA_ID) {
    res
      .status(500)
      .json({ error: "TAVUS_REALTY_REPLICA_ID not set — pick one from the Tavus replica gallery first" });
    return;
  }

  try {
    const payload = config.buildPersonaPayload();
    const persona = await createPersona(payload);
    res.status(200).json({
      ok: true,
      persona_id: persona.persona_id || persona.id,
      persona_name: persona.persona_name || payload.persona_name,
      hint: "Save persona_id to TAVUS_REALTY_PERSONA_ID in Vercel env vars, then redeploy.",
      raw: persona,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, body: e.body });
  }
};
