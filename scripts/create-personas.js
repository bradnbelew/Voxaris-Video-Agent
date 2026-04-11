#!/usr/bin/env node
/**
 * One-shot script to create both personas on Tavus and print their IDs.
 * Run once after setting TAVUS_API_KEY + replica IDs in .env.
 *
 * Usage: node scripts/create-personas.js
 */

require("dotenv").config();

const { createPersona } = require("../shared/tavus-client");
const { config: realtyConfig } = require("../realty/config/realty-config");
const { config: staffingConfig } = require("../staffing/config/staffing-config");

async function main() {
  if (!process.env.TAVUS_API_KEY) {
    console.error("TAVUS_API_KEY missing from .env");
    process.exit(1);
  }

  console.log("→ Creating Aria persona...");
  try {
    const aria = await createPersona(realtyConfig.buildPersonaPayload());
    console.log("  ✓ Aria persona_id:", aria.persona_id || aria.id);
    console.log("    full response:", JSON.stringify(aria, null, 2));
  } catch (e) {
    console.error("  ✗ Aria failed:", e.message);
    if (e.body) console.error("    body:", JSON.stringify(e.body, null, 2));
  }

  console.log("\n→ Creating Jordan persona...");
  try {
    const jordan = await createPersona(staffingConfig.buildPersonaPayload());
    console.log("  ✓ Jordan persona_id:", jordan.persona_id || jordan.id);
    console.log("    full response:", JSON.stringify(jordan, null, 2));
  } catch (e) {
    console.error("  ✗ Jordan failed:", e.message);
    if (e.body) console.error("    body:", JSON.stringify(e.body, null, 2));
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
