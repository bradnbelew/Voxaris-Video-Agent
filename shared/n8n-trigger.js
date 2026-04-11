/**
 * n8n webhook trigger — fire-and-forget POST to any n8n webhook URL.
 * Returns { ok: true, status } on success, { ok: false, error } on failure.
 * Never throws — caller can fire this without try/catch.
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");

async function triggerN8n(webhookUrl, payload) {
  if (!webhookUrl) {
    return { ok: false, error: "triggerN8n: webhookUrl is empty" };
  }

  let parsed;
  try {
    parsed = new URL(webhookUrl);
  } catch (e) {
    return { ok: false, error: `Invalid webhook URL: ${e.message}` };
  }

  const body = JSON.stringify(payload || {});
  const isHttps = parsed.protocol === "https:";
  const lib = isHttps ? https : http;

  const options = {
    host: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: `${parsed.pathname}${parsed.search}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      Accept: "application/json",
    },
  };

  return new Promise((resolve) => {
    const req = lib.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) {
          resolve({ ok: true, status, body: raw });
        } else {
          resolve({
            ok: false,
            status,
            error: `n8n webhook returned ${status}: ${raw || "<empty>"}`,
          });
        }
      });
    });
    req.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });
    req.write(body);
    req.end();
  });
}

module.exports = { triggerN8n };
