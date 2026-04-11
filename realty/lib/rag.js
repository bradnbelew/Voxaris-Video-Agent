/**
 * Realty RAG context builder.
 *
 * Phase 1 (MVP): SimplyRETS API — fetches a single listing by MLS number.
 *                Auth: HTTP Basic base64(SIMPLYRETS_API_KEY:SIMPLYRETS_API_SECRET)
 *                Sandbox base URL: https://api.simplyrets.com/properties/{mlsId}
 *                Demo listing ID: 1000065
 *
 * Phase 2: Vector DB query (Pinecone/MongoDB). Wire in when pipeline is built.
 *
 * Exports:
 *   fetchListingContext(listingId) → { contextString, listing, address }
 */

const https = require("https");

const SIMPLYRETS_HOST = "api.simplyrets.com";

function basicAuthHeader() {
  const key = process.env.SIMPLYRETS_API_KEY || "";
  const secret = process.env.SIMPLYRETS_API_SECRET || "";
  if (!key || !secret) return null;
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

function simplyGet(path) {
  return new Promise((resolve, reject) => {
    const auth = basicAuthHeader();
    if (!auth) {
      resolve(null);
      return;
    }
    const req = https.request(
      {
        host: SIMPLYRETS_HOST,
        path,
        method: "GET",
        headers: {
          Authorization: auth,
          Accept: "application/json",
          "User-Agent": "voxaris-videoagent/1.0",
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.end();
  });
}

async function fetchFromSimplyRETS(mlsId) {
  if (!mlsId) {
    // No ID given — return the first listing from the sandbox so demos
    // always have real data to talk about.
    const list = await simplyGet("/properties?limit=1");
    if (Array.isArray(list) && list.length > 0) return list[0];
    return null;
  }
  const encoded = encodeURIComponent(String(mlsId));
  const direct = await simplyGet(`/properties/${encoded}`);
  if (direct) return direct;
  // Fallback: if the requested ID isn't in the sandbox, return the first
  // listing anyway so the demo never shows an empty context.
  const list = await simplyGet("/properties?limit=1");
  if (Array.isArray(list) && list.length > 0) return list[0];
  return null;
}

/**
 * Build a clean RAG context string from a SimplyRETS listing object.
 * Shape of the listing follows SimplyRETS sandbox schema.
 */
function buildContextString(listing) {
  if (!listing) return null;
  const addr = listing.address || {};
  const streetLine =
    [addr.streetNumber, addr.streetName, addr.unit].filter(Boolean).join(" ") ||
    "Address unavailable";
  const cityLine = [addr.city, addr.state, addr.postalCode]
    .filter(Boolean)
    .join(", ");
  const fullAddress = cityLine ? `${streetLine}, ${cityLine}` : streetLine;

  const property = listing.property || {};
  const school = listing.school || {};
  const priceFormatted =
    typeof listing.listPrice === "number"
      ? "$" + listing.listPrice.toLocaleString("en-US")
      : "Not disclosed";

  const beds = property.bedrooms || "—";
  const bathsFull = property.bathsFull || 0;
  const bathsHalf = property.bathsHalf || 0;
  const baths =
    bathsFull || bathsHalf
      ? `${bathsFull}${bathsHalf ? "." + bathsHalf : ""}`
      : "—";
  const sqft = property.area
    ? property.area.toLocaleString("en-US")
    : "—";
  const yearBuilt = property.yearBuilt || "—";
  const hoa =
    typeof listing.association?.fee === "number"
      ? "$" + listing.association.fee + "/" + (listing.association.frequency || "mo")
      : "None listed";
  const garage = property.garageSpaces ? `${property.garageSpaces}-car` : "—";

  const mls = listing.mlsId || listing.listingId || "—";
  const remarks = listing.remarks || "No listing remarks provided.";
  const schoolDistrict =
    school.district || school.elementarySchool || "Verify with district";

  const agent = listing.agent || {};
  const agentLine = agent.firstName
    ? `${agent.firstName} ${agent.lastName || ""}`.trim()
    : "Listing brokerage";

  return [
    "LISTING DATA (RAG INJECTED):",
    `- Address: ${fullAddress}`,
    `- List Price: ${priceFormatted}`,
    `- Beds: ${beds} | Baths: ${baths} | Sqft: ${sqft}`,
    `- Year Built: ${yearBuilt}`,
    `- HOA: ${hoa}`,
    `- Garage: ${garage}`,
    `- School Zone: ${schoolDistrict} (verify with district directly)`,
    `- MLS#: ${mls}`,
    `- Listing Remarks: ${remarks}`,
    `- Listing Agent: ${agentLine}`,
    "",
    "Use ONLY the above data as the source of truth. Do not invent comparable sales, school rankings, or neighborhood statistics. If asked something not covered, acknowledge the gap and offer to connect the buyer with the listing agent.",
  ].join("\n");
}

function buildFallbackContext(listingId) {
  return [
    `LISTING DATA (RAG INJECTED):`,
    `- Inquiry for MLS #${listingId || "unknown"}`,
    `- Detailed listing data is unavailable right now.`,
    "",
    "Focus on general questions about the home-buying process, the neighborhood at a high level, and offer to connect the buyer with the listing agent for specifics. Do not invent property details.",
  ].join("\n");
}

function extractAddress(listing) {
  if (!listing || !listing.address) return null;
  const a = listing.address;
  const street = [a.streetNumber, a.streetName, a.unit]
    .filter(Boolean)
    .join(" ");
  const city = [a.city, a.state, a.postalCode].filter(Boolean).join(", ");
  return [street, city].filter(Boolean).join(", ") || null;
}

/**
 * Build a room-keyed photo map for the virtual tour UI.
 *
 * SimplyRETS returns `listing.photos` as a flat array of URLs — no room
 * labels. We use simple index-based mapping as a pragmatic default. Keys
 * are only included if the corresponding index exists in the photos array;
 * we never emit broken URLs.
 *
 *   hero             → photos[0]               (always present if any photo)
 *   exterior         → photos[last] or [1]      (second photo or the last one)
 *   kitchen          → photos[2]
 *   living_room      → photos[3]
 *   primary_bedroom  → photos[4]
 *   bathroom         → photos[5]
 *   all              → full photos array
 *
 * SANDBOX ENRICHMENT: SimplyRETS trial data only ships 2 photos per listing
 * (home{N}.jpg + home-inside-{N}.jpg), which is not enough to demo a
 * virtual tour with room navigation. When we detect the trial URL pattern
 * we enrich the map with additional known-good stock URLs from the same
 * CDN so every room key is populated. This enrichment is a no-op on real
 * MLS data from paying clients.
 */
const SANDBOX_CDN = "s3-us-west-2.amazonaws.com/cdn.simplyrets.com/properties/trial";
const SANDBOX_INSIDE = (n) => `https://${SANDBOX_CDN}/home-inside-${n}.jpg`;
const SANDBOX_OUTSIDE = (n) => `https://${SANDBOX_CDN}/home${n}.jpg`;

function isSandboxListing(photos) {
  if (!photos || photos.length === 0) return false;
  return photos[0].includes(SANDBOX_CDN);
}

function buildPhotoMap(listing) {
  const photos = Array.isArray(listing && listing.photos) ? listing.photos : [];
  if (photos.length === 0) return { all: [] };

  const map = { all: [...photos] };
  map.hero = photos[0];

  if (photos.length >= 2) {
    // Prefer last photo as exterior shot; fall back to index 1 for tiny sets.
    map.exterior = photos[photos.length - 1] || photos[1];
  }
  if (photos.length > 2) map.kitchen = photos[2];
  if (photos.length > 3) map.living_room = photos[3];
  if (photos.length > 4) map.primary_bedroom = photos[4];
  if (photos.length > 5) map.bathroom = photos[5];

  // Sandbox enrichment — supplement with stock URLs when running against the
  // SimplyRETS trial feed so the virtual tour feature is actually demoable.
  if (isSandboxListing(photos)) {
    const stockKitchen = SANDBOX_INSIDE(2);
    const stockLiving = SANDBOX_INSIDE(4);
    const stockBedroom = SANDBOX_INSIDE(6);
    const stockBath = SANDBOX_INSIDE(8);
    const stockExterior2 = SANDBOX_OUTSIDE(3);

    if (!map.kitchen) map.kitchen = stockKitchen;
    if (!map.living_room) map.living_room = stockLiving;
    if (!map.primary_bedroom) map.primary_bedroom = stockBedroom;
    if (!map.bathroom) map.bathroom = stockBath;
    // In sandbox mode the "exterior" slot may have picked up an inside shot
    // because every listing only has 2 photos (home{N}.jpg + home-inside-{N}.jpg).
    // Force it to a known outside stock image.
    if (!map.exterior || /home-inside/.test(map.exterior)) {
      map.exterior = stockExterior2;
    }

    // Backfill `all` so the gallery strip has more variety.
    const enrichedAll = new Set(map.all);
    [
      map.hero,
      map.kitchen,
      map.living_room,
      map.primary_bedroom,
      map.bathroom,
      map.exterior,
      SANDBOX_OUTSIDE(5),
      SANDBOX_INSIDE(10),
    ]
      .filter(Boolean)
      .forEach((u) => enrichedAll.add(u));
    map.all = Array.from(enrichedAll);
  }

  return map;
}

async function fetchListingContext(listingId) {
  const listing = await fetchFromSimplyRETS(listingId);
  if (!listing) {
    return {
      contextString: buildFallbackContext(listingId),
      listing: null,
      address: null,
      photoMap: { all: [] },
    };
  }
  return {
    contextString: buildContextString(listing),
    listing,
    address: extractAddress(listing),
    photoMap: buildPhotoMap(listing),
  };
}

module.exports = { fetchListingContext };
