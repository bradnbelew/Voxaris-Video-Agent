#!/usr/bin/env node
/**
 * Second-stage PATCH test: attempt to attach conversation_rules (objectives
 * + guardrails) to both personas. If the Tavus persona schema doesn't expose
 * /conversation_rules, this script surfaces the exact error so we can pivot.
 */

require("dotenv").config();

const { patchPersona } = require("../shared/tavus-client");

const ARIA_OBJECTIVES = [
  { objective_name: "buyer_engaged", objective_prompt: "Buyer has responded and confirmed they are ready to begin the showing", output_variables: [], next_required_objective: "discover_priorities" },
  { objective_name: "discover_priorities", objective_prompt: "Understand what the buyer values most in a home", output_variables: ["top_priority_1", "top_priority_2"], next_required_objective: "tour_highlights" },
  { objective_name: "tour_highlights", objective_prompt: "Buyer has been walked through at least three key features of the property and has responded to each", output_variables: ["feature_reaction_1", "feature_reaction_2", "feature_reaction_3"], next_required_objective: "assess_interest" },
  { objective_name: "assess_interest", objective_prompt: "Determine the buyer's level of interest", output_variables: ["interest_level", "main_concern"], next_conditional_objectives: { schedule_agent_call: "if strong interest", address_objections: "if concerns", soft_close: "if neutral" } },
  { objective_name: "schedule_agent_call", objective_prompt: "Get the buyer's preferred date and time", output_variables: ["preferred_date", "preferred_time", "visit_type"], next_required_objective: "collect_contact_info" },
  { objective_name: "address_objections", objective_prompt: "Buyer's concern has been addressed", output_variables: ["objection_topic", "resolution"], next_required_objective: "assess_interest" },
  { objective_name: "soft_close", objective_prompt: "Buyer has been offered follow-up options", output_variables: ["follow_up_preference"], next_required_objective: "collect_contact_info" },
  { objective_name: "collect_contact_info", objective_prompt: "Collect contact info", output_variables: ["full_name", "email", "phone"], next_required_objective: "closing_confirmed", confirmation_mode: "manual" },
  { objective_name: "closing_confirmed", objective_prompt: "Buyer has confirmed contact info", output_variables: [], confirmation_mode: "manual" },
];

const ARIA_GUARDRAILS = [
  { guardrail_name: "price_negotiation_attempt", guardrail_prompt: "Buyer pushing for price negotiation", callback_url: "https://voxaris-videoagent.vercel.app/api/realty/tools", modality: "verbal" },
  { guardrail_name: "mortgage_or_legal_advice", guardrail_prompt: "Aria giving legal or mortgage advice", callback_url: "https://voxaris-videoagent.vercel.app/api/realty/tools", modality: "verbal" },
  { guardrail_name: "off_topic_diversion", guardrail_prompt: "Conversation moved off real estate", callback_url: "https://voxaris-videoagent.vercel.app/api/realty/tools", modality: "verbal" },
];

async function attempt(label, personaId, op, path, value) {
  console.log(`\n→ ${label} | ${op} ${path}`);
  try {
    const r = await patchPersona(personaId, [{ op, path, value }]);
    console.log("  ✓ OK");
    return true;
  } catch (e) {
    console.log("  ✗", e.message.slice(0, 400));
    return false;
  }
}

async function main() {
  const ariaId = process.env.TAVUS_REALTY_PERSONA_ID;

  // Try several possible paths for objectives. Whichever one works wins.
  const rulesBlock = { objectives: ARIA_OBJECTIVES, guardrails: ARIA_GUARDRAILS };

  // Path A: /conversation_rules (as the Prompting Playbook claims)
  const a = await attempt("Aria rules A", ariaId, "add", "/conversation_rules", rulesBlock);
  if (a) {
    console.log("\n✓ conversation_rules path accepted");
    return;
  }

  // Path B: top-level /objectives + /guardrails
  const b1 = await attempt("Aria rules B.1", ariaId, "add", "/objectives", ARIA_OBJECTIVES);
  const b2 = await attempt("Aria rules B.2", ariaId, "add", "/guardrails", ARIA_GUARDRAILS);
  if (b1 && b2) {
    console.log("\n✓ /objectives + /guardrails paths accepted");
    return;
  }

  // Path C: under /layers/llm/objectives
  const c1 = await attempt("Aria rules C.1", ariaId, "add", "/layers/llm/objectives", ARIA_OBJECTIVES);
  if (c1) {
    console.log("\n✓ /layers/llm/objectives path accepted");
    return;
  }

  // Path D: under /layers/llm/tools
  const d = await attempt("Aria rules D", ariaId, "add", "/layers/llm/tools", ARIA_OBJECTIVES);
  if (d) {
    console.log("\n✓ /layers/llm/tools path accepted");
    return;
  }

  console.log("\n⚠ None of the paths worked. Objectives/guardrails cannot be attached to the persona in this API version.");
  console.log("  Fallback strategy: embed objectives into system_prompt as structured guidance.");
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
