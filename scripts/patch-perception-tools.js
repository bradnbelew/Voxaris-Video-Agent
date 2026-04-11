#!/usr/bin/env node
/**
 * Attempts to populate visual_tools + audio_tools on both personas.
 * Raven-1 tool calls (like buyer_highly_interested, candidate_strong_signal)
 * surface client-side via Daily.js app-message events — Tavus itself does
 * NOT route them to the webhook callback — but they still have to exist on
 * the persona before Raven-1 will emit them.
 *
 * We try multiple schemas because Tavus docs are sparse on the exact shape.
 * Whichever schema Tavus accepts wins.
 */

require("dotenv").config();

const { patchPersona } = require("../shared/tavus-client");

// OpenAI function-tool format (most common across Tavus layers)
const ARIA_VISUAL_TOOLS = [
  {
    type: "function",
    function: {
      name: "buyer_highly_interested",
      description:
        "Trigger when buyer shows strong nonverbal buying signals — leaning in, smiling, sustained eye contact — especially during a specific feature discussion",
      parameters: {
        type: "object",
        properties: {
          feature_being_discussed: {
            type: "string",
            description:
              "The property feature being discussed when high interest was detected",
            maxLength: 200,
          },
          signal_description: {
            type: "string",
            description:
              "Brief natural language description of what Raven observed",
            maxLength: 300,
          },
        },
        required: ["feature_being_discussed", "signal_description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buyer_appears_disengaged",
      description:
        "Trigger when buyer has been visually disengaged for multiple turns — looking away, flat expression, minimal responsiveness",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description:
              "What Raven observed that indicates disengagement",
            maxLength: 300,
          },
        },
        required: ["reason"],
      },
    },
  },
];

const ARIA_AUDIO_TOOLS = [
  {
    type: "function",
    function: {
      name: "buyer_ready_to_book",
      description:
        "Trigger when buyer's audio signals a decisive shift — faster speech, confident tone, direct questions about next steps or scheduling",
      parameters: {
        type: "object",
        properties: {
          trigger_phrase: {
            type: "string",
            description:
              "The buyer's words or phrase that triggered this detection",
            maxLength: 300,
          },
        },
        required: ["trigger_phrase"],
      },
    },
  },
];

const JORDAN_VISUAL_TOOLS = [
  {
    type: "function",
    function: {
      name: "flag_unprofessional_setting",
      description:
        "Trigger when the candidate's environment contains clearly unprofessional or distracting visual elements that should be noted for the recruiter review",
      parameters: {
        type: "object",
        properties: {
          observation: {
            type: "string",
            description: "Description of the visual element detected",
            maxLength: 300,
          },
        },
        required: ["observation"],
      },
    },
  },
];

const JORDAN_AUDIO_TOOLS = [
  {
    type: "function",
    function: {
      name: "candidate_strong_signal",
      description:
        "Trigger when candidate consistently sounds confident, articulate, and enthusiastic — strong forward pipeline signal",
      parameters: {
        type: "object",
        properties: {
          standout_moment: {
            type: "string",
            description:
              "The specific answer or moment that most stood out positively",
            maxLength: 300,
          },
        },
        required: ["standout_moment"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_recruiter",
      description:
        "Trigger when candidate is distressed, confused, or discloses something requiring human recruiter intervention",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Why escalation is needed",
            maxLength: 300,
          },
        },
        required: ["reason"],
      },
    },
  },
];

const ARIA_VISUAL_TOOL_PROMPT =
  "You have two tools: `buyer_highly_interested` and `buyer_appears_disengaged`. Use `buyer_highly_interested` when the buyer is leaning forward, smiling, and maintaining eye contact during a feature discussion. Use `buyer_appears_disengaged` when the buyer is looking away, has a flat expression, and has been unresponsive for multiple turns.";

const ARIA_AUDIO_TOOL_PROMPT =
  "You have a tool called `buyer_ready_to_book`. Use it when the buyer's tone shifts from exploratory to decisive — they start speaking faster, with more confidence, and ask direct questions about next steps, offers, or scheduling.";

const JORDAN_VISUAL_TOOL_PROMPT =
  "You have a tool called `flag_unprofessional_setting`. Use it if the candidate's background contains clearly distracting, inappropriate, or unprofessional elements that a recruiter should be aware of.";

