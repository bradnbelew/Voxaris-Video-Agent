#!/usr/bin/env node
/**
 * Pass-1 + partial Pass-2 schema modernization for both personas,
 * driven by the ChatGPT + Perplexity deep-research audit findings.
 *
 * CHANGES APPLIED:
 *
 *  1. layers.llm.model:           tavus-gpt-4o (deprecated) → tavus-gpt-oss
 *  2. layers.llm.extra_body:      {} → { temperature: 0.3, top_p: 0.9 }
 *  3. layers.llm.base_url:        remove (custom-LLM only, empty here)
 *  4. layers.llm.api_key:         remove (custom-LLM only, empty here)
 *  5. layers.llm.headers:         remove (custom-LLM only, empty here)
 *  6. layers.llm.default_query:   remove (custom-LLM only, empty here)
 *  7. layers.llm.tools:           populate with save_candidate_screening
 *                                 (Jordan) or save_buyer_profile (Aria)
 *  8. layers.stt.stt_engine:      tavus-advanced (deprecated) → tavus-auto
 *  9. layers.stt.smart_turn_detection: remove (moved to conversational_flow)
 * 10. layers.stt.participant_pause_sensitivity: remove (moved)
 * 11. layers.stt.participant_interrupt_sensitivity: remove (moved)
 * 12. layers.stt.hotwords:        remove (only works on tavus-advanced)
 * 13. layers.conversational_flow: ADD new layer with sparrow-1 + high
 *                                 patience for interviews / tours
 * 14. layers.tts.playht_user_id:  remove (stale deprecated provider field)
 * 15. layers.perception.visual_awareness_queries: tightened for focus
 * 16. layers.perception.audio_awareness_queries:  tightened for 32-token cap
 * 17. layers.perception.perception_tools: remove (undocumented field)
 * 18. layers.perception.ambient_awareness_queries: remove (undocumented)
 * 19. layers.perception.tool_prompt: remove (undocumented)
 * 20. /greeting:                   remove (not documented at persona level)
 * 21. system_prompt:               replace unsubstituted [Staffing Agency
 *                                  Name] / [Brokerage Name] placeholders
 *                                  with flowing language that reads the
 *                                  agency/brokerage name from the injected
 *                                  conversational_context instead
 *
 * NOT IN SCOPE (deferred):
 *  - objectives_id / guardrails_id: require separate /v2/objectives and
 *    /v2/guardrails creation endpoints. Handled in a follow-up script.
 *  - memory_stores: only valid at conversation-creation time, not persona
 *  - document_ids / document_tags: Aria listing data native-RAG migration
 *
 * Each PATCH is wrapped in its own try/catch so one failing op doesn't
 * abort the rest of the modernization.
 */

require("dotenv").config();

const { patchPersona } = require("../shared/tavus-client");
const https = require("https");

function fetchPersona(id) {
  return new Promise((resolve, reject) => {
    https
      .request(
        {
          host: "tavusapi.com",
          path: "/v2/personas/" + id,
          method: "GET",
          headers: {
            "x-api-key": process.env.TAVUS_API_KEY,
            Accept: "application/json",
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(raw));
            } else {
              reject(new Error(res.statusCode + ": " + raw));
            }
          });
        }
      )
      .on("error", reject)
      .end();
  });
}

// ──────────────────────────────────────────────────────────────
//  Tool schemas — OpenAI function format
// ──────────────────────────────────────────────────────────────
const JORDAN_LLM_TOOLS = [
  {
    type: "function",
    function: {
      name: "save_candidate_screening",
      description:
        "Save structured candidate screening data collected during the interview. Call this whenever you've confirmed any of the fields below so the recruiter has a structured profile at the end of the call.",
      parameters: {
        type: "object",
        properties: {
          full_name: { type: "string", description: "Candidate's full name" },
          email: { type: "string", description: "Contact email address" },
          phone: { type: "string", description: "Contact phone number" },
          work_authorized: {
            type: "string",
            description:
              "Whether candidate is US work authorized. Accept 'yes', 'no', or 'unclear'.",
          },
          years_experience: {
            type: "string",
            description: "Years of relevant experience (e.g. '3-5')",
          },
          most_recent_employer: {
            type: "string",
            description: "Candidate's most recent employer name",
          },
          certifications: {
            type: "array",
            items: { type: "string" },
            description:
              "List of certifications held (TIPS, ServSafe, OSHA, forklift, CNA, HHA, CPR, HIPAA, etc.)",
          },
          available_evenings: {
            type: "boolean",
            description: "Available to work evening shifts",
          },
          available_weekends: {
            type: "boolean",
            description: "Available to work weekend shifts",
          },
          earliest_start_date: {
            type: "string",
            description: "Earliest start date in plain language",
          },
          confirmed_physical_requirements: {
            type: "boolean",
            description:
              "Whether candidate confirmed they meet physical requirements",
          },
          notes: {
            type: "string",
            description:
              "Free-form notes for recruiter about standout moments, concerns, or follow-ups",
          },
        },
        required: ["full_name"],
      },
    },
  },
];

