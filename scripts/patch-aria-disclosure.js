#!/usr/bin/env node
/**
 * Patch Aria's system_prompt on Tavus with the updated first-turn
 * disclosure that explicitly mentions video/voice analysis + no
 * biometric storage post-session (BIPA / EU AI Act compliance).
 */

require("dotenv").config();

const { patchPersona } = require("../shared/tavus-client");
const { config } = require("../realty/config/realty-config");

async function main() {
  const personaId = process.env.TAVUS_REALTY_PERSONA_ID;
  if (!personaId) {
    console.error("TAVUS_REALTY_PERSONA_ID not set");
    process.exit(1);
  }

  const payload = config.buildPersonaPayload();
  const systemPrompt = payload.system_prompt;

  console.log("Patching Aria system_prompt...");
  console.log("Disclosure snippet:", systemPrompt.substring(
    systemPrompt.indexOf('"Hi!'),
    systemPrompt.indexOf('Are you okay to continue?"') + 26
  ));

  try {
    const result = await patchPersona(personaId, [
      { op: "replace", path: "/system_prompt", value: systemPrompt },
    ]);
    if (result && result.not_modified) {
      console.log("304 Not Modified — already up to date");
    } else {
      console.log("✓ Aria disclosure updated on Tavus");
    }
  } catch (e) {
    console.error("✗ Failed:", e.message);
    process.exit(1);
  }
}

main();
