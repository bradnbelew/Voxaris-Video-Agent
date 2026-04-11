/**
 * Staffing role context builder.
 *
 * Injects role-specific details, behavioral questions, and must-have
 * requirements into the conversational_context at session creation.
 * Expand ROLE_CONTEXTS as new verticals come online.
 */

const ROLE_CONTEXTS = {
  warehouse: {
    title: "Warehouse Associate",
    venue_type: "Logistics / distribution center",
    pay_range: "$17–$21/hr depending on experience",
    shift: "Flexible — days, evenings, or nights",
    behavioral_questions: [
      "Tell me about a time you had to work quickly under pressure to meet a deadline.",
      "Describe a situation where you had to follow strict safety protocols. What did you do?",
    ],
    must_haves: [
      "Physical ability to lift 50 lbs repeatedly",
      "Steel-toe boots",
      "Reliable transportation",
      "Valid US work authorization",
    ],
  },
  hospitality: {
    title: "Hotel / Banquet Server",
    venue_type: "Hotel and event venues (Marriott, Hyatt, Hilton partners)",
    pay_range: "$18–$21/hr depending on experience + gratuity",
    shift: "Variable banquet schedule, primarily evenings and weekends",
    behavioral_questions: [
      "Tell me about a time you dealt with a difficult guest or customer. How did you handle it?",
      "Describe a situation where you had to work as part of a team under a tight deadline.",
    ],
    must_haves: [
      "Minimum 1 year food and beverage experience",
      "Ability to stand 8+ hours",
      "Ability to lift up to 30 lbs",
      "Valid US work authorization",
      "TIPS/ServSafe certification preferred",
    ],
  },
  healthcare_admin: {
    title: "Medical Administrative Assistant",
    venue_type: "Outpatient clinic or medical office",
    pay_range: "$18–$22/hr depending on experience",
    shift: "Weekdays, primarily day shift",
    behavioral_questions: [
      "Tell me about your experience with medical scheduling or insurance verification.",
      "Describe how you handle confidential patient information.",
    ],
    must_haves: [
      "EHR experience preferred",
      "HIPAA awareness",
      "Strong phone etiquette",
      "Valid US work authorization",
    ],
  },
  general: {
    title: "General Labor / Light Industrial",
    venue_type: "Light industrial site",
    pay_range: "$15–$19/hr depending on experience",
    shift: "Days, evenings, or weekends as needed",
    behavioral_questions: [
      "Tell me about a time you had to learn a new skill quickly on the job.",
      "How do you handle repetitive tasks while maintaining quality and focus?",
    ],
    must_haves: [
      "Reliable attendance",
      "Ability to stand for extended periods",
      "Valid US work authorization",
    ],
  },
};

function buildRoleContext(roleKey, candidateName, agencyName) {
  const role = ROLE_CONTEXTS[roleKey] || ROLE_CONTEXTS.general;
  const lines = [
    "JOB DETAILS:",
    `- Role: ${role.title}`,
    `- Client / Venue: ${role.venue_type}`,
    `- Pay: ${role.pay_range}`,
    `- Shift: ${role.shift}`,
    `- Requirements: ${role.must_haves.join(", ")}`,
    "",
    "BEHAVIORAL QUESTIONS TO ASK (ask both, one at a time, after you have collected experience and availability):",
    `1. "${role.behavioral_questions[0]}"`,
    `2. "${role.behavioral_questions[1]}"`,
    "",
    `Agency Notes: This is a ${agencyName || "staffing partner"} placement. Candidates who pass screening will be forwarded to the client same day.`,
    "",
    `Candidate Name: ${candidateName || "Unknown"}`,
    `Applied Via: Voxaris VideoAgent intake flow`,
  ];
  return {
    contextString: lines.join("\n"),
    role,
  };
}

module.exports = { buildRoleContext, ROLE_CONTEXTS };
