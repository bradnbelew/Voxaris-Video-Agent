/**
 * Token resolver — looks up a client token in Supabase and returns the org_id.
 *
 * Client tokens are passed as ?client=tk_xxx in the interview URL.
 * Each token maps to exactly one organization in the dashboard.
 *
 * Falls back to DASHBOARD_ORG_ID env var if no token is provided,
 * so existing single-tenant deployments keep working unchanged.
 */

const https = require("https");

/**
 * Resolve a client token string to an organization_id.
 *
 * @param {string|null} token — value from ?client= query param
 * @returns {Promise<string|null>} — organization_id or null if not found/inactive
 */
async function resolveToken(token) {
  // No token provided — fall back to env var (legacy single-tenant mode)
  if (!token) {
    const fallback = process.env.DASHBOARD_ORG_ID || null;
    if (fallback) {
      console.log("[token-resolver] No token, using DASHBOARD_ORG_ID fallback");
    } else {
      console.warn("[token-resolver] No token and no DASHBOARD_ORG_ID set");
    }
    return fallback;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("[token-resolver] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
    return process.env.DASHBOARD_ORG_ID || null;
  }

  try {
    const url = new URL(
      `/rest/v1/client_tokens?token=eq.${encodeURIComponent(token)}&active=eq.true&select=organization_id`,
      supabaseUrl
    );

    const orgId = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: url.hostname,
          path: url.pathname + url.search,
          method: "GET",
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            Accept: "application/json",
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            try {
              const data = JSON.parse(raw);
              if (Array.isArray(data) && data.length > 0) {
                resolve(data[0].organization_id);
              } else {
                resolve(null);
              }
            } catch {
              resolve(null);
            }
          });
        }
      );
      req.on("error", reject);
      req.end();
    });

    if (!orgId) {
      console.warn(`[token-resolver] Token not found or inactive: ${token}`);
    } else {
      console.log(`[token-resolver] Token ${token} resolved to org ${orgId}`);
    }

    return orgId;
  } catch (err) {
    console.error("[token-resolver] Lookup failed:", err.message);
    return process.env.DASHBOARD_ORG_ID || null;
  }
}

module.exports = { resolveToken };
