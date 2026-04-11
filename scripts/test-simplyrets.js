#!/usr/bin/env node
/**
 * Verify SimplyRETS sandbox credentials produce a real listing response.
 * Uses the same fetchListingContext() the realty conversation endpoint uses.
 */

require("dotenv").config();

const { fetchListingContext } = require("../realty/lib/rag");

async function main() {
  console.log("→ Fetching SimplyRETS sandbox listing 1000065...");
  const result = await fetchListingContext("1000065");
  console.log("  Address:", result.address || "(none)");
  console.log("  Context string:");
  console.log(result.contextString.split("\n").map((l) => "    " + l).join("\n"));
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
