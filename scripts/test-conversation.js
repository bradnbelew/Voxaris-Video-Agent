#!/usr/bin/env node
/**
 * End-to-end sanity check: create a real Tavus conversation for both agents.
 * Prints the conversation_url — open it in a browser to talk to the agent.
 */

require("dotenv").config();

const https = require("https");
const { config: realtyConfig } = require("../realty/config/realty-config");
const { config: staffingConfig } = require("../staffing/config/staffing-config");

function tavusCreate(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        host: "tavusapi.com",
        path: "/v2/conversations",
        method: "POST",
        headers: {
          "x-api-key": process.env.TAVUS_API_KEY,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
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
            reject(new Error(`${res.statusCode}: ${raw}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const callbackUrl = "https://example.com/api/realty/tools";

  const { apply_conversation_rules, ...safeRealtyProps } =
    realtyConfig.conversationDefaults;
  const { apply_conversation_rules: _s, ...safeStaffingProps } =
    staffingConfig.conversationDefaults;

  console.log("→ Creating Aria conversation (minimal)...");
  try {
    const body = {
      persona_id: realtyConfig.personaId,
      replica_id: realtyConfig.replicaId,
      conversation_name: "Aria test",
      custom_greeting:
        "Hey! I'm Aria, ready to walk you through this home. Test session.",
      conversational_context:
        "LISTING DATA (test injection):\n- Address: 123 Test Ln, Orlando FL\n- Price: $450,000\n- Beds: 3 | Baths: 2 | Sqft: 1,800",
      callback_url: callbackUrl,
      properties: safeRealtyProps,
    };
    const r = await tavusCreate(body);
    console.log("  ✓ conversation_id:", r.conversation_id);
    console.log("  ✓ conversation_url:", r.conversation_url);
  } catch (e) {
    console.error("  ✗ Aria failed:", e.message);
  }

  console.log("\n→ Creating Jordan conversation (minimal)...");
  try {
    const body = {
      persona_id: staffingConfig.personaId,
      replica_id: staffingConfig.replicaId,
      conversation_name: "Jordan test",
      custom_greeting:
        "Hey! I'm Jordan. Quick pre-screening test session. Sound good?",
      conversational_context:
        "JOB DETAILS:\n- Role: Banquet Server\n- Pay: $18-$21/hr\n- Shift: Evenings/weekends",
      callback_url: "https://example.com/api/staffing/tools",
      properties: safeStaffingProps,
    };
    const r = await tavusCreate(body);
    console.log("  ✓ conversation_id:", r.conversation_id);
    console.log("  ✓ conversation_url:", r.conversation_url);
  } catch (e) {
    console.error("  ✗ Jordan failed:", e.message);
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
