# Voice Agent Handbook

Quick reference for Maya, the AI phone assistant.

---

## What Maya does

Picks up the line when the team is busy or out. She can:

1. **Quote Regular, Deep, and Move-in/out cleanings** using `calculate_quote` (pricing from `voice-agent/pricing.csv`)
2. **Answer common questions** from the FAQ knowledge base
3. **Take messages** — you get an SMS recap in Quo within 30 seconds
4. **Transfer to a human** during business hours if asked

## What Maya won't do

- Quote commercial or short-term rental — collects details, escalates
- Confirm a specific date or time
- Take payment info
- Promise refunds, discounts, or make-goods
- Pretend to be human

## How a call flows

```
Caller → Quo (740-913-3693)
  ├ Mon–Sat 7–7: rings team 20s → forwards to Retell
  └ After-hours: straight to Retell
Retell (Maya answers)
  └ End of call → /api/retell-webhook
       ├ SMS recap to manager (via Quo, lands in shared inbox)
       └ Zapier → Booking Koala lead + Google Sheet log
```

## Tools Maya uses

| Tool | Fires when |
|---|---|
| `calculate_quote` | She has service + sqft + beds + baths + frequency |
| `check_service_area` | Caller mentions a zip or unfamiliar city |
| `transfer_to_manager` | Caller explicitly asks for a human, in business hours |
| `end_call` | Natural wrap-up or 20+ sec silence |

## Weekly review (Monday, 15 min)

1. Retell dashboard → Calls → sort by duration → skim the 5 longest
2. Google Sheet → glance at the week's calls
3. Flag: made-up quotes, confirmed a date, off-brand phrasing, confused by a common question
4. Fix in the prompt or FAQ → redeploy

**KPIs**: call volume, avg duration (60–180s is healthy), lead conversion rate, transfer rate (10–20% is normal), complaint rate (<5%)

## How to update her

| Change | File | Deploy |
|---|---|---|
| Personality / rules | `voice-agent/retell-llm.json` → `general_prompt` | Paste into Retell dashboard |
| FAQ entry | `voice-agent/faq.md` | Re-upload to Retell Knowledge Base |
| Pricing | `voice-agent/pricing.csv` + `api/voice-agent/calculate-quote.js` | `git push` (auto) |
| Tool logic | `api/voice-agent/*.js` | `git push` (auto) |

## Quick troubleshooting

| Symptom | Check |
|---|---|
| Not answering | Retell agent status → Retell phone number linked → Quo forward destination |
| Wrong price | Retell transcript → `calculate_quote` inputs/outputs → fix `pricing.csv` if math is off |
| No SMS recap | Vercel logs for `/api/retell-webhook` → `QUO_API_KEY` / `QUO_FROM_NUMBER` / `MANAGER_PHONE` env vars |
| Robotic voice | Try a different 11labs voice in Retell |
| Transfer loop | `transfer_to_manager` destination must be a human's direct cell, not the Quo line |

## Key files

```
voice-agent/
  retell-llm.json      ← prompt + tools (source of truth)
  retell-agent.json    ← voice + webhook wiring
  faq.md               ← knowledge base (upload to Retell)
  pricing.csv          ← pricing source of truth
  SETUP.md             ← first-time setup steps
api/
  retell-webhook.js          ← post-call handler (SMS + Zapier)
  voice-agent/
    calculate-quote.js        ← quote engine
    check-service-area.js     ← zip lookup
  quo-webhook.js       ← inbound Quo events (Phase 2)
  _lib/quo.js          ← Quo SMS helper
```

## Dashboards

- Retell: https://beta.retellai.com
- Quo: https://my.quo.com
- Vercel: https://vercel.com/localseobots-projects/northcolumbuscleaning
- Booking Koala: https://northcolumbuscleaning.bookingkoala.com
- Repo: https://github.com/localseobot/northcolumbuscleaning
