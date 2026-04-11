/**
 * GET /health → /api/health
 * Quick readiness probe — confirms which env vars are wired up.
 */

module.exports = (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "voxaris-videoagent",
    verticals: ["realty", "staffing"],
    timestamp: new Date().toISOString(),
    env: {
      tavus_api_key: !!process.env.TAVUS_API_KEY,
      tavus_realty: !!(
        process.env.TAVUS_REALTY_PERSONA_ID &&
        process.env.TAVUS_REALTY_REPLICA_ID
      ),
      tavus_staffing: !!(
        process.env.TAVUS_STAFFING_PERSONA_ID &&
        process.env.TAVUS_STAFFING_REPLICA_ID
      ),
      google_sheets: !!(
        process.env.GOOGLE_SHEET_ID &&
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
        process.env.GOOGLE_PRIVATE_KEY
      ),
      simplyrets: !!(
        process.env.SIMPLYRETS_API_KEY && process.env.SIMPLYRETS_API_SECRET
      ),
      n8n_tour: !!process.env.N8N_TOUR_BOOKING_WEBHOOK,
      n8n_interview: !!process.env.N8N_INTERVIEW_WEBHOOK,
      realty_persona_patched: false,
      patch_endpoints: true,
    },
  });
};
