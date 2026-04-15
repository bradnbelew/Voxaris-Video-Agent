/**
 * POST /api/staffing/conversations
 *
 * Creates a Tavus CVI screening session for a candidate applying to a role.
 *
 * Body (minimum — backward compat with existing staffing-embed.html):
 *   { candidate_name, role, agency_name, language }
 *
 * Body (full — from the new /apply pre-interview form):
 *   {
 *     candidate_name,
 *     role,
 *     agency_name,
 *     // Pre-interview form fields:
 *     email,
 *     phone,
 *     years_experience,        // "0-1" | "1-3" | "3-5" | "5-10" | "10+"
 *     most_recent_employer,
 *     resume_text,             // Plain text extracted client-side with pdf.js
 *     consent_given,           // Must be true — request is rejected otherwise
 *     consent_timestamp        // ISO timestamp from the client
 *   }
 *
 * When resume_text + email + phone arrive, they get injected into the Tavus
 * conversational_context so Jordan opens the interview already knowing who
 * she's talking to and can skip the "what's your name / what's your email"
 * step entirely — going straight into work auth, experience verification,
 * and role-specific questions. The `save_candidate_screening` tool on the
 * persona still captures structured data for the recruiter.
 *
 * Response:
 *   { ok, conversation_id, conversation_url, role, role_details, status }
 */

const https = require("https");
const { config } = require("../../../staffing/config/staffing-config");
const { buildRoleContext } = require("../../../staffing/lib/role-context");
const { putSession } = require("../../../shared/session-store");
const { resolveToken } = require("../../../shared/token-resolver");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function fetchRoleFromDB(roleId, orgId) {
  try {
    const { createClient } = require('@supabase/supabase-js')
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { data: role, error } = await supabase
      .from('roles')
      .select('*')
      .eq('id', roleId)
      .eq('organization_id', orgId)
      .eq('active', true)
      .single()
    if (error || !role) return null
    return role
  } catch (e) {
    console.warn('fetchRoleFromDB failed:', e.message)
    return null
  }
}

function buildRoleContextFromDB(role, candidateName, agencyName) {
  const bqs = Array.isArray(role.behavioral_questions) ? role.behavioral_questions : []
  const mhs = Array.isArray(role.must_haves) ? role.must_haves : []
  const lines = [
    'JOB DETAILS:',
    `- Role: ${role.title}`,
    role.venue_type   ? `- Location/Venue: ${role.venue_type}` : null,
    role.pay_range    ? `- Pay: ${role.pay_range}` : null,
    role.shift        ? `- Schedule: ${role.shift}` : null,
    mhs.length        ? `- Requirements: ${mhs.join(', ')}` : null,
    '',
    bqs.length ? 'BEHAVIORAL QUESTIONS TO ASK (one at a time, after collecting experience and availability):' : null,
    ...bqs.map((q, i) => `${i + 1}. "${q}"`),
    '',
    `Agency Notes: This is a ${agencyName || 'staffing partner'} placement.`,
    `Candidate Name: ${candidateName || 'Unknown'}`,
    'Applied Via: Voxaris VideoAgent intake flow',
  ].filter(l => l !== null)
  return {
    contextString: lines.join('\n'),
    role: {
      title: role.title,
      venue_type: role.venue_type || '',
      pay_range: role.pay_range || 'Competitive',
      shift: role.shift || 'Flexible',
      must_haves: mhs,
    },
  }
}

async function checkPlanLimit(orgId) {
  try {
    const { createClient } = require('@supabase/supabase-js')
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { data: org } = await supabase
      .from('organizations')
      .select('plan, monthly_interview_limit')
      .eq('id', orgId)
      .single()
    if (!org) return { allowed: true }
    const limit = org.monthly_interview_limit || 50
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    const { count } = await supabase
      .from('usage_events')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('event_type', 'interview_created')
      .gte('created_at', monthStart)
    return { allowed: (count || 0) < limit, used: count || 0, limit, plan: org.plan }
  } catch (e) {
    console.warn('checkPlanLimit failed:', e.message)
    return { allowed: true }
  }
}

async function recordUsageEvent(orgId) {
  try {
    const { createClient } = require('@supabase/supabase-js')
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    await supabase.from('usage_events').insert({ organization_id: orgId, event_type: 'interview_created' })
  } catch (e) {
    console.warn('recordUsageEvent failed:', e.message)
  }
}

const TAVUS_HOST = "tavusapi.com";
const MAX_RESUME_CHARS = 12000; // safety cap on resume text injection

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

/**
 * Build a rich candidate profile context block to prepend onto the role
 * context string. Only appends fields that were actually provided.
 */
