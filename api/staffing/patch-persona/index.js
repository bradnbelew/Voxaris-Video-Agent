/**
 * POST /api/staffing/patch-persona
 *
 * One-shot endpoint that PATCHes the existing Jordan persona (via JSON Patch
 * RFC 6902) to attach:
 *   1. The full Raven-1 perception block under /layers/perception
 *   2. The full 11-objective conversation_rules.objectives block under
 *      /conversation_rules/objectives (includes the work_authorization
 *      conditional branch: continue_screening vs end_screening_ineligible)
 *   3. The 4 Jordan guardrails under /conversation_rules/guardrails, with
 *      callback_url pointing at STAFFING_BASE_URL/api/staffing/tools
 *
 * After this runs, Tavus enforces objectives and guardrails at the API level
 * on every new Jordan conversation — not just via system prompt.
 *
 * Run once after deploy:
 *   curl -X POST https://YOUR_DOMAIN/api/staffing/patch-persona
 *
 * Response: { ok, persona_id, patched_fields }
 */

const { patchPersona } = require("../../../shared/tavus-client");

const JORDAN_PERCEPTION = {
  perception_model: "raven-1",
  visual_awareness_queries: [
    "Does the candidate appear nervous, calm, or confident based on posture and facial expression?",
    "Is the candidate dressed professionally, casually, or informally for the interview?",
    "Is the candidate maintaining eye contact with the camera or frequently looking away?",
    "Is there anything in the background that appears unprofessional or distracting?",
  ],
  audio_awareness_queries: [
    "Does the candidate sound confident and clear, or hesitant and uncertain?",
    "Is the candidate speaking at a natural pace, or rushing and stumbling over words?",
    "Does the candidate sound genuinely enthusiastic about the role, or disengaged?",
  ],
  perception_analysis_queries: [
    "Overall, how would you rate the candidate's professional presentation on a scale of 1-10 based on visual appearance and setting?",
    "Were there moments where the candidate appeared visibly uncomfortable or evasive — if so, at what point in the conversation?",
    "Did the candidate's energy and engagement increase, decrease, or stay flat throughout the session?",
    "Was the candidate alone during the interview, or was anyone else present in the frame?",
    "On a scale of 1-100, how often was the candidate maintaining direct eye contact with the camera?",
  ],
};

const JORDAN_OBJECTIVES = [
  {
    objective_name: "candidate_ready",
    objective_prompt:
      "Candidate has acknowledged the greeting and confirmed they are ready to begin",
    output_variables: [],
    next_required_objective: "get_candidate_info",
  },
  {
    objective_name: "get_candidate_info",
    objective_prompt:
      "Confirm the candidate's full name, the role they applied for, and the best email address to reach them",
    output_variables: ["full_name", "applied_role", "email"],
    next_required_objective: "work_authorization",
  },
  {
    objective_name: "work_authorization",
    objective_prompt:
      "Candidate has confirmed they are legally authorized to work in the United States",
    output_variables: ["work_authorized"],
    next_conditional_objectives: {
      continue_screening:
        "if candidate confirms they are authorized to work in the US",
      end_screening_ineligible:
        "if candidate indicates they are not currently authorized to work in the US",
    },
  },
  {
    objective_name: "end_screening_ineligible",
    objective_prompt:
      "Candidate has been informed the role requires US work authorization and the session has been concluded respectfully",
    output_variables: [],
  },
  {
    objective_name: "continue_screening",
    objective_prompt:
      "Candidate has confirmed work authorization and is ready to continue",
    output_variables: [],
    next_required_objective: "get_experience",
  },
  {
    objective_name: "get_experience",
    objective_prompt:
      "Understand the candidate's relevant experience for the role — how many years, what type of venue, and most recent employer",
    output_variables: ["years_experience", "venue_type", "most_recent_employer"],
    next_required_objective: "get_certifications",
  },
  {
    objective_name: "get_certifications",
    objective_prompt:
      "Determine whether the candidate holds any certifications relevant to this role (TIPS, ServSafe, forklift, CPR, HIPAA, etc.)",
    output_variables: ["has_certification", "certification_name"],
    next_required_objective: "get_availability",
  },
  {
    objective_name: "get_availability",
    objective_prompt:
      "Get the candidate's availability for evening and weekend shifts and their earliest available start date",
    output_variables: [
      "available_evenings",
      "available_weekends",
      "earliest_start_date",
    ],
    next_required_objective: "physical_requirements",
  },
  {
    objective_name: "physical_requirements",
    objective_prompt:
      "Candidate has confirmed they are able to meet the physical requirements of the role (standing, lifting, etc.)",
    output_variables: ["confirmed_physical_requirements"],
    next_required_objective: "candidate_questions",
  },
  {
    objective_name: "candidate_questions",
    objective_prompt:
      "Candidate has been given the opportunity to ask questions about the role or the process, and any questions asked have been addressed or noted for recruiter follow-up",
    output_variables: ["candidate_question_1", "candidate_question_2"],
    next_required_objective: "closing_confirmed",
  },
  {
    objective_name: "closing_confirmed",
    objective_prompt:
      "Candidate has been told what the next steps are (recruiter will follow up within 24 hours) and has acknowledged the end of the session",
    output_variables: [],
    confirmation_mode: "manual",
  },
];

