/**
 * Tavus API Client — zero-dependency Node https wrapper
 *
 * Auth: x-api-key header (NOT Bearer).
 * Base URL: https://tavusapi.com/v2
 *
 * Exposes:
 *   createConversation({ greeting, context, conversationName, callbackUrl,
 *                        language, personaId, replicaId, properties })
 *   endConversation(conversationId)
 *   sendToolResult(conversationId, toolCallId, result)
 *   createPersona(personaData)
 *   updatePersona(personaId, patchOps)   // JSON Patch RFC 6902 (array of ops)
 *   listReplicas()
 *   listPersonas()
 *
 * IMPORTANT: personaId and replicaId are passed per-call because this app
 * hosts TWO personas (realty + staffing) behind the same client.
 */

const https = require("https");

const TAVUS_HOST = "tavusapi.com";
const TAVUS_BASE_PATH = "/v2";

function getApiKey() {
  const key = process.env.TAVUS_API_KEY;
  if (!key) throw new Error("TAVUS_API_KEY is not set");
  return key;
}

/**
 * Low-level HTTPS request helper.
 * Supports GET, POST, PATCH, DELETE. Handles JSON bodies and JSON Patch for PATCH.
 */
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      "x-api-key": getApiKey(),
      Accept: "application/json",
    };
    if (payload) {
      headers["Content-Type"] =
        method === "PATCH" ? "application/json-patch+json" : "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }

    const options = {
      host: TAVUS_HOST,
      path: `${TAVUS_BASE_PATH}${path}`,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
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
        // 304 Not Modified is a success — Tavus returns it on PATCH when the
        // persona state already matches the requested ops.
        if ((status >= 200 && status < 300) || status === 304) {
          resolve(parsed || { status, not_modified: status === 304 });
        } else {
          const err = new Error(
            `Tavus ${method} ${path} failed ${status}: ${raw || "<empty>"}`
          );
          err.status = status;
          err.body = parsed;
          reject(err);
        }
      });
    });

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Create a new Tavus conversation (CVI session).
 * Returns { conversation_id, conversation_url, status, ... }.
 */
async function createConversation({
  greeting,
  context,
  conversationName,
  callbackUrl,
  language = "multilingual",
  personaId,
  replicaId,
  properties = {},
}) {
  if (!personaId) throw new Error("createConversation: personaId is required");
  if (!replicaId) throw new Error("createConversation: replicaId is required");

  const body = {
    persona_id: personaId,
    replica_id: replicaId,
    conversation_name: conversationName || "Voxaris VideoAgent Session",
    custom_greeting: greeting || undefined,
    conversational_context: context || undefined,
    callback_url: callbackUrl || undefined,
    properties: {
      max_call_duration: 900,
      enable_transcription: true,
      enable_recording: false,
      enable_closed_captions: true,
      language,
      ...properties,
    },
  };

  return request("POST", "/conversations", body);
}

async function endConversation(conversationId) {
  if (!conversationId) throw new Error("endConversation: conversationId is required");
  return request("POST", `/conversations/${conversationId}/end`);
}

/**
 * Send a tool call result back to Tavus. MUST be called within ~5s of
 * receiving the tool call or Tavus will freeze the conversation.
 */
async function sendToolResult(conversationId, toolCallId, result) {
  if (!conversationId) throw new Error("sendToolResult: conversationId required");
  if (!toolCallId) throw new Error("sendToolResult: toolCallId required");
  return request("POST", `/conversations/${conversationId}/tool_result`, {
    tool_call_id: toolCallId,
    result,
  });
}

async function createPersona(personaData) {
  return request("POST", "/personas", personaData);
}

/**
 * Update an existing persona using JSON Patch (RFC 6902).
 * patchOps example: [{ op: "replace", path: "/system_prompt", value: "..." }]
 */
async function updatePersona(personaId, patchOps) {
  if (!personaId) throw new Error("updatePersona: personaId required");
  if (!Array.isArray(patchOps)) throw new Error("updatePersona: patchOps must be an array");
  return request("PATCH", `/personas/${personaId}`, patchOps);
}

/**
 * PATCH a persona using JSON Patch (RFC 6902). This is an alias-style wrapper
 * around the existing low-level request() helper to match the naming used by
 * the patch-persona endpoints. Sends:
 *   PATCH https://tavusapi.com/v2/personas/{personaId}
 *   Content-Type: application/json-patch+json
 *   x-api-key: process.env.TAVUS_API_KEY
 *   Body: JSON.stringify(jsonPatchArray)
 *
 * jsonPatchArray example:
 *   [{ op: "add", path: "/layers/perception", value: {...} }]
 *
 * Returns parsed response. Throws on non-2xx with raw body in the message.
 */
async function patchPersona(personaId, jsonPatchArray) {
  if (!personaId) throw new Error("patchPersona: personaId required");
  if (!Array.isArray(jsonPatchArray))
    throw new Error("patchPersona: jsonPatchArray must be an array");
  return request("PATCH", `/personas/${personaId}`, jsonPatchArray);
}

async function listReplicas() {
  return request("GET", "/replicas");
}

async function listPersonas() {
  return request("GET", "/personas");
}

module.exports = {
  createConversation,
  endConversation,
  sendToolResult,
  createPersona,
  updatePersona,
  patchPersona,
  listReplicas,
  listPersonas,
};
