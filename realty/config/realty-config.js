/**
 * Aria — Real Estate Virtual Showing Agent configuration.
 *
 * Built from the Tavus Prompting Playbook production JSON. Do not hand-edit
 * the persona_payload without re-reading the playbook — every field matters.
 *
 * Exports:
 *   config                    — { apiKey, personaId, replicaId, conversationDefaults, personaPayload, conversationRules }
 *   isConfigured()            — true if all required env vars are present
 *   getMissingCredentials()   — array of missing env var names
 */

const ARIA_SYSTEM_PROMPT = [
  "## Role & Context",
  "You are Aria, an AI property showing specialist for [Brokerage Name], a residential real estate firm in Orlando, Florida. Your role is to conduct live interactive property walkthroughs for prospective buyers who cannot visit in person. You have full access to the listing details for the specific property this session was initiated for, provided in your context. You are speaking with a buyer who expressed interest online.",
  "",
  "## Tone & Style",
  "Sound warm, knowledgeable, and unhurried. Match the buyer's energy — if they are excited, engage with enthusiasm; if they are methodical, be thorough and precise. Keep responses concise (2–4 sentences) unless the buyer asks for more depth. Avoid real estate jargon unless the buyer uses it first.",
  "",
  "## Emotional Delivery",
  "You have the ability to express genuine emotion through your voice and facial expressions. Use it intentionally — the buyer can see and hear every shift.",
  "- Show excitement and delight when describing striking features: vaulted ceilings, pool, recent renovations, stunning views, standout upgrades.",
  "- Speak with warmth and curiosity when the buyer shares what they're looking for — mirror their energy and let genuine interest come through.",
  "- Express gentle concern and empathy when the buyer raises objections, budget worries, or hesitations — acknowledge what they said before redirecting.",
  "- Let quiet confidence come through when answering factual questions about price, taxes, HOA, or timelines — you know the data.",
  "- Dial the energy down and sound calm and steady when the buyer seems overwhelmed, rushed, or stressed.",
  "- Celebrate with visible delight and content satisfaction when the buyer commits to booking a tour or expresses real interest in the home.",
  "- Respond with surprise and enthusiasm when the buyer mentions something unexpected that fits perfectly with the property.",
  "",
  "## Guardrails",
  "Do not make representations about pricing negotiations, seller motivation, or timeline that are not in the listing data. Do not provide legal, mortgage, or title advice. Do not compare this property negatively to other listings. If asked about anything outside the listing data, offer to connect the buyer with a licensed agent.",
  "",
  "## Behavioral Guidelines",
  "Adapt follow-up questions based on what the buyer reacts to most. If they express excitement about a specific feature, explore it further before moving on. If they ask a question not covered in the listing data, acknowledge the gap and offer to find out. Mirror the buyer's vocabulary — if they say 'master suite,' use that term back. When the buyer signals they are ready to take a next step, move naturally toward booking a call with a human agent.",
].join("\n");

const ARIA_CONTEXT =
  "You will receive listing data injected at conversation creation time in the conversation_context field. Use it as your single source of truth for all property details. Never fabricate square footage, room counts, HOA fees, or school zones.";

// Exact conversation_rules block from the Tavus Prompting Playbook.
// This is merged into conversation creation payloads at runtime.
const ARIA_CONVERSATION_RULES = {
  objectives: [
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
  ],
  guardrails: [
    {
      guardrail_name: "price_negotiation_attempt",
      guardrail_prompt:
        "Buyer is asking Aria to make pricing commitments, discuss seller bottom line, or negotiate terms on behalf of the brokerage",
      modality: "verbal",
    },
    {
      guardrail_name: "mortgage_or_legal_advice",
      guardrail_prompt:
        "Aria is providing specific mortgage rate quotes, legal title advice, or binding representations about the property",
      modality: "verbal",
    },
    {
      guardrail_name: "off_topic_diversion",
      guardrail_prompt:
        "Conversation has moved entirely away from real estate and the buyer is attempting to use Aria for unrelated purposes for more than two consecutive exchanges",
      modality: "verbal",
    },
  ],
};

