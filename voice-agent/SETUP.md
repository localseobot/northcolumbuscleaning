# Voice Agent Setup — Quo + Retell AI + Zapier → Booking Koala

Step-by-step to take the voice agent from "code in the repo" to "live on your Quo line."

Everything ties back to your existing Quo number — customers dial the same number they already know, the team sees all calls and texts in Quo's shared inbox, and automated SMS come from the Quo workspace number instead of a separate Twilio number.

**Estimated setup time**: ~2 hours for first-time setup.
**Estimated monthly cost at 100 calls × 2 min avg**: ~$25–$40 (Retell usage + Zapier if you don't already have it). Your existing Quo subscription covers the rest.

---

## Prerequisites

1. **Quo account** — the workspace you already use (quo.com, formerly OpenPhone). Admin access required.
2. **Retell AI** — https://www.retellai.com — free credits to start, pay-as-you-go after
3. **Zapier** — https://zapier.com — likely already connected to Booking Koala

You do **not** need Twilio for this setup.

---

## Step 1 — Confirm the webhook endpoints are live

The serverless functions auto-deploy from the repo to Vercel when pushed to `main`.

- `/api/retell-webhook` — handles Retell's post-call report, sends SMS recap via Quo, forwards to Zapier
- `/api/voice-agent/check-service-area` — the agent calls this mid-conversation to check if a zip is in-area
- `/api/quo-webhook` — Quo's events land here (Phase 2+ — just scaffolded now)

Smoke test (from the repo directory):
```bash
vercel curl /api/voice-agent/check-service-area -- -X POST \
  -H "Content-Type: application/json" \
  -d '{"args":{"zip":"43085"}}'
# expect: {"result":"Yes, 43085 is in our service area — that's Worthington.", ...}
```

---

## Step 2 — Get your Quo API key

1. In Quo, go to **Settings → API**.
2. Click **Generate API Key**, give it a label like "Vercel-server".
3. Copy the key — you won't see it again.
4. Note your **main workspace phone number** in E.164 format (with `+1`, e.g. `+16145550100`).

---

## Step 3 — Set Vercel environment variables

In the Vercel dashboard → your project → **Settings → Environment Variables**, add:

| Variable | Value | Used by |
|---|---|---|
| `QUO_API_KEY` | the API key from step 2 | All Quo SMS sends |
| `QUO_FROM_NUMBER` | your Quo number in E.164, e.g. `+16145550100` | Sender of all automated SMS |
| `MANAGER_PHONE` | owner/manager cell in E.164 | Post-call SMS recap recipient |
| `ZAPIER_WEBHOOK_URL` | (Step 6) | Forwards call summaries to Zapier |
| `QUO_WEBHOOK_SECRET` | (Step 7, optional for Phase 1) | Signature verification on `/api/quo-webhook` |

After each add, Vercel will prompt to redeploy — say yes.

---

## Step 4 — Set up the Retell agent

1. Sign up at https://beta.retellai.com (free credits to start).
2. **Create a Retell LLM**:
   - Dashboard → **LLM** → **New LLM**
   - Paste the contents of `voice-agent/retell-llm.json` into the JSON editor — or create manually: copy `general_prompt` from that file, and add the three tools listed (`end_call`, `transfer_to_manager`, `check_service_area`).
   - For the `check_service_area` custom tool, set the URL to:
     `https://northcolumbuscleaning.com/api/voice-agent/check-service-area`
   - For `transfer_to_manager`, set the destination to the **office manager's direct cell** (Retell transfers the caller out of Retell directly to that number — no routing back through Quo).
   - Save. Copy the generated **LLM ID**.
3. **Create a Retell Agent**:
   - Dashboard → **Agents** → **New Agent**
   - Paste contents of `voice-agent/retell-agent.json`, replacing `REPLACE_WITH_LLM_ID_AFTER_CREATING_LLM` with the LLM ID from step 2.
   - Voice: `11labs-Adrian` is the default in the config (warm male). Alternatives: `11labs-Sarah` / `11labs-Rachel` (warm female). Test in Retell's web player.
   - Webhook URL: `https://northcolumbuscleaning.com/api/retell-webhook`
   - Save. Copy the **Agent ID**.
4. **Test in the web player** (Retell lets you call the agent from your browser). Run:
   - A quote-request flow ("I need cleaning for my 3-bed in Worthington")
   - A "transfer me to a human" flow
   - A zip check ("what about 43065?")

---

## Step 5 — Get a phone number Quo can forward to

Retell is inbound-only; it needs a phone number that rings when Quo forwards calls. Buy one directly in Retell:

1. Retell dashboard → **Phone Numbers** → **Buy a Number**
2. Pick any area code — the customer never sees this number (Quo forwards to it behind the scenes). A Columbus 614 number is nice for consistency.
3. Assign your Agent as the handler.
4. Copy the E.164 number (e.g. `+16145559876`).

Cost: ~$1.15/mo + ~$0.015/min of usage, paid through Retell.

---

## Step 6 — Configure Quo's call flow to forward to Retell

This is where Quo earns its keep — the call flow builder handles all the routing logic.

1. In Quo: **Settings → Phone numbers → (your main line) → Call flow → Edit**
2. The flow should look like this:

```
Incoming call
     │
     ├─ [Business hours condition: Mon–Sat 7am–7pm]
     │    ├─ Ring group: [owner, office manager, any other team members]
     │    │   Timeout: 20 seconds
     │    └─ If no one answers → Forward call to: +1614xxxxxxx (the Retell number)
     │
     └─ [Outside business hours]
          └─ Forward call to: +1614xxxxxxx (the Retell number)
```

Specifics:
- Drag an **After hours** condition.
- Inside business hours, drag a **Ring group** with your team, then a **Forward call** below it (Quo's UI calls this "no answer forward").
- Inside after-hours, drag a single **Forward call** straight to the Retell number.
- Save the flow.

Test by calling your Quo number from a personal phone during business hours — nobody picks up → should roll to Retell in ~20 seconds.

> **Caller ID passthrough**: Quo does pass the original caller's number through on forwards, so Retell (and your SMS recap) will show the actual caller, not the Quo number.

---

## Step 7 — Create the Zapier flow

1. In Zapier, create a new Zap.
2. Trigger: **Webhooks by Zapier → Catch Hook**.
3. Copy the unique webhook URL Zapier gives you.
4. Paste it into the `ZAPIER_WEBHOOK_URL` env var in Vercel → Redeploy.
5. Make a test call through the agent; let it end normally.
6. In Zapier, click **Test trigger** — you should see the structured payload (`callerName`, `intent`, `serviceType`, etc.).
7. Build actions from `voice-agent/zapier-recipes.md` — at minimum **Recipe 1** (new quote → Booking Koala) and **Recipe 2** (all calls → Google Sheet log).

---

## Step 8 — (Optional, Phase 2 prep) Set up Quo's webhook

This doesn't do anything yet in Phase 1, but wiring it now saves time later.

1. Quo → **Settings → Webhooks → Create webhook**
2. URL: `https://northcolumbuscleaning.com/api/quo-webhook`
3. Events: `message.received`, `message.delivered`, `call.ringing`, `call.completed`
4. Phone numbers: your main workspace number
5. Copy the **signing secret** shown after creation → paste into Vercel env var `QUO_WEBHOOK_SECRET` → Redeploy

When Phase 2 lands (cleaner SMS brain, customer reply handling), the inbound events will already be flowing.

---

## Go-live checklist

- [ ] Test call from a personal phone during business hours → team rings → no answer for 20s → rolls to Maya
- [ ] Test call after business hours → straight to Maya
- [ ] Maya identifies as "the automated assistant" in the first sentence
- [ ] Got an SMS recap at `MANAGER_PHONE` within 30 seconds of call ending
- [ ] That recap shows up in Quo's shared inbox (because it was sent from the Quo number)
- [ ] Call appears in the Google Sheet log via Zapier
- [ ] Booking Koala got a new lead (or team got the email Zap)
- [ ] "Speak to a human" works during business hours (transfers to manager cell)
- [ ] Zip check works ("I live in 43065" → "Yes, Powell.")
- [ ] Out-of-area zip handled gracefully ("90210" → "not in area, but I'll take details")

---

## Cost breakdown (approximate, 100 calls × 2 min avg)

| Service | Usage | Cost |
|---|---|---|
| Quo subscription | Unchanged from today | $0 incremental |
| Retell AI phone number | $1.15/mo fixed | $1.15 |
| Retell AI call minutes | ~200 min × $0.015 | $3.00 |
| Retell AI LLM + voice (GPT-4o + 11labs) | ~200 min × $0.08 | $16.00 |
| Quo SMS via API | 100 recap SMS (covered by Quo plan) | $0 |
| Zapier Starter (if needed) | flat | $20 |
| **Monthly total** | | **~$40** |

At 500 calls/mo: **~$100/mo**. Inside your budget with room for Phase 2.

---

## Troubleshooting

**Agent's SMS recap isn't landing in Quo's shared inbox**
The recap goes to `MANAGER_PHONE` (owner's cell). It shows in Quo's inbox because Quo treats every message sent via the API from its number as a workspace message. If it's missing, double-check `QUO_FROM_NUMBER` matches your actual Quo workspace number (E.164 format).

**Agent commits to a price**
Reinforce the "never commit to a specific price" rule at the top of the system prompt in `voice-agent/system-prompt.md`, then re-save the LLM in the Retell dashboard.

**Quo forwarding isn't rolling to Retell**
Confirm the Retell number is active (make a direct test call to it). In Quo's call flow, verify the "no answer" timeout is ≤30s (Quo's max).

**Webhook not firing**
Vercel dashboard → Project → Logs → filter to `/api/retell-webhook`. You should see the incoming POST. If you see 4xx/5xx, check the Zapier URL and Quo API key env vars.

**Quo API returns 401**
Re-generate the API key in Quo settings and update `QUO_API_KEY` in Vercel. Redeploy.

**Quo API returns 400 "A2P registration not approved"**
Quo (like Twilio) requires A2P 10DLC registration for high-volume transactional SMS. Check Quo → **Settings → Phone numbers → (your number) → A2P registration**. Business and campaign registration take 1–3 business days. Without it, you can still send SMS but delivery may be rate-limited.

---

## What to change in the prompt over time

Every week, pull 10 call transcripts from Retell's dashboard. Skim for:

1. Questions the agent couldn't answer → add to `knowledge-base.md` or inline in the prompt
2. Places it got confused → tighten the `general_prompt`
3. Things it committed to that it shouldn't have → add to the "hard rules"
4. Common asks not in the collected fields → add to `post_call_analysis_data` in `retell-agent.json`

Then update the Retell LLM in the dashboard (or re-import the JSON) and redeploy.
