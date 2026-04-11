/**
 * Realty session logger.
 *
 * Appends a completed buyer session to the "Realty Sessions" tab.
 * Column layout (keep in sync with README setup step):
 *   Timestamp | Source | Buyer Name | Email | Phone | Listing ID |
 *   Interest Level | Top Priorities | Tour Booked | Preferred Date |
 *   Preferred Time | Visit Type | Main Concern | Conversation ID | Status
 */

const { appendRow } = require("../../shared/google-sheets");

async function logRealtySession(session) {
  if (!session) return { ok: false, error: "no session" };
  const timestamp = new Date().toISOString();
  const priorities = [
    session.top_priority_1,
    session.top_priority_2,
  ]
    .filter(Boolean)
    .join("; ");

  const tourBooked =
    session.preferred_date || session.preferred_time || session.visit_type
      ? "Yes"
      : "No";

  const row = [
    timestamp,
    "Virtual Showing",
    session.full_name || session.visitor_name || "",
    session.email || "",
    session.phone || "",
    session.listing_id || "",
    session.interest_level || "",
    priorities,
    tourBooked,
    session.preferred_date || "",
    session.preferred_time || "",
    session.visit_type || "",
    session.main_concern || "",
    session.conversation_id || "",
    "Pending — follow up",
  ];

  try {
    await appendRow("Realty Sessions", row);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { logRealtySession };
