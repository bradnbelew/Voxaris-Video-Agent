/**
 * Staffing session logger.
 *
 * Appends a completed candidate interview to the "Staffing Interviews" tab.
 * Column layout (keep in sync with README setup step):
 *   Timestamp | Source | Full Name | Email | Phone | Role |
 *   Work Authorized | Years Exp | Skills | Shift Pref |
 *   Start Date | Profile Summary | Disqualified |
 *   Recruiter Call | Callback Time | Conversation ID | Status
 */

const { appendRow } = require("../../shared/google-sheets");

function boolToYesNo(v) {
  if (v === true || v === "true" || v === "yes" || v === "Yes") return "Yes";
  if (v === false || v === "false" || v === "no" || v === "No") return "No";
  return "";
}

async function logStaffingSession(session) {
  if (!session) return { ok: false, error: "no session" };
  const timestamp = new Date().toISOString();

  const shiftPref = [];
  if (session.available_evenings === true || session.available_evenings === "true")
    shiftPref.push("evenings");
  if (session.available_weekends === true || session.available_weekends === "true")
    shiftPref.push("weekends");
  const shiftText = shiftPref.length ? shiftPref.join("+") : "days";

  const skills = Array.isArray(session.skills)
    ? session.skills.join(", ")
    : session.skills || session.certification_name || "";

  const disqualified =
    session.disqualified === true || session.work_authorized === false;

  const row = [
    timestamp,
    "Video Interview",
    session.full_name || session.candidate_name || "",
    session.email || "",
    session.phone || "",
    session.applied_role || session.role || "",
    boolToYesNo(session.work_authorized),
    session.years_experience || "",
    skills,
    shiftText,
    session.earliest_start_date || "",
    session.profile_summary ||
      `Candidate: ${session.full_name || ""}. Experience: ${session.years_experience || "?"} yrs at ${session.venue_type || "?"}.`,
    disqualified ? "Yes" : "No",
    session.recruiter_call_scheduled ? "Yes" : "No",
    session.preferred_callback_time || "",
    session.conversation_id || "",
    disqualified ? "Disqualified" : "Pending — recruiter review",
  ];

  try {
    await appendRow("Staffing Interviews", row);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { logStaffingSession };
