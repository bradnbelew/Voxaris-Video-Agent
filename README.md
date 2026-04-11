# Voxaris VideoAgent

Dual-vertical Tavus CVI (Conversational Video Interface) platform. One codebase, two products:

1. **Aria** — Real Estate Virtual Showing Agent. Buyers visit a listing page, talk face-to-face with Aria, and book property tours. Listing data is injected per session via SimplyRETS RAG.
2. **Jordan** — Staffing AI Video Interviewer. Candidates complete a structured EEOC-compliant pre-screening interview, and approved profiles route to a recruiter calendar via n8n.

Both agents are built from production JSON payloads following the Tavus Prompting Playbook, powered by **Phoenix-4** replicas (Anna Pro for Aria, Benjamin Office for Jordan), **tavus-harmony-3** LLM, **Cartesia** TTS, **Deepgram** STT, and **Raven-1** perception (visual + audio + end-of-call analysis).

---

## Architecture at a glance

```
/api
  /health.js                         GET   /health
  /realty
    /setup/index.js                  POST  /api/realty/setup        (one-time persona creation)
    /conversations/index.js          POST  /api/realty/conversations (start CVI session)
    /tools/index.js                  GET/POST /api/realty/tools      (poll + webhook router)
  /staffing
    /setup/index.js                  POST  /api/staffing/setup
    /conversations/index.js          POST  /api/staffing/conversations
    /tools/index.js                  GET/POST /api/staffing/tools

/shared
  /tavus-client.js                   Zero-dep Node https Tavus client
  /google-sheets.js                  Service-account JWT → Sheets v4
  /n8n-trigger.js                    Fire-and-forget n8n webhook POST

/realty
  /config/persona-prompt.md          Reference copy of Aria's system prompt
  /config/realty-config.js           Persona payload, objectives, guardrails, Raven-1 perception
  /lib/rag.js                        SimplyRETS fetch + context builder
  /lib/sheets-logger.js              Append to "Realty Sessions" tab

/staffing
  /config/persona-prompt.md          Reference copy of Jordan's system prompt
  /config/staffing-config.js         Persona payload, objectives, guardrails, Raven-1 perception
  /lib/role-context.js               Role-specific job briefs (warehouse, hospitality, healthcare, general)
  /lib/sheets-logger.js              Append to "Staffing Interviews" tab

/public
  /index.html                        Landing page with demo links
  /realty.html                       Aria full-viewport embed
  /staffing.html                     Jordan full-viewport embed

/vercel.json                         version 2, 30s maxDuration, CORS, rewrites
/package.json                        Only dependency: dotenv
/.env.example                        All env vars
```

### Session flow (both verticals)

1. Visitor loads `/realty?name=John&listing_id=MLS123` (or `/staffing?name=Maria&role=warehouse`)
2. Frontend POSTs to `/api/{vertical}/conversations`
3. Backend fetches RAG context (SimplyRETS listing data or role brief), builds greeting + `conversational_context`, calls `POST https://tavusapi.com/v2/conversations` with `persona_id`, `replica_id`, and the full `conversation_rules` block (objectives + guardrails + callback URL)
4. Tavus returns `{ conversation_id, conversation_url }` — the frontend embeds `conversation_url` in a camera/mic-enabled iframe
5. As Aria/Jordan complete objectives, Tavus fires **Format C objective callbacks** to `/api/{vertical}/tools` with `{ objective_name, output_variables, conversation_id }`
6. The tools endpoint ACKs with HTTP 200 immediately, then merges output variables into the Live Sessions sheet row via `putSession()`
7. On terminal objectives (`closing_confirmed` for both, plus `schedule_agent_call` for Aria), the router fires the corresponding n8n webhook
8. `conversation.ended` lifecycle events flush the final session to the per-vertical log tab (`Realty Sessions` / `Staffing Interviews`)
9. Raven-1 perception tool calls (`buyer_highly_interested`, `candidate_strong_signal`, etc.) surface client-side via Daily.js `app-message` → forwarded to the same webhook via `window.postMessage`

### Important Tavus API facts

- Auth: `x-api-key` header (NOT Bearer)
- Create conversation: `POST https://tavusapi.com/v2/conversations`
- PATCH persona: JSON Patch RFC 6902 (array of ops), `application/json-patch+json` content type
- LLM model: `tavus-harmony-3`
- STT: `deepgram`
- TTS: `cartesia` with `external_voice_id`
- Perception: `raven-1` (Raven-1 required for audio awareness)
- `apply_conversation_rules: true` in conversation properties activates objectives + guardrails
- Tool calls from Raven-1 perception are **not** executed by Tavus backend — they arrive on Daily.js `app-message` events and the client must forward them to your own webhook
- 1000 character limit per perception query string; audio analysis capped at 32 tokens per utterance
- ALWAYS `res.status(200).json({ ok: true })` first, then do async work — Tavus freezes the call if ACK is slow

