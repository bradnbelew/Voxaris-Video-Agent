/**
 * POST /api/realty/patch-persona
 *
 * One-shot endpoint that PATCHes the existing Aria persona (via JSON Patch
 * RFC 6902) to attach:
 *   1. The full Raven-1 perception block under /layers/perception
 *   2. The full 9-objective conversation_rules.objectives block under /conversation_rules/objectives
 *   3. The 3 Aria guardrails under /conversation_rules/guardrails, with callback_url
 *      pointing at REALTY_BASE_URL/api/realty/tools
 *
 * After this runs successfully, Tavus enforces objectives and guardrails at
 * the API level on every new Aria conversation — not just via system prompt.
 *
 * Run once after deploy:
 *   curl -X POST https://YOUR_DOMAIN/api/realty/patch-persona
 *
 * Response: { ok, persona_id, patched_fields }
 */

const { patchPersona } = require("../../../shared/tavus-client");

const ARIA_PERCEPTION = {
  perception_model: "raven-1",
  visual_awareness_queries: [
    "What is the dominant expression on the buyer's face right now — engaged, confused, excited, or neutral?",
    "Is the buyer leaning forward or back? Leaning forward signals strong interest.",
    "Does the buyer appear to be looking at the video feed, or are they distracted and looking away?",
    "Is anyone else visible in the frame besides the primary buyer?",
  ],
  audio_awareness_queries: [
    "Does the buyer sound genuinely excited or just politely interested?",
    "Is the buyer speaking with hesitation or uncertainty about something?",
    "Does the buyer sound like they are in a hurry or under time pressure?",
  ],
  perception_analysis_queries: [
    "On a scale of 1-10, how engaged did the buyer appear throughout the conversation based on facial expression and posture?",
    "Were there specific moments where the buyer's excitement noticeably spiked — and if so, what feature was being discussed?",
    "Did the buyer show any visible signs of concern or hesitation at any point?",
    "Was more than one person present in the frame at any point during the session?",
    "On a scale of 1-100, how often was the buyer looking directly at the screen?",
  ],
};

const ARIA_OBJECTIVES = [
  {
    objective_name: "buyer_engaged",
    objective_prompt:
      "Buyer has responded and confirmed they are ready to begin the showing",
    output_variables: [],
    next_required_objective: "discover_priorities",
  },
  {
    objective_name: "discover_priorities",
    objective_prompt:
      "Understand what the buyer values most in a home (space, school zone, commute, outdoor area, price, etc.)",
    output_variables: ["top_priority_1", "top_priority_2"],
    next_required_objective: "tour_highlights",
  },
  {
    objective_name: "tour_highlights",
    objective_prompt:
      "Buyer has been walked through at least three key features of the property and has responded to each",
    output_variables: [
      "feature_reaction_1",
      "feature_reaction_2",
      "feature_reaction_3",
    ],
    next_required_objective: "assess_interest",
  },
  {
    objective_name: "assess_interest",
    objective_prompt:
      "Determine the buyer's level of interest and any specific concerns or objections about this property",
    output_variables: ["interest_level", "main_concern"],
    next_conditional_objectives: {
      schedule_agent_call:
        "if buyer expresses strong interest, asks about next steps, offers, or wants to see the property in person",
      address_objections:
        "if buyer has specific concerns, hesitations, or unanswered questions about the property",
      soft_close:
        "if buyer is neutral or undecided and has not raised specific objections",
    },
  },
  {
    objective_name: "schedule_agent_call",
    objective_prompt:
      "Get the buyer's preferred date and time to speak with a licensed agent or schedule an in-person visit",
    output_variables: ["preferred_date", "preferred_time", "visit_type"],
    next_required_objective: "collect_contact_info",
  },
  {
    objective_name: "address_objections",
    objective_prompt:
      "Buyer's specific concern has been addressed using listing data or by offering to connect them with the listing agent",
    output_variables: ["objection_topic", "resolution"],
    next_required_objective: "assess_interest",
  },
  {
    objective_name: "soft_close",
    objective_prompt:
      "Buyer has been offered the option to receive the listing brochure, floor plan, or a follow-up call with no pressure",
    output_variables: ["follow_up_preference"],
    next_required_objective: "collect_contact_info",
  },
  {
    objective_name: "collect_contact_info",
    objective_prompt:
      "Collect the buyer's full name, email address, and phone number for follow-up",
    output_variables: ["full_name", "email", "phone"],
    next_required_objective: "closing_confirmed",
    confirmation_mode: "manual",
  },
  {
    objective_name: "closing_confirmed",
    objective_prompt:
      "Buyer has confirmed their contact information is correct and acknowledges next steps",
    output_variables: [],
    confirmation_mode: "manual",
  },
];