const ARIA_LLM_TOOLS = [
  {
    type: "function",
    function: {
      name: "save_buyer_profile",
      description:
        "Save structured buyer profile data collected during the virtual tour. Call this whenever you've confirmed any of the fields below.",
      parameters: {
        type: "object",
        properties: {
          full_name: { type: "string", description: "Buyer's full name" },
          email: { type: "string", description: "Contact email address" },
          phone: { type: "string", description: "Contact phone number" },
          financing_status: {
            type: "string",
            description:
              "Pre-approved, in pre-approval process, paying cash, or still looking",
          },
          timeline: {
            type: "string",
            description: "Buyer's purchase timeline in plain language",
          },
          top_priority_1: {
            type: "string",
            description: "First top priority the buyer mentioned",
          },
          top_priority_2: {
            type: "string",
            description: "Second top priority the buyer mentioned",
          },
          interest_level: {
            type: "string",
            description:
              "Low, medium, high, or ready-to-schedule based on conversation",
          },
          main_concern: {
            type: "string",
            description:
              "Primary objection or concern the buyer raised, if any",
          },
          tour_requested: {
            type: "boolean",
            description: "Whether buyer asked to schedule an in-person tour",
          },
          preferred_date: {
            type: "string",
            description: "Preferred tour date if requested",
          },
          preferred_time: {
            type: "string",
            description: "Preferred tour time if requested",
          },
          notes: {
            type: "string",
            description:
              "Free-form notes for the listing agent about the buyer's reactions",
          },
        },
        required: ["full_name"],
      },
    },
  },
];

// ──────────────────────────────────────────────────────────────
//  Tightened perception queries (audio queries must stay under
//  ~32 tokens each per Tavus Raven-1 budget)
// ──────────────────────────────────────────────────────────────
const JORDAN_VISUAL_QUERIES = [
  "Does the candidate appear calm, nervous, or confident?",
  "Is the candidate maintaining eye contact with the camera?",
  "Is the setting professional or distracting?",
];

const JORDAN_AUDIO_QUERIES = [
  "Does the candidate sound confident, hesitant, or disengaged?",
  "Is the candidate speaking clearly and at a natural pace?",
];

const ARIA_VISUAL_QUERIES = [
  "Does the buyer look engaged, confused, or excited?",
  "Is the buyer leaning forward or back from the screen?",
  "Is more than one person visible in the frame?",
];

const ARIA_AUDIO_QUERIES = [
  "Does the buyer sound genuinely excited or politely interested?",
  "Does the buyer sound rushed or under time pressure?",
];