---

## Setup sequence

### 1 · Install & link

```bash
cd voxaris-videoagent
npm install
npm i -g vercel
vercel login
vercel link
```

### 2 · Google Sheet setup (manual)

1. Create a new Google Sheet named **"Voxaris VideoAgent"**.
2. Create three tabs:
   - `Live Sessions`
   - `Realty Sessions`
   - `Staffing Interviews`
3. Add headers to row 1:
   - **Live Sessions**: `conversation_id | json_data | updated_at`
   - **Realty Sessions**: `Timestamp | Source | Buyer Name | Email | Phone | Listing ID | Interest Level | Top Priorities | Tour Booked | Preferred Date | Preferred Time | Visit Type | Main Concern | Conversation ID | Status`
   - **Staffing Interviews**: `Timestamp | Source | Full Name | Email | Phone | Role | Work Authorized | Years Exp | Skills | Shift Pref | Start Date | Profile Summary | Disqualified | Recruiter Call | Callback Time | Conversation ID | Status`
4. Create a Google Cloud **Service Account** → enable Google Sheets API → create a JSON key → download it.
5. From the JSON, copy `client_email` and `private_key` (keep the literal `\n` sequences intact — the client converts them at runtime).
6. Share the sheet with the service account's `client_email` as **Editor**.
7. Copy the sheet ID out of its URL (`docs.google.com/spreadsheets/d/<THIS_PART>/edit`).

### 3 · SimplyRETS setup

