# Taylor — North Columbus Cleaning voice agent

The operator's handbook. Updated for the GHL-native architecture.

## What Taylor does

Picks up inbound calls when the team is busy or out. She:

1. **Greets** the caller warmly.
2. **Looks them up in GHL** by phone — if they're an existing customer, she greets them by name and skips redundant intake.
3. **Collects intake details** for the team to quote and schedule: name, callback phone (read back digit-by-digit), email (read back letter-by-letter), full service address, service type, beds, baths, sqft, frequency, special notes.
4. **Asks** for a preferred callback time and whether texting is OK.
5. **Closes** with "Our team will reach out shortly to confirm pricing and find a time" — explicitly does not quote a price.
6. **Answers FAQ-style questions** from the knowledge base (supplies, insurance, scheduling, etc.).

## What Taylor won't do

- Quote a price out loud (pricing is intentionally handled by the team)
- Book or confirm a date/time
- Take payment info
- Promise refunds, discounts, or make-goods
- Pretend to be human (asks → "I'm Taylor, the AI assistant")

## Call flow

```
Customer dials GHL number
   │
   ▼
GHL workflow forwards to Taylor's Retell number (+1 614 762 9409)
   │
   ▼
Taylor runs the conversation flow (conversation_flow_957a14980504):
  Welcome → Extract Intent → (quote path | FAQ path | clarify)
                                  │
                                  ▼
                          Collect Intake (calls lookup_contact + check_service_area)
                                  │
                                  ▼
                          Wrap Up (ask callback time + SMS consent)
                                  │
                                  ▼
                          End Call
   │
   ▼
Retell analyzes the call (~30s), extracts 20 structured fields
   │
   ▼
POST /api/retell-webhook
   ├─ Upsert contact in GHL (matched by phone)
   ├─ Apply tags: source:maya, inbound-call, intent:*, service:*,
   │  frequency:*, sms-consent:*, plus existing-customer / needs-review
   ├─ Add contact note (summary, sentiment, callback window, recording URL)
   ├─ Create Sales Pipeline → New Lead opportunity (booking/quote intents)
   ├─ Auto-text caller from GHL number (if sms_consent === "yes")
   └─ Text manager recap to MANAGER_PHONE from GHL number
```

## Key IDs (for reference)

See [`retell-ids.json`](./retell-ids.json). Currently:

- **Retell agent**: `agent_c89977a01e7c6a1951e4802c8d` ("Taylor (NCC v2)")
- **Conversation flow**: `conversation_flow_957a14980504`
- **Phone number**: `+16147629409` (Columbus area; assign to Taylor in Retell when ready)
- **Webhook URL**: `https://www.northcolumbuscleaning.com/api/retell-webhook`
- **GHL location**: `XIA5AmegWaylDoPVe3r8` (sub-account, A2P-verified)
- **Sales Pipeline**: `6YDehH2kNtHrdfJaEQfa`
- **Knowledge base**: `knowledge_base_95f9bc18b5d768a5` (sourced from `faq.md`)

## Tools Taylor uses

| Tool | Fires when | Vercel route |
|---|---|---|
| `lookup_contact` | Right after the caller gives their phone number | `/api/voice-agent/lookup-contact` |
| `check_service_area` | Caller mentions a zip code | `/api/voice-agent/check-service-area` |

## Tags in GHL

Auto-applied by the webhook based on Taylor's post-call analysis:

| Group | Tags |
|---|---|
| Source | `source:maya`, `inbound-call` |
| Intent | `intent:booking`, `intent:quote`, `intent:complaint`, `intent:reschedule` |
| Service | `service:residential`, `service:commercial`, `service:deep-clean`, `service:move-in-out`, `service:post-construction` |
| Frequency | `frequency:one-time`, `frequency:weekly`, `frequency:biweekly`, `frequency:monthly` |
| Consent | `sms-consent:yes`, `sms-consent:no` |
| Status | `existing-customer`, `needs-review`, `hot lead`, `vip-client`, `do-not-contact` |
| Internal | `internal:manager` (the recap-SMS recipient contact) |