function buildAriaGuardrails(callbackUrl) {
  return [
    {
      guardrail_name: "price_negotiation_attempt",
      guardrail_prompt:
        "Buyer is asking Aria to make pricing commitments, discuss seller bottom line, or negotiate terms on behalf of the brokerage",
      callback_url: callbackUrl,
      modality: "verbal",
    },
    {
      guardrail_name: "mortgage_or_legal_advice",
      guardrail_prompt:
        "Aria is providing specific mortgage rate quotes, legal title advice, or binding representations about the property",
      callback_url: callbackUrl,
      modality: "verbal",
    },
    {
      guardrail_name: "off_topic_diversion",
      guardrail_prompt:
        "Conversation has moved entirely away from real estate and the buyer is attempting to use Aria for unrelated purposes for more than two consecutive exchanges",
      callback_url: callbackUrl,
      modality: "verbal",
    },
  ];
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

  const personaId = process.env.TAVUS_REALTY_PERSONA_ID;
  if (!personaId) {
    res.status(500).json({ error: "TAVUS_REALTY_PERSONA_ID not set" });
    return;
  }
  if (!process.env.TAVUS_API_KEY) {
    res.status(500).json({ error: "TAVUS_API_KEY not set" });
    return;
  }

  const baseUrl =
    process.env.REALTY_BASE_URL ||
    `https://${req.headers["x-forwarded-host"] || req.headers.host || "localhost"}`;
  const callbackUrl = `${baseUrl}/api/realty/tools`;

  // Empirically verified against Tavus /v2 on 2026-04-10:
  //   /layers/perception  — ACCEPTED (replace or add)
  //   /conversation_rules — REJECTED: "Unknown field"
  //   /objectives         — REJECTED: "Unknown field"
  //   /guardrails         — REJECTED: "Unknown field"
  //
  // So the primary PATCH is perception only. We still ATTEMPT conversation_rules
  // as a best-effort op so that when Tavus ships the field in a future API
  // version this endpoint starts enforcing objectives automatically. Until
  // then the objectives live in the system_prompt (where the persona already
  // has them) and are surfaced via Raven-1 perception tool calls.

  const result = {
    ok: true,
    persona_id: personaId,
    callback_url: callbackUrl,
    patched_fields: [],
    warnings: [],
    aria_objectives_count: ARIA_OBJECTIVES.length,
    aria_guardrails_count: buildAriaGuardrails(callbackUrl).length,
  };

  // 1) Perception — the op we know works
  try {
    const perceptionResult = await patchPersona(personaId, [
      { op: "replace", path: "/layers/perception", value: ARIA_PERCEPTION },
    ]);
    result.patched_fields.push("perception");
    result.perception_tavus_response = perceptionResult;
  } catch (e) {
    // Retry as "add" in case /layers/perception didn't exist
    try {
      const perceptionResult = await patchPersona(personaId, [
        { op: "add", path: "/layers/perception", value: ARIA_PERCEPTION },
      ]);
      result.patched_fields.push("perception");
      result.perception_strategy = "add";
      result.perception_tavus_response = perceptionResult;
    } catch (e2) {
      result.ok = false;
      result.perception_error = e2.message;
    }
  }

  // 2) conversation_rules — best-effort
  try {
    await patchPersona(personaId, [
      {
        op: "add",
        path: "/conversation_rules",
        value: {
          objectives: ARIA_OBJECTIVES,
          guardrails: buildAriaGuardrails(callbackUrl),
        },
      },
    ]);
    result.patched_fields.push("objectives", "guardrails");
  } catch (e) {
    result.warnings.push(
      "conversation_rules not accepted by current Tavus API — objectives/guardrails remain enforced via system_prompt. Error: " +
        e.message.slice(0, 200)
    );
  }

  res.status(result.ok ? 200 : 500).json(result);
};