1. Create a free developer account at [simplyrets.com](https://simplyrets.com).
2. Grab the sandbox API key + secret (sandbox serves fake Orlando listings — perfect for demo).
3. Use listing ID `1000065` for demo walkthroughs.

### 4 · Pick replicas

The `.env.example` already has the recommended picks:

- **Aria** → `r90bbd427f71` (Anna Pro — Phoenix-4, warm and trustworthy)
- **Jordan** → `r1a4e22fa0d9` (Benjamin Office — professional B2B) or `r1af76e94d00` (Rose Office — female alt)

Both render via Phoenix-4 and honour `tts_emotion_control` micro-expressions.

### 5 · Push env vars to Vercel

```bash
vercel env add TAVUS_API_KEY production
vercel env add TAVUS_REALTY_REPLICA_ID production     # r90bbd427f71
vercel env add TAVUS_STAFFING_REPLICA_ID production   # r1a4e22fa0d9
vercel env add GOOGLE_SHEET_ID production
vercel env add GOOGLE_SERVICE_ACCOUNT_EMAIL production
vercel env add GOOGLE_PRIVATE_KEY production
vercel env add CARTESIA_API_KEY production
vercel env add CARTESIA_VOICE_ID_ARIA production
vercel env add CARTESIA_VOICE_ID_JORDAN production
vercel env add SIMPLYRETS_API_KEY production
vercel env add SIMPLYRETS_API_SECRET production
vercel env add N8N_TOUR_BOOKING_WEBHOOK production
vercel env add N8N_INTERVIEW_WEBHOOK production
vercel env add REALTY_BASE_URL production
vercel env add STAFFING_BASE_URL production
```

*Skip `TAVUS_REALTY_PERSONA_ID` and `TAVUS_STAFFING_PERSONA_ID` for now — you'll add them in step 7 after running setup.*

### 6 · First deploy

```bash
vercel --prod --yes
curl https://your-domain.vercel.app/health
```

Expect `env.tavus_api_key: true`, `env.google_sheets: true`, but `env.tavus_realty: false` (no persona yet).

### 7 · Create both personas

```bash
curl -X POST https://your-domain.vercel.app/api/realty/setup
# → copy persona_id into vercel env: TAVUS_REALTY_PERSONA_ID

curl -X POST https://your-domain.vercel.app/api/staffing/setup
# → copy persona_id into vercel env: TAVUS_STAFFING_PERSONA_ID

vercel env add TAVUS_REALTY_PERSONA_ID production
vercel env add TAVUS_STAFFING_PERSONA_ID production
vercel --prod --yes
curl https://your-domain.vercel.app/health   # both tavus_realty + tavus_staffing should now be true
```

### 8 · Smoke test

```
https://your-domain.vercel.app/realty?name=Test+Buyer&listing_id=1000065
https://your-domain.vercel.app/staffing?name=Test+Candidate&role=hospitality
```

---

## Local dev

```bash
cp .env.example .env
# fill in TAVUS_API_KEY, sheet creds, etc.
vercel dev
```

Hit the endpoints:

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/realty/conversations \
  -H "Content-Type: application/json" \
  -d '{"visitor_name":"Ethan","listing_id":"1000065","source":"local"}'
```

---

## n8n workflows

### Workflow 1 — Real Estate Tour Booking

Triggered on Aria's `schedule_agent_call` objective completion.

1. **Webhook** — POST path `/book-tour`. Copy the Production URL → `N8N_TOUR_BOOKING_WEBHOOK`.
2. **Set** — extract: `buyer_name`, `buyer_email`, `buyer_phone`, `listing_id`, `listing_address`, `preferred_date`, `preferred_time`, `tour_type`, `conversation_id`.
3. **Google Calendar → Create Event**
   - Title: `Property Tour — {{listing_address}} with {{buyer_name}}`
   - Start: derived from `preferred_date` + `preferred_time`
   - Duration: 1 hour
   - Attendees: `{{buyer_email}}` + agent calendar
   - Description: full buyer profile from the n8n input
4. **Gmail (Buyer)** — subject: `Your property tour is confirmed!`, body: date, time, address, meeting location.
5. **Gmail (Agent)** — subject: `New tour booked — {{listing_id}}`, body: full buyer profile.
6. **Respond to Webhook** — `{ success: true }`.

### Workflow 2 — Staffing Recruiter Routing

Triggered on Jordan's `closing_confirmed` or `end_screening_ineligible` objective.

1. **Webhook** — POST path `/route-candidate`. Copy URL → `N8N_INTERVIEW_WEBHOOK`.
2. **IF** — `disqualified === false` AND `work_authorized === true`.
3. **Branch PASS**:
   - **Google Calendar → Create Event**: `Recruiter Call — {{full_name}} for {{applied_role}}`, time from `preferred_callback_time`, attendee = candidate email
   - **Gmail (Candidate)**: "Your interview is complete! A recruiter will call you on [date/time]…"
   - **Gmail (Recruiter)**: full structured candidate profile
4. **Branch FAIL**:
   - **Gmail (Candidate)**: polite rejection (work authorization required)
5. **Respond to Webhook** — `{ success: true }`.

---

## Webhook data flow reference

The `/api/{vertical}/tools` router handles four payload shapes:

| Format | Shape | Source |
|---|---|---|
| A (legacy tool call) | `{ tool_name, tool_call_id, conversation_id, parameters }` | Direct tool definitions or perception forwards from the frontend |
| B (lifecycle event) | `{ event_type: "conversation.ended", conversation_id, properties }` | Tavus callback URL |
| C (objective callback) | `{ objective_name, output_variables, conversation_id }` | Tavus when `apply_conversation_rules: true` |
| D (guardrail trigger) | `{ guardrail_name, conversation_id, ... }` | Tavus callback URL |

Format C is the primary data flow for both agents. Format A is kept for backwards compatibility and for forwarding Raven-1 perception tool calls from the browser.

---

## Raven-1 perception (both agents)

Both personas ship with a full Raven-1 perception layer:

- **`visual_awareness_queries`** — run ~once per second, feed into LLM context as `user_visual_analysis`
- **`audio_awareness_queries`** — run per utterance, feed into LLM context as `user_audio_analysis` (capped at 32 tokens per answer — keep queries focused)
- **`perception_analysis_queries`** — fire once at end of call, returned in `application.perception_analysis` webhook for recruiter/agent audit
- **`visual_tools` / `audio_tools`** — Raven-emitted function calls for high-signal moments (buyer hot, candidate strong, disengaged, distressed, etc.)

Tavus **does not** execute perception tool calls on the backend. The frontend listens for `conversation.tool_call` events via `window.postMessage` (Daily.js `app-message` bridge) and forwards them to `/api/{vertical}/tools` as Format A payloads.

---

## Execution rules baked into the code

1. Every tool-call handler ACKs with HTTP 200 before doing async work — Tavus freezes the call if ACK is slow.
2. `conversation_url` is embedded in an iframe with `allow="camera; microphone; autoplay; display-capture; fullscreen"` — without that the Daily.co room black-boxes.
3. Persona creation is one-time. After `POST /api/{vertical}/setup`, copy `persona_id` into env and redeploy.
4. Google service-account JWTs are RS256 signed in-process, exchanged at `oauth2.googleapis.com/token`, and cached 60s before expiry.
5. `putSession()` upserts by scanning column A of "Live Sessions" and falling back to append.
6. SimplyRETS fetch is best-effort — if it fails, a fallback context string is injected so the session still works.
7. All secrets are environment variables. Never commit `.env`.