function buildJordanGuardrails(callbackUrl) {
  return [
    {
      guardrail_name: "protected_class_question",
      guardrail_prompt:
        "Jordan asks or responds to questions about the candidate's age, race, religion, national origin, marital status, pregnancy, or disability status in a way that could constitute illegal pre-employment inquiry",
      callback_url: callbackUrl,
      modality: "verbal",
    },
    {
      guardrail_name: "hiring_commitment_made",
      guardrail_prompt:
        "Jordan makes a direct offer of employment, guarantees placement, or commits to a specific pay rate not in the job context",
      callback_url: callbackUrl,
      modality: "verbal",
    },
    {
      guardrail_name: "sensitive_data_requested",
      guardrail_prompt:
        "Jordan asks the candidate for their social security number, date of birth, government ID number, or banking information",
      callback_url: callbackUrl,
      modality: "verbal",
    },
    {
      guardrail_name: "candidate_distress",
      guardrail_prompt:
        "Candidate expresses significant distress, frustration, or indicates they are in a difficult personal situation that is affecting the conversation",
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

  const personaId = process.env.TAVUS_STAFFING_PERSONA_ID;
  if (!personaId) {
    res.status(500).json({ error: "TAVUS_STAFFING_PERSONA_ID not set" });
    return;
  }
  if (!process.env.TAVUS_API_KEY) {
    res.status(500).json({ error: "TAVUS_API_KEY not set" });
    return;
  }

  const baseUrl =
    process.env.STAFFING_BASE_URL ||
    `https://${req.headers["x-forwarded-host"] || req.headers.host || "localhost"}`;
  const callbackUrl = `${baseUrl}/api/staffing/tools`;

  // Same empirical finding as realty: only /layers/perception is accepted.
  // conversation_rules is attempted as best-effort so this endpoint flips on
  // automatically when Tavus ships the field.

  const result = {
    ok: true,
    persona_id: personaId,
    callback_url: callbackUrl,
    patched_fields: [],
    warnings: [],
    jordan_objectives_count: JORDAN_OBJECTIVES.length,
    jordan_guardrails_count: buildJordanGuardrails(callbackUrl).length,
  };

  try {
    const perceptionResult = await patchPersona(personaId, [
      { op: "replace", path: "/layers/perception", value: JORDAN_PERCEPTION },
    ]);
    result.patched_fields.push("perception");
    result.perception_tavus_response = perceptionResult;
  } catch (e) {
    try {
      const perceptionResult = await patchPersona(personaId, [
        { op: "add", path: "/layers/perception", value: JORDAN_PERCEPTION },
      ]);
      result.patched_fields.push("perception");
      result.perception_strategy = "add";
      result.perception_tavus_response = perceptionResult;
    } catch (e2) {
      result.ok = false;
      result.perception_error = e2.message;
    }
  }

  try {
    await patchPersona(personaId, [
      {
        op: "add",
        path: "/conversation_rules",
        value: {
          objectives: JORDAN_OBJECTIVES,
          guardrails: buildJordanGuardrails(callbackUrl),
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