## Day-to-day operations

### Adding an FAQ entry

1. Edit `voice-agent/faq.md` (append a new Q+A in the existing style).
2. Re-upload to Retell → Knowledge Bases → `knowledge_base_95f9bc18b5d768a5` → upload `faq.md`.
3. Taylor picks it up on her next call.

### Updating pricing the team uses

`voice-agent/pricing.csv` is the source of truth for the team's quoting logic. Taylor doesn't read it (she doesn't quote out loud), but the team uses it offline.

### Changing Taylor's persona / rules

The system prompt lives in the conversation flow's `global_prompt` field, not in a repo file. To edit:

```
# Pull current
curl -H "Authorization: Bearer $RETELL_KEY" \
  https://api.retellai.com/get-conversation-flow/conversation_flow_957a14980504

# Edit global_prompt locally, then PATCH back
curl -X PATCH -H "Authorization: Bearer $RETELL_KEY" \
  -H "Content-Type: application/json" \
  -d '{"global_prompt": "..."}' \
  https://api.retellai.com/update-conversation-flow/conversation_flow_957a14980504
```

After editing, save the new state to `voice-agent/conversation-flow.json` for version control.

### Watching Taylor's output

- **Live dashboard**: `https://www.northcolumbuscleaning.com/api/admin/calls?token=<ADMIN_TOKEN>` — last 7 days, stale leads, intent breakdown, pipeline distribution.
- **Weekly audit SMS**: fires Mondays at 10am ET via Vercel Cron (`/api/admin/audit-calls`). Texts the manager from the GHL number if there are calls flagged for review or leads sitting >48h in New Lead.
- **Spot review**: Retell dashboard → Calls → sort by duration → skim the 5 longest.

## Troubleshooting

| Symptom | Where to look |
|---|---|
| Taylor not answering | Retell → agent status → phone-number assignment → GHL forwarding workflow |
| Webhook silently no-ops | Vercel function logs (`/api/retell-webhook` → recent invocations) — JSON response shows which step failed |
| Contact not created in GHL | Check `GHL_PIT` + `GHL_LOCATION_ID` env vars in Vercel; check the upsert error in webhook response |
| Auto-text not sent | Check `sms_consent` value in webhook response — if `not_stated`, tighten Taylor's wrap-up prompt; if `yes` but failed, check GHL's `/conversations/messages` response |
| Manager recap not received | `MANAGER_PHONE` env var; GHL has an SMS-capable number for outbound |
| Wrong pipeline stage | Pipeline/stage IDs in `api/retell-webhook.js` constants — update if pipeline was recreated |
| Robotic voice / unnatural prosody | Try a different voice_id in `update-agent` (e.g. `retell-Chloe`, `retell-Cimo`) |

## Environment variables (Vercel)

| Name | Purpose |
|---|---|
| `GHL_PIT` | Private Integration Token for the sub-account |
| `GHL_LOCATION_ID` | Sub-account ID (`XIA5AmegWaylDoPVe3r8`) |
| `GHL_FROM_NUMBER` | (optional) Specific SMS-capable number for outbound; else GHL uses location default |
| `MANAGER_PHONE` | E.164 cell number for the manager-recap SMS |
| `ADMIN_TOKEN` | Long random string; gates `/api/admin/*` routes |
| `CRON_SECRET` | Auto-provided by Vercel for Cron jobs |

## KPIs to watch

- **Call volume** (per week)
- **Existing-customer recognition rate** — should grow as the customer base grows
- **SMS consent rate** — under 60% means the wrap-up question needs work
- **Stale-lead rate** — leads sitting >24h in New Lead = team responsiveness issue
- **Win rate** (Won / (Won+Lost)) — long-term pipeline health
- **`needs-review` rate** — under 5% is healthy; higher means Taylor's prompt needs tightening