function buildCandidateBrief(body) {
  const {
    candidate_name,
    email,
    phone,
    years_experience,
    most_recent_employer,
    resume_text,
    consent_given,
    consent_timestamp,
  } = body;

  const parts = ["CANDIDATE PROFILE (captured pre-interview from apply form):"];

  if (candidate_name) parts.push(`Name: ${candidate_name}`);
  if (email) parts.push(`Email: ${email}`);
  if (phone) parts.push(`Phone: ${phone}`);
  if (years_experience) parts.push(`Years of experience: ${years_experience}`);
  if (most_recent_employer)
    parts.push(`Most recent employer: ${most_recent_employer}`);
  if (consent_given === true && consent_timestamp) {
    parts.push(`Consent captured: ${consent_timestamp} (checkbox at apply time)`);
  }

  if (resume_text && typeof resume_text === "string") {
    const truncated = resume_text.slice(0, MAX_RESUME_CHARS);
    parts.push("", "RESUME CONTENT (extracted from PDF, text only):");
    parts.push(truncated);
    if (resume_text.length > MAX_RESUME_CHARS) {
      parts.push(`[TRUNCATED: resume was ${resume_text.length} chars, showing first ${MAX_RESUME_CHARS}]`);
    }
  }

  parts.push(
    "",
    "INSTRUCTIONS FOR JORDAN:",
    "- You already have the candidate's name, email, phone, and resume above. Do NOT re-ask for them.",
    "- Use the resume content to personalize the interview — reference specific roles, certifications, or accomplishments you see on it.",
    "- Proceed directly from the disclosure + consent step into work authorization and experience verification.",
    "- When you confirm structured data in conversation, call the `save_candidate_screening` tool to log it for the recruiter."
  );

  return parts.join("\n");
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
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
    const {
      candidate_name = "there",
      role = "general",
      agency_name = "our staffing team",
      client_token,        // ← new: client token from ?client= URL param
    } = body;

    const roleParam = body.role
      || new URL(req.url, 'http://localhost').searchParams.get('role')
      || 'general'

    const {
      // Pre-interview form fields (optional for legacy flows)
      email,
      phone,
      years_experience,
      most_recent_employer,
      resume_text,
      consent_given,
      consent_timestamp,
      bipa_consent,
      bipa_consent_timestamp,
    } = body;

    // ── Resolve org from client token ───────────────────────────────
    // client_token comes from ?client=tk_xxx in the interview URL.
    // Falls back to DASHBOARD_ORG_ID env var for legacy deployments.
    const orgId = await resolveToken(client_token || null);
    if (!orgId) {
      res.status(400).json({
        ok: false,
        error: "Invalid or missing client token. Use ?client=your_token in the interview URL.",
      });
      return;
    }

    // ── EU AI Act block ─────────────────────────────────────────────
    // Art. 5(1)(f) bans emotion recognition in the workplace. Raven-1
    // perception on Jordan does exactly that, so we block EU users
    // entirely and surface a clear message. The country header is set
    // by Vercel Edge / Cloudflare.
    const EU_COUNTRIES = new Set([
      "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR",
      "HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK",
      "SI","ES","SE","IS","LI","NO",
    ]);
    const ipCountry = (
      req.headers["x-vercel-ip-country"] ||
      req.headers["cf-ipcountry"] ||
      ""
    ).toUpperCase();
    if (ipCountry && EU_COUNTRIES.has(ipCountry)) {
      res.status(451).json({
        ok: false,
        error:
          "This AI video interview is not available in your region. EU AI Act Article 5(1)(f) prohibits emotion recognition in the workplace. Please contact accommodations@voxaris.io for a human-led alternative.",
        country: ipCountry,
      });
      return;
    }

    // ── Consent gates ───────────────────────────────────────────────
    // If the request came from the /apply pre-interview form, BOTH
    // general consent AND biometric consent MUST be explicitly true.
    const cameFromApplyForm = !!(email || phone || resume_text);
    if (cameFromApplyForm && consent_given !== true) {
      res.status(400).json({
        ok: false,
        error:
          "Consent required. The apply form must submit consent_given=true and a consent_timestamp before an interview can start.",
      });
      return;
    }
    // BIPA gate — required whenever bipa_consent field is present
    // (i.e. the new apply form sent it). Without this, Raven-1
    // perception runs against an unconsented candidate = lawsuit.
    if (cameFromApplyForm && bipa_consent !== true) {
      res.status(400).json({
        ok: false,
        error:
          "Biometric consent required. Illinois BIPA (740 ILCS 14) and Maryland HB 1202 require explicit consent before facial/voice analysis. Check the biometric consent box on the apply form.",
      });
      return;
    }

    const baseUrl =
      process.env.STAFFING_BASE_URL ||
      `https://${req.headers["x-forwarded-host"] || req.headers.host || "localhost"}`;
    const callbackUrl = `${baseUrl}/api/staffing/tools`;

    let roleContext, roleData
    if (UUID_RE.test(roleParam) && orgId) {
      const dbRole = await fetchRoleFromDB(roleParam, orgId)
      if (dbRole) {
        ;({ contextString: roleContext, role: roleData } = buildRoleContextFromDB(dbRole, candidate_name, agency_name))
        // Increment interview count async — fire and forget
        try {
          const { createClient } = require('@supabase/supabase-js')
          const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
          sb.from('roles').update({ interview_count: dbRole.interview_count + 1 }).eq('id', roleParam).then(() => {})
        } catch {}
      } else {
        ;({ contextString: roleContext, role: roleData } = buildRoleContext('general', candidate_name, agency_name))
      }
    } else {
      ;({ contextString: roleContext, role: roleData } = buildRoleContext(roleParam, candidate_name, agency_name))
    }

    // Build the candidate brief first so it appears at the top of the
    // conversational_context — Jordan reads top-down and the candidate
    // profile should be the first thing she encounters.
    const candidateBrief = cameFromApplyForm
      ? buildCandidateBrief({
          candidate_name,
          email,
          phone,
          years_experience,
          most_recent_employer,
          resume_text,
          consent_given,
          consent_timestamp,
        })
      : null;

    const fullContext = candidateBrief
      ? `${candidateBrief}\n\n---\n\n${roleContext}`
      : roleContext;

    const greeting = `Hey ${candidate_name}! Thanks so much for taking the time — I'm Jordan, and I'll be doing your pre-screening today for the ${roleData.title} role with ${agency_name}. This should take about 10 minutes and it's really just a conversation, so feel free to be yourself. Sound good?`;

    const planCheck = await checkPlanLimit(orgId)
    if (!planCheck.allowed) {
      return res.status(429).json({
        ok: false,
        error: `Monthly interview limit reached (${planCheck.used}/${planCheck.limit} on ${planCheck.plan} plan). Contact support to upgrade.`,
        upgrade_url: 'https://voxaris.io/upgrade',
      })
    }

    const tavusBody = {
      persona_id: config.personaId,
      replica_id: config.replicaId,
      conversation_name: `Jordan Screen – ${candidate_name} – ${roleData.title}`,
      custom_greeting: greeting,
      conversational_context: fullContext,
      callback_url: callbackUrl,
      // Tavus 2026 security upgrade — require_auth makes the WebRTC room
      // private and returns a short-lived meeting_token the client must
      // append to the URL. Without this, the conversation_url is a public
      // gateway and anyone with the link can join the live candidate session.
      require_auth: true,
      properties: { ...config.conversationDefaults },
    };

    const tavus = await tavusCreate(tavusBody);
    const conversationId = tavus.conversation_id;
    // With require_auth: true, Tavus returns conversation_url + meeting_token
    // separately. Daily.js `join()` expects them as separate params
    // ({ url, token }), NOT concatenated as a query string — passing
    // `https://room?t=TOKEN` to Daily fails silently and the join errors
    // out. We therefore return them as two fields and let the client pass
    // them through cleanly.
    const conversationUrl = tavus.conversation_url;
    const meetingToken = tavus.meeting_token || null;

    recordUsageEvent(orgId).catch(() => {})

    const seed = {
      conversation_id: conversationId,
      vertical: "staffing",
      organization_id: orgId,
      candidate_name,
      applied_role: roleData.title,
      role_key: role,
      role_id: UUID_RE.test(roleParam) ? roleParam : null,
      agency_name,
      // Pre-interview capture:
      email: email || null,
      phone: phone || null,
      years_experience: years_experience || null,
      most_recent_employer: most_recent_employer || null,
      consent_given: consent_given === true,
      consent_timestamp: consent_timestamp || null,
      resume_uploaded: !!(resume_text && resume_text.length > 0),
      resume_length: resume_text ? resume_text.length : 0,
      bipa_consent: bipa_consent === true,
      bipa_consent_timestamp: bipa_consent_timestamp || null,
      came_from_apply_form: cameFromApplyForm,
      started_at: new Date().toISOString(),
      objectives_completed: [],
    };
    try {
      await putSession(conversationId, seed);
    } catch (e) {
      console.warn("putSession seed failed:", e.message);
    }

    // Notify recruiter dashboard of new interview
    try {
      const { triggerDashboard } = require("../../../shared/dashboard-trigger");
      triggerDashboard("interview_started", conversationId, {
        candidate_name,
        candidate_email: email || null,
        candidate_phone: phone || null,
        applied_role: roleData.title,
        resume_text: resume_text || null,
        years_experience: years_experience || null,
        most_recent_employer: most_recent_employer || null,
        consent_given: consent_given === true,
        consent_timestamp: consent_timestamp || null,
        source: "video_interview",
      }, orgId); // ← pass resolved orgId
    } catch (e) {
      console.warn("dashboard trigger failed:", e.message);
    }

    res.status(200).json({
      ok: true,
      conversation_id: conversationId,
      conversation_url: conversationUrl,
      meeting_token: meetingToken,
      role: roleData.title,
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
      pre_interview_captured: cameFromApplyForm,
      status: tavus.status || "created",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, body: e.body });
  }
};
