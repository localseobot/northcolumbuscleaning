# Voice Agent — Phase 1 of AI-forward operations

A Retell AI-based voice receptionist for North Columbus Cleaning Company. Covers the line when the office manager is out of office, on another call, or after hours.

**Built around Quo (formerly OpenPhone) as the source of truth.** Every automated SMS flows through the Quo workspace number so customers and cleaners see one thread per contact — not a confusing split between the team inbox and a ghost automation number.

## What's in this folder

| File | Purpose |
|---|---|
| `SETUP.md` | Step-by-step to go from zero to live |
| `system-prompt.md` | The agent's full system prompt, human-readable |
| `knowledge-base.md` | Facts the agent can reference (services, pricing, areas, FAQs) |
| `retell-llm.json` | Importable Retell LLM config (prompt + tools) |
| `retell-agent.json` | Importable Retell Agent config (voice, webhook, post-call fields) |
| `zapier-recipes.md` | Zapier flows to connect to Booking Koala + Sheets + SMS |

And the server code lives outside this folder:

| File | Purpose |
|---|---|
| `/api/retell-webhook.js` | Post-call webhook — SMS recap via Quo API + forwards to Zapier |
| `/api/voice-agent/check-service-area.js` | Custom tool the agent calls mid-conversation to verify a zip |
| `/api/quo-webhook.js` | Inbound Quo events (scaffolded for Phase 2 — reply handling) |
| `/api/_lib/quo.js` | Shared Quo API helper (`sendSms`) used by every outbound flow |

## The gist

```
Caller dials your Quo main line
         │
         ▼
Quo call flow:
  ├─ Business hours (Mon–Sat 7am–7pm):
  │   ring team group 20s → if unanswered, forward to Retell
  └─ After hours:
      forward straight to Retell
         │
         ▼
Retell agent "Maya" takes the call
  ├── Uses knowledge base to answer questions
  ├── Collects quote details (name, phone, service, area, timing, notes)
  ├── Calls check_service_area() to verify zips
  ├── Transfers to human during business hours if asked
  └── Ends call
         │
         ▼
Retell POSTs end-of-call report to
  https://northcolumbuscleaning.com/api/retell-webhook
         │
         ├──► Quo API: SMS recap to manager's cell
         │      (lands in Quo's shared inbox — team sees it)
         │
         └──► Forward to Zapier
                  │
                  ├──► Booking Koala: new lead
                  ├──► Google Sheet: call log
                  └──► Email / Slack: team notification
```

## How to run this forward (after it's live)

- **Every call is logged.** Open the Google Sheet (Recipe 2) weekly. Skim transcripts. Tighten the prompt where the agent got confused.
- **Add new FAQs** to `knowledge-base.md` as customers ask things the agent didn't know.
- **New service areas** go in `api/voice-agent/check-service-area.js` (`SERVICE_ZIPS` dict) — same data that feeds the location pages.
- **The agent is deploy-on-push.** Update any file here, push to `main`, Vercel redeploys. Retell config changes are made in the Retell dashboard (or by re-importing the JSON).

## What's next (future phases)

Queued in the roadmap — not built yet:

2. **Cleaner SMS brain** — night-before job sheets, day-of check-ins, end-of-job logging
3. **Customer lifecycle** — post-job review ask, 14-day check-in, dormant re-engagement
4. **Intake AI** — website form → AI-drafted quote email within 2 minutes
5. **Persistent customer notes** — one-click "remember this" that follows the customer

All four sit on the same infrastructure pattern: Vercel API + Zapier + Quo SMS/API. Every automated message flows through the Quo number so the shared inbox stays the single source of truth for cleaner and customer communication. Booking Koala remains the source of truth for jobs, schedules, and invoicing.
