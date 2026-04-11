/**
 * Google Sheets v4 client — zero-dependency.
 *
 * Auth flow: RS256 JWT (signed with service account private key) →
 *            exchange for OAuth Bearer token at https://oauth2.googleapis.com/token
 *            → cached until 60s before expiry.
 *
 * Exposes:
 *   getAccessToken()                     → Bearer token, cached
 *   putSession(conversationId, data)     → upsert row in "Live Sessions" tab
 *   getSession(conversationId)           → read JSON from "Live Sessions" tab
 *   appendRow(tabName, valuesArray)      → append row to any tab
 *
 * Schema of "Live Sessions" tab:
 *   A = conversation_id
 *   B = json_data (full session object, stringified)
 *   C = updated_at (ISO timestamp)
 *
 * Required env vars:
 *   GOOGLE_SHEET_ID
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY  (literal "\n" sequences will be converted)
 */

const https = require("https");
const crypto = require("crypto");

const LIVE_TAB = "Live Sessions";
const SHEETS_HOST = "sheets.googleapis.com";
const OAUTH_HOST = "oauth2.googleapis.com";

let cachedToken = null; // { token, expiresAt }

function getPrivateKey() {
  const raw = process.env.GOOGLE_PRIVATE_KEY;
  if (!raw) throw new Error("GOOGLE_PRIVATE_KEY is not set");
  return raw.replace(/\\n/g, "\n");
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Sign a JWT with RS256 using the service account private key.
 */
function signJwt() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL is not set");

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaim = base64UrlEncode(JSON.stringify(claim));
  const signingInput = `${encodedHeader}.${encodedClaim}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(getPrivateKey());
  const encodedSignature = base64UrlEncode(signature);

  return { jwt: `${signingInput}.${encodedSignature}`, exp };
}

function httpsRequest(host, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body
      ? typeof body === "string"
        ? body
        : JSON.stringify(body)
      : null;
    const allHeaders = { ...headers };
    if (payload) allHeaders["Content-Length"] = Buffer.byteLength(payload);

    const req = https.request(
      { host, path, method, headers: allHeaders },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          const status = res.statusCode || 0;
          let parsed = null;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = { raw };
            }
          }
          if (status >= 200 && status < 300) {
            resolve(parsed);
          } else {
            const err = new Error(
              `Google ${method} ${host}${path} failed ${status}: ${raw || "<empty>"}`
            );
            err.status = status;
            err.body = parsed;
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Return a cached OAuth Bearer token, exchanging a fresh JWT when needed.
 * Cache refreshes 60 seconds before expiry.
 */
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) {
    return cachedToken.token;
  }
  const { jwt, exp } = signJwt();
  const body =
    "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" +
    encodeURIComponent(jwt);
  const res = await httpsRequest(
    OAUTH_HOST,
    "/token",
    "POST",
    { "Content-Type": "application/x-www-form-urlencoded" },
    body
  );
  if (!res || !res.access_token) {
    throw new Error("Google OAuth: missing access_token in response");
  }
  cachedToken = {
    token: res.access_token,
    expiresAt: exp,
  };
  return cachedToken.token;
}

function getSheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID is not set");
  return id;
}

async function sheetsGet(path) {
  const token = await getAccessToken();
  return httpsRequest(SHEETS_HOST, path, "GET", {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  });
}

async function sheetsPost(path, body) {
  const token = await getAccessToken();
  return httpsRequest(
    SHEETS_HOST,
    path,
    "POST",
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body
  );
}

async function sheetsPut(path, body) {
  const token = await getAccessToken();
  return httpsRequest(
    SHEETS_HOST,
    path,
    "PUT",
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body
  );
}

/**
 * Append a row to any named tab.
 * tabName is auto URL-encoded; values is an array of cell values.
 */
async function appendRow(tabName, values) {
  const sheetId = getSheetId();
  const range = encodeURIComponent(`${tabName}!A:Z`);
  const path =
    `/v4/spreadsheets/${sheetId}/values/${range}` +
    `:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  return sheetsPost(path, { values: [values] });
}

/**
 * Upsert a row in "Live Sessions".
 * Finds existing row by conversation_id in column A, updates in place.
 * Otherwise appends a new row.
 */
async function putSession(conversationId, data) {
  if (!conversationId) throw new Error("putSession: conversationId required");
  const sheetId = getSheetId();
  const tab = LIVE_TAB;
  const json = JSON.stringify(data || {});
  const updatedAt = new Date().toISOString();

  // 1) Load column A to find the row index (1-based) of this conversation
  const readRange = encodeURIComponent(`${tab}!A:A`);
  const read = await sheetsGet(
    `/v4/spreadsheets/${sheetId}/values/${readRange}`
  );
  const rows = (read && read.values) || [];

  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i][0] === conversationId) {
      rowIndex = i + 1; // 1-based
      break;
    }
  }

  if (rowIndex > 0) {
    // Update existing row A:C
    const writeRange = encodeURIComponent(`${tab}!A${rowIndex}:C${rowIndex}`);
    const path = `/v4/spreadsheets/${sheetId}/values/${writeRange}?valueInputOption=RAW`;
    return sheetsPut(path, { values: [[conversationId, json, updatedAt]] });
  }

  // Append new row
  const appendPath =
    `/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
      `${tab}!A:C`
    )}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  return sheetsPost(appendPath, {
    values: [[conversationId, json, updatedAt]],
  });
}

/**
 * Read a session object from "Live Sessions" by conversation_id.
 * Returns the parsed object or null if not found.
 */
async function getSession(conversationId) {
  if (!conversationId) throw new Error("getSession: conversationId required");
  const sheetId = getSheetId();
  const tab = LIVE_TAB;
  const readRange = encodeURIComponent(`${tab}!A:C`);
  const read = await sheetsGet(
    `/v4/spreadsheets/${sheetId}/values/${readRange}`
  );
  const rows = (read && read.values) || [];
  for (const row of rows) {
    if (row && row[0] === conversationId) {
      const json = row[1] || "{}";
      try {
        return JSON.parse(json);
      } catch {
        return null;
      }
    }
  }
  return null;
}

module.exports = {
  getAccessToken,
  putSession,
  getSession,
  appendRow,
};
