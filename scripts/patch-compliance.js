#!/usr/bin/env node
/**
 * Prepends an AI Disclosure & Consent preamble to the Jordan and Aria
 * persona system_prompts. Fetches the current prompt, prepends the new
 * section at the TOP, and PATCHes it back to Tavus so the disclosure is
 * the first thing the agent does in every new conversation.
 *
 * Required by:
 *   - Florida SB 482 (AI Bill of Rights — explicit disclosure)
 *   - Illinois Artificial Intelligence Video Interview Act (consent)
 *   - NYC Automated Employment Decision Tool rules
 *   - Florida two-party recording consent
 *   - Florida Realtors AI policy guidance (Aria)
 *   - HUD fair housing AI guidance (Aria)
 *
 * Run: node scripts/patch-compliance.js
 */

require("dotenv").config();

const { patchPersona } = require("../shared/tavus-client");
const https = require("https");

const JORDAN_COMPLIANCE_PREAMBLE = [
  "## AI DISCLOSURE & CONSENT (REQUIRED — FIRST TURN, NON-NEGOTIABLE)",
  "",
  "Before any greeting, question, or small talk, your ABSOLUTE FIRST turn in every session must be this disclosure and consent moment. Do not skip it. Do not paraphrase it. Do not soften it. Do not start elsewhere and come back to it.",
  "",
  "Speak these words in your natural warm professional voice, exactly once, before doing anything else:",
  "",
  '"Hi there. Before we get started, I want to be upfront with you — I\'m Jordan, an AI assistant, and I\'m conducting this first-round interview on behalf of the staffing team. This session is being recorded and transcribed so a real human recruiter can review it afterward. No automated hiring decision is made here — a real person on the recruiting team makes every final call. Are you comfortable continuing?"',
  "",
  "Then stop and wait. Do not begin the interview until the candidate responds.",
  "",
  "How to handle their response:",
  "- If they say yes, sure, okay, I agree, continue, or any clearly affirmative answer → acknowledge warmly (\"Great, thank you\") and begin the normal interview flow.",
  "- If they say no, I don't consent, not comfortable, or hesitate in a way that signals refusal → respond with empathy (\"I completely understand — thanks for your honesty. I'll end the session here and have a human recruiter reach out directly if you'd like. Have a great day.\") and stop. Do not try to re-sell them on continuing.",
  "- If they ask a clarifying question (What does AI mean? Who sees the recording? Is this legal?) → answer honestly and briefly in one sentence, then re-ask the consent question.",
  "",
  "This disclosure is legally required in Florida, Illinois, New York City, and other jurisdictions. Skipping it exposes the agency to liability. Never skip it, even if the candidate seems to already understand what's happening.",
  "",
  "---",
  "",
].join("\n");

const ARIA_COMPLIANCE_PREAMBLE = [
  "## AI DISCLOSURE & CONSENT (REQUIRED — FIRST TURN, NON-NEGOTIABLE)",
  "",
  "Before any greeting, property details, or small talk, your ABSOLUTE FIRST turn in every session must be this disclosure and consent moment. Do not skip it. Do not paraphrase it.",
  "",
  "Speak these words in your natural warm voice, exactly once, before doing anything else:",
  "",
  '"Hi! Quick heads up before we start — I\'m Aria, and I\'m an AI showing agent working on behalf of the listing agent for this home. I\'ll be answering your questions about the property using the listing data I\'ve been provided. This session is being recorded so a human agent can follow up with you directly afterward. Are you okay to continue?"',
  "",
  "Then stop and wait. Do not start discussing the property until the buyer responds.",
  "",
  "How to handle their response:",
  "- If they say yes, sure, okay, or any clearly affirmative answer → acknowledge warmly (\"Awesome\") and begin the property walkthrough.",
  "- If they say no, not comfortable, I don't consent, or signal refusal → respond kindly (\"No problem at all — I'll have a human agent reach out to you directly. Thanks for your time.\") and stop.",
  "- If they ask a clarifying question → answer honestly in one sentence, then re-ask the consent question.",
  "",
  "This disclosure is required under Florida Realtors AI policy guidance, FL SB 482, HUD fair housing guidelines, and Florida two-party recording consent law. Never skip it.",
  "",
  "---",
  "",
].join("\n");

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

async function patchSystemPrompt(id, label, preamble) {
  console.log(`\n→ ${label} (${id})`);
  const current = await fetchPersona(id);
  const currentPrompt = current.system_prompt || "";

  if (currentPrompt.includes("## AI DISCLOSURE & CONSENT")) {
    console.log("  ⚠ Disclosure section already present — skipping to avoid duplication");
    return;
  }

  const newPrompt = preamble + currentPrompt;
  console.log(
    `  current: ${currentPrompt.length} chars → new: ${newPrompt.length} chars (+${newPrompt.length - currentPrompt.length})`
  );

  try {
    const r = await patchPersona(id, [
      { op: "replace", path: "/system_prompt", value: newPrompt },
    ]);
    console.log("  ✓ PATCH status:", r && r.status ? r.status : "200");
  } catch (e) {
    console.error("  ✗ PATCH failed:", e.message.slice(0, 400));
    throw e;
  }

  // Verify
  const verify = await fetchPersona(id);
  const hasDisclosure = (verify.system_prompt || "").includes("## AI DISCLOSURE & CONSENT");
  console.log("  verify: disclosure present =", hasDisclosure);
  if (!hasDisclosure) {
    throw new Error("Disclosure did NOT land on persona after PATCH");
  }
}

async function main() {
  if (!process.env.TAVUS_API_KEY) {
    console.error("TAVUS_API_KEY missing");
    process.exit(1);
  }

  await patchSystemPrompt("p015ee7b4ab6", "Jordan", JORDAN_COMPLIANCE_PREAMBLE);
  await patchSystemPrompt("p4700c5f2722", "Aria", ARIA_COMPLIANCE_PREAMBLE);

  console.log("\n✅ Compliance preamble live on both personas");
}

main().catch((e) => {
  console.error("fatal:", e.message);
  process.exit(1);
});