const JORDAN_AUDIO_TOOL_PROMPT =
  "You have two tools: `candidate_strong_signal` and `escalate_to_recruiter`. Use `candidate_strong_signal` when the candidate sounds confident, articulate, and genuinely enthusiastic across multiple answers. Use `escalate_to_recruiter` if the candidate becomes visibly or audibly distressed, confused, or if they discloses something that requires human follow-up.";

async function tryStrategies(label, personaId, visualTools, audioTools, visualPrompt, audioPrompt) {
  console.log(`\n=== ${label} (${personaId}) ===`);

  // Strategy 1: Replace the whole perception layer atomically
  console.log("→ Strategy 1: replace /layers/perception with tools populated");
  try {
    const r = await patchPersona(personaId, [
      {
        op: "replace",
        path: "/layers/perception/visual_tools",
        value: visualTools,
      },
      {
        op: "replace",
        path: "/layers/perception/audio_tools",
        value: audioTools,
      },
      {
        op: "replace",
        path: "/layers/perception/visual_tool_prompt",
        value: visualPrompt,
      },
      {
        op: "replace",
        path: "/layers/perception/audio_tool_prompt",
        value: audioPrompt,
      },
    ]);
    console.log("  ✓ Strategy 1 SUCCESS:", r && r.status ? r.status : "200");
    return "strategy-1";
  } catch (e) {
    console.log("  ✗ Strategy 1 failed:", e.message.slice(0, 400));
  }

  // Strategy 2: Add individual tools via array append
  console.log("→ Strategy 2: add /layers/perception/visual_tools/- per tool");
  try {
    const ops = [];
    visualTools.forEach((t) => {
      ops.push({
        op: "add",
        path: "/layers/perception/visual_tools/-",
        value: t,
      });
    });
    audioTools.forEach((t) => {
      ops.push({
        op: "add",
        path: "/layers/perception/audio_tools/-",
        value: t,
      });
    });
    ops.push({
      op: "replace",
      path: "/layers/perception/visual_tool_prompt",
      value: visualPrompt,
    });
    ops.push({
      op: "replace",
      path: "/layers/perception/audio_tool_prompt",
      value: audioPrompt,
    });
    const r = await patchPersona(personaId, ops);
    console.log("  ✓ Strategy 2 SUCCESS:", r && r.status ? r.status : "200");
    return "strategy-2";
  } catch (e) {
    console.log("  ✗ Strategy 2 failed:", e.message.slice(0, 400));
  }

  // Strategy 3: Simplified tool schema (no wrapper function object)
  console.log("→ Strategy 3: simplified tool schema");
  try {
    const simplifiedVisual = visualTools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
    const simplifiedAudio = audioTools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
    const r = await patchPersona(personaId, [
      {
        op: "replace",
        path: "/layers/perception/visual_tools",
        value: simplifiedVisual,
      },
      {
        op: "replace",
        path: "/layers/perception/audio_tools",
        value: simplifiedAudio,
      },
    ]);
    console.log("  ✓ Strategy 3 SUCCESS:", r && r.status ? r.status : "200");
    return "strategy-3";
  } catch (e) {
    console.log("  ✗ Strategy 3 failed:", e.message.slice(0, 400));
  }

  console.log("\n⚠ All strategies exhausted — perception tool PATCH is not supported in current Tavus API");
  return null;
}

async function main() {
  if (!process.env.TAVUS_API_KEY) {
    console.error("TAVUS_API_KEY missing");
    process.exit(1);
  }

  await tryStrategies(
    "Aria",
    "p4700c5f2722",
    ARIA_VISUAL_TOOLS,
    ARIA_AUDIO_TOOLS,
    ARIA_VISUAL_TOOL_PROMPT,
    ARIA_AUDIO_TOOL_PROMPT
  );

  await tryStrategies(
    "Jordan",
    "p015ee7b4ab6",
    JORDAN_VISUAL_TOOLS,
    JORDAN_AUDIO_TOOLS,
    JORDAN_VISUAL_TOOL_PROMPT,
    JORDAN_AUDIO_TOOL_PROMPT
  );
}

main().catch((e) => {
  console.error("fatal:", e.message);
  process.exit(1);
});