// ──────────────────────────────────────────────────────────────
//  Apply a single PATCH op with per-op error handling
// ──────────────────────────────────────────────────────────────
async function applyOp(personaId, label, op) {
  try {
    await patchPersona(personaId, [op]);
    console.log(`    ✓ ${label}`);
    return true;
  } catch (e) {
    const short = (e.message || "").slice(0, 220);
    console.log(`    ✗ ${label} — ${short}`);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
//  Fix system_prompt placeholders for a given persona
// ──────────────────────────────────────────────────────────────
async function fixSystemPromptPlaceholders(personaId, label) {
  const persona = await fetchPersona(personaId);
  let prompt = persona.system_prompt || "";
  const original = prompt;

  // Jordan: [Staffing Agency Name]
  prompt = prompt.replace(
    /You are Jordan, an AI candidate screening specialist for \[Staffing Agency Name\], a staffing and workforce solutions firm serving the Orlando metro area\./g,
    "You are Jordan, an AI candidate screening specialist working on behalf of the staffing agency conducting this interview. The specific agency name, role details, and required qualifications are provided in the conversation context injected at session start — always read the agency name from that context and never say bracketed placeholder text out loud."
  );

  // Aria: [Brokerage Name]
  prompt = prompt.replace(
    /You are Aria, an AI property showing specialist for \[Brokerage Name\], a residential real estate firm in Orlando, Florida\./g,
    "You are Aria, an AI property showing specialist working on behalf of the listing brokerage for this home. The specific brokerage name, listing address, and property details are provided in the conversation context injected at session start — always read the brokerage name from that context and never say bracketed placeholder text out loud."
  );

  // Jordan: [Staffing Agency Name] in the disclosure section
  prompt = prompt.replace(
    /on behalf of the staffing team\b/g,
    "on behalf of the staffing agency that invited you to this interview"
  );

  if (prompt === original) {
    console.log(`    ⚠ ${label} system_prompt had no placeholders to fix`);
    return false;
  }

  try {
    await patchPersona(personaId, [
      { op: "replace", path: "/system_prompt", value: prompt },
    ]);
    console.log(
      `    ✓ ${label} system_prompt placeholders replaced (${original.length} → ${prompt.length} chars)`
    );
    return true;
  } catch (e) {
    console.log(`    ✗ ${label} system_prompt PATCH failed — ${e.message.slice(0, 300)}`);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
//  Full modernization sequence for one persona
// ──────────────────────────────────────────────────────────────
async function modernizePersona(label, id, llmTools, visualQueries, audioQueries) {
  console.log(`\n═══ ${label} (${id}) ═══`);

  const ops = [
    // LLM modernization
    {
      l: "llm.model → tavus-gpt-oss",
      op: { op: "replace", path: "/layers/llm/model", value: "tavus-gpt-oss" },
    },
    {
      l: "llm.extra_body → {temperature:0.3, top_p:0.9}",
      op: {
        op: "replace",
        path: "/layers/llm/extra_body",
        value: { temperature: 0.3, top_p: 0.9 },
      },
    },
    {
      l: "llm.tools → save_[candidate|buyer]_profile function",
      op: {
        op: "replace",
        path: "/layers/llm/tools",
        value: llmTools,
      },
    },
    {
      l: "llm.base_url → remove (custom-LLM only)",
      op: { op: "remove", path: "/layers/llm/base_url" },
    },
    {
      l: "llm.api_key → remove (custom-LLM only)",
      op: { op: "remove", path: "/layers/llm/api_key" },
    },
    {
      l: "llm.headers → remove (custom-LLM only)",
      op: { op: "remove", path: "/layers/llm/headers" },
    },
    {
      l: "llm.default_query → remove (custom-LLM only)",
      op: { op: "remove", path: "/layers/llm/default_query" },
    },

    // STT modernization
    {
      l: "stt.stt_engine → tavus-auto",
      op: { op: "replace", path: "/layers/stt/stt_engine", value: "tavus-auto" },
    },
    {
      l: "stt.smart_turn_detection → remove (moved to conversational_flow)",
      op: { op: "remove", path: "/layers/stt/smart_turn_detection" },
    },
    {
      l: "stt.participant_pause_sensitivity → remove",
      op: { op: "remove", path: "/layers/stt/participant_pause_sensitivity" },
    },
    {
      l: "stt.participant_interrupt_sensitivity → remove",
      op: { op: "remove", path: "/layers/stt/participant_interrupt_sensitivity" },
    },
    {
      l: "stt.hotwords → remove (not compatible with tavus-auto)",
      op: { op: "remove", path: "/layers/stt/hotwords" },
    },

    // Add new conversational_flow layer with sparrow-1
    {
      l: "ADD layers.conversational_flow {sparrow-1, high patience, medium interruptibility}",
      op: {
        op: "add",
        path: "/layers/conversational_flow",
        value: {
          turn_detection_model: "sparrow-1",
          turn_taking_patience: "high",
          replica_interruptibility: "medium",
        },
      },
    },

    // TTS cleanup
    {
      l: "tts.playht_user_id → remove (stale deprecated provider field)",
      op: { op: "remove", path: "/layers/tts/playht_user_id" },
    },

    // Perception tighten + undocumented cleanup
    {
      l: "perception.visual_awareness_queries → tightened (3 focused)",
      op: {
        op: "replace",
        path: "/layers/perception/visual_awareness_queries",
        value: visualQueries,
      },
    },
    {
      l: "perception.audio_awareness_queries → tightened (32-token cap safe)",
      op: {
        op: "replace",
        path: "/layers/perception/audio_awareness_queries",
        value: audioQueries,
      },
    },
    {
      l: "perception.perception_tools → remove (undocumented field)",
      op: { op: "remove", path: "/layers/perception/perception_tools" },
    },
    {
      l: "perception.ambient_awareness_queries → remove (undocumented field)",
      op: { op: "remove", path: "/layers/perception/ambient_awareness_queries" },
    },
    {
      l: "perception.tool_prompt → remove (undocumented field)",
      op: { op: "remove", path: "/layers/perception/tool_prompt" },
    },

    // Top-level cleanup
    {
      l: "/greeting → remove (not documented at persona level)",
      op: { op: "remove", path: "/greeting" },
    },
  ];

  let applied = 0;
  let failed = 0;
  for (const { l, op } of ops) {
    const ok = await applyOp(id, l, op);
    if (ok) applied++;
    else failed++;
  }

  // System prompt placeholder fix (separate because it reads-then-writes)
  console.log(`\n  → system_prompt placeholder fix`);
  const promptFixed = await fixSystemPromptPlaceholders(id, label);
  if (promptFixed) applied++;

  console.log(`\n  ${label} summary: ${applied} applied, ${failed} failed`);
  return { applied, failed };
}

async function main() {
  if (!process.env.TAVUS_API_KEY) {
    console.error("TAVUS_API_KEY missing");
    process.exit(1);
  }

  const jordanResult = await modernizePersona(
    "JORDAN",
    "p015ee7b4ab6",
    JORDAN_LLM_TOOLS,
    JORDAN_VISUAL_QUERIES,
    JORDAN_AUDIO_QUERIES
  );

  const ariaResult = await modernizePersona(
    "ARIA",
    "p4700c5f2722",
    ARIA_LLM_TOOLS,
    ARIA_VISUAL_QUERIES,
    ARIA_AUDIO_QUERIES
  );

  console.log("\n═══ MODERNIZATION SUMMARY ═══");
  console.log(
    `  Jordan: ${jordanResult.applied} applied, ${jordanResult.failed} failed`
  );
  console.log(`  Aria:   ${ariaResult.applied} applied, ${ariaResult.failed} failed`);

  // Final verification — fetch both and print the canonical state
  console.log("\n═══ FINAL STATE ═══");
  for (const [name, id] of [
    ["Jordan", "p015ee7b4ab6"],
    ["Aria", "p4700c5f2722"],
  ]) {
    const p = await fetchPersona(id);
    console.log(`\n${name}:`);
    console.log(`  llm.model              = ${p.layers.llm.model}`);
    console.log(
      `  llm.extra_body         = ${JSON.stringify(p.layers.llm.extra_body)}`
    );
    console.log(`  llm.tools.length       = ${(p.layers.llm.tools || []).length}`);
    console.log(`  stt.stt_engine         = ${p.layers.stt.stt_engine}`);
    console.log(
      `  conversational_flow    = ${JSON.stringify(p.layers.conversational_flow || null)}`
    );
    console.log(
      `  perception.visual_tools.length = ${(p.layers.perception.visual_tools || []).length}`
    );
    console.log(
      `  perception.audio_tools.length  = ${(p.layers.perception.audio_tools || []).length}`
    );
    console.log(
      `  perception.visual_awareness_queries.length = ${(p.layers.perception.visual_awareness_queries || []).length}`
    );
    console.log(
      `  perception.audio_awareness_queries.length  = ${(p.layers.perception.audio_awareness_queries || []).length}`
    );
    console.log(
      `  placeholder still present      = ${
        p.system_prompt && p.system_prompt.includes("[Staffing Agency Name]")
      }`
    );
    console.log(
      `  disclosure section present     = ${
        p.system_prompt && p.system_prompt.includes("## AI DISCLOSURE")
      }`
    );
  }
}

main().catch((e) => {
  console.error("fatal:", e.message);
  process.exit(1);
});