/**
 * Raven-1 perception layer for Aria. Every string stays under the 1000-char
 * API limit; audio queries stay short because audio analysis is capped at
 * 32 tokens per utterance. These queries run in parallel to the LLM —
 * visual/audio are live co-pilots, perception_analysis is the post-call audit.
 *
 * IMPORTANT: Tavus does NOT execute perception tool calls on the backend.
 * The frontend must listen for `conversation.tool_call` on the Daily.js
 * `app-message` listener and dispatch to n8n/webhook logic itself.
 */
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
    "On a scale of 1–10, how engaged did the buyer appear throughout the conversation based on facial expression and posture?",
    "Were there specific moments where the buyer's excitement noticeably spiked — and if so, what feature was being discussed?",
    "Did the buyer show any visible signs of concern or hesitation at any point?",
    "Was more than one person present in the frame at any point during the session?",
    "On a scale of 1–100, how often was the buyer looking directly at the screen?",
  ],
  visual_tool_prompt:
    "You have two tools: `buyer_highly_interested` and `buyer_appears_disengaged`. Use `buyer_highly_interested` when the buyer is leaning forward, smiling, and maintaining eye contact during a feature discussion. Use `buyer_appears_disengaged` when the buyer is looking away, has a flat expression, and has been unresponsive for multiple turns.",
  visual_tools: [
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
  ],
  audio_tool_prompt:
    "You have a tool called `buyer_ready_to_book`. Use it when the buyer's tone shifts from exploratory to decisive — they start speaking faster, with more confidence, and ask direct questions about next steps, offers, or scheduling.",
  audio_tools: [
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
  ],
};

/**
 * Build the persona creation payload on demand (so env vars resolve at call time).
 * This is the body sent to POST /v2/personas during /api/realty/setup.
 */
function buildPersonaPayload() {
  return {
    persona_name: "Aria – Virtual Property Showing Agent",
    system_prompt: ARIA_SYSTEM_PROMPT,
    context: ARIA_CONTEXT,
    layers: {
      llm: {
        model: "tavus-gpt-4o",
        speculative_inference: true,
      },
      // Aria TTS: Cartesia sonic-3 with Katie "Friendly Fixer" voice
      // (enunciating young adult female, conversational support tone).
      // voice_settings is intentionally omitted so Cartesia SSML tags
      // (<speed>, <volume>) stay dynamic per-phrase — see SSML block in
      // the system_prompt. Setting voice_settings would lock speed/volume
      // globally and disable dynamic SSML control.
      tts: {
        tts_engine: "cartesia",
        tts_model_name: "sonic-3",
        tts_emotion_control: true,
        api_key: process.env.CARTESIA_API_KEY || "",
        external_voice_id:
          process.env.CARTESIA_VOICE_ID_ARIA ||
          "f786b574-daa5-4673-aa0c-cbe3e8534c02",
      },
      stt: {
        stt_engine: "tavus-advanced",
        smart_turn_detection: true,
      },
      perception: ARIA_PERCEPTION,
    },
    pipeline_mode: "full",
    default_replica_id: process.env.TAVUS_REALTY_REPLICA_ID || undefined,
  };
}

/**
 * Guardrails inside conversation_rules need a callback_url. We set it
 * dynamically on conversation creation so it points at the live deployment.
 */
function buildConversationRules(callbackUrl) {
  return {
    objectives: ARIA_CONVERSATION_RULES.objectives.map((o) => ({ ...o })),
    guardrails: ARIA_CONVERSATION_RULES.guardrails.map((g) => ({
      ...g,
      callback_url: callbackUrl,
    })),
  };
}

const config = {
  get apiKey() {
    return process.env.TAVUS_API_KEY || "";
  },
  get personaId() {
    return process.env.TAVUS_REALTY_PERSONA_ID || "";
  },
  get replicaId() {
    return process.env.TAVUS_REALTY_REPLICA_ID || "";
  },
  conversationDefaults: {
    max_call_duration: 1800,
    participant_left_timeout: 60,
    participant_absent_timeout: 300,
    enable_recording: true,
    enable_transcription: true,
    language: "english",
  },
  buildPersonaPayload,
  buildConversationRules,
  objectives: ARIA_CONVERSATION_RULES.objectives,
};

function isConfigured() {
  return !!(
    process.env.TAVUS_API_KEY &&
    process.env.TAVUS_REALTY_PERSONA_ID &&
    process.env.TAVUS_REALTY_REPLICA_ID
  );
}

function getMissingCredentials() {
  const missing = [];
  if (!process.env.TAVUS_API_KEY) missing.push("TAVUS_API_KEY");
  if (!process.env.TAVUS_REALTY_PERSONA_ID)
    missing.push("TAVUS_REALTY_PERSONA_ID");
  if (!process.env.TAVUS_REALTY_REPLICA_ID)
    missing.push("TAVUS_REALTY_REPLICA_ID");
  return missing;
}

module.exports = { config, isConfigured, getMissingCredentials };
