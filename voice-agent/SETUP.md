# Voice Agent Setup — Retell AI + Twilio + Zapier → Booking Koala

Step-by-step to take the voice agent from "code in the repo" to "live on your phone line."

**Estimated setup time**: 2–3 hours for first-time setup.
**Estimated monthly cost at 100 calls × 2 min avg**: ~$40–$60 (see cost breakdown at the bottom).

---

## Prerequisites / accounts to create

1. **Retell AI** — https://www.retellai.com — free tier to start, pay-as-you-go after
2. **Twilio** — https://www.twilio.com — for phone number and SMS recap
3. **Zapier** — https://zapier.com — you likely already have this via Booking Koala
4. **OpenAI** (optional) — Retell can use their own LLM credits, or bring your own OpenAI key for cheaper rates at scale

---

## Step 1 — Deploy the webhook endpoints (one-time)

The code in `/api/retell-webhook.js` and `/api/voice-agent/check-service-area.js` auto-deploys to Vercel when pushed to `main`. Confirm they're live:

```
https://northcolumbuscleaning.com/api/retell-webhook              (POST only)
https://northcolumbuscleaning.com/api/voice-agent/check-service-area (POST only)
```

A GET will return `405 Method not allowed` — that's expected and means the function is alive.

---

## Step 2 — Set Vercel environment variables

In the Vercel dashboard → your project → Settings → Environment Variables, add the following (leave blank for now; we'll fill them in as we set up each service):

| Variable | Value | Used by |
|---|---|---|
| `ZAPIER_WEBHOOK_URL` | (Step 6) | retell-webhook → Zapier forwarding |
| `TWILIO_ACCOUNT_SID` | (Step 3) | SMS recap to manager |
| `TWILIO_AUTH_TOKEN` | (Step 3) | SMS recap to manager |
| `TWILIO_FROM` | (Step 3) E.164, e.g. `+16145550100` | SMS sender |
| `MANAGER_PHONE` | owner's cell E.164 | SMS recap recipient |

Hit **Redeploy** after adding each one so the new env is picked up.

---

## Step 3 — Twilio: buy a number + get API credentials

1. Sign up at https://twilio.com (trial credit: $15).
2. **Buy a phone number** (Console → Phone Numbers → Buy a Number):
   - Pick a Columbus, OH area code (614, 380).
   - Enable **Voice** and **SMS** capabilities.
   - ~$1.15/mo.
3. Copy from Console → Account Info:
   - **Account SID** → `TWILIO_ACCOUNT_SID` in Vercel.
   - **Auth Token** → `TWILIO_AUTH_TOKEN` in Vercel.
4. The number itself → `TWILIO_FROM` (with the `+1` prefix).
5. Put the owner's cell in `MANAGER_PHONE` (also `+1`-prefixed).

> **Trial account note**: Twilio trial numbers can only SMS/call verified numbers. Verify the owner's cell first, and upgrade to a paid account before going live ($20 minimum top-up).

---

## Step 4 — Retell AI: create the LLM and Agent

1. Sign up at https://beta.retellai.com (free credits to start).
2. **Create a Retell LLM**:
   - Dashboard → **LLM** → **New LLM**
   - Either paste the contents of `voice-agent/retell-llm.json` into the JSON editor, or copy the `general_prompt` manually into the Prompt field and add the 3 tools (`end_call`, `transfer_to_manager`, `check_service_area`) one at a time in the Tools section.
   - For `check_service_area`, set the URL to `https://northcolumbuscleaning.com/api/voice-agent/check-service-area`.
   - Save. Copy the generated **LLM ID**.
3. **Create an Agent**:
   - Dashboard → **Agents** → **New Agent**
   - Paste contents of `voice-agent/retell-agent.json`, replacing `REPLACE_WITH_LLM_ID_AFTER_CREATING_LLM` with the LLM ID from step 2.
   - Voice: **11labs Adrian** is a solid warm male voice. For female, try **11labs Sarah** or **11labs Rachel**. Test several in Retell's web player.
   - Webhook URL: `https://northcolumbuscleaning.com/api/retell-webhook`
   - Save. Copy the **Agent ID**.
4. **Test in the web player**: Retell lets you call the agent from your browser. Run through a full quote-request flow and a "transfer me to a human" flow.

---

## Step 5 — Connect a phone number to the agent

Two options:

### Option A — Use a Retell-provided number (simplest)
1. Dashboard → **Phone Numbers** → **Buy/Import**.
2. Buy a number or import your Twilio number.
3. Assign your agent to inbound calls.
4. Test by calling the number from your own phone.

### Option B — Route your existing business line to Retell via Twilio
1. In Twilio Console, find the number you bought in Step 3.
2. Under **Voice Configuration → A call comes in**, set the webhook to Retell's inbound webhook URL (shown in Retell's Phone Numbers section).
3. This lets you keep the Twilio number as the public-facing phone and still get Retell's agent to handle calls.

### After-hours / overflow routing (recommended)
In Twilio or via Twilio Studio, add a simple flow:
- **Business hours (Mon–Sat 7am–7pm)**: ring the office manager's cell for 20 seconds, then fall back to Retell.
- **After hours**: go straight to Retell.

Twilio Studio has a drag-and-drop flow builder for this — takes 15 minutes.

---

## Step 6 — Zapier: catch the end-of-call webhook

1. In Zapier, create a new Zap.
2. Trigger: **Webhooks by Zapier → Catch Hook**.
3. Zapier gives you a unique URL — copy it.
4. Paste it into the `ZAPIER_WEBHOOK_URL` env var in Vercel → Redeploy.
5. Make a test call through the agent, then let it end normally (say "thanks, that's all").
6. Back in Zapier, click **Test trigger** — you should see the structured payload (`callerName`, `intent`, `serviceType`, etc.).
7. Build the actions from `voice-agent/zapier-recipes.md` — at minimum: **Recipe 1** (new quote → Booking Koala) and **Recipe 2** (all calls → Google Sheet log).

---

## Step 7 — Go live checklist

- [ ] Made a test call from your own phone and got a realistic quote conversation
- [ ] Received an SMS recap at `MANAGER_PHONE` within 10–30 seconds of the call ending
- [ ] Saw the call appear in the Google Sheet log via Zapier
- [ ] Booking Koala received a new lead (or got an email from the Zap)
- [ ] "Transfer to a human" works during business hours
- [ ] Tried a zip check ("I live in 43065") and the agent confirmed the area correctly
- [ ] Tried an out-of-area zip ("45202") and the agent gracefully offered to take details anyway

---

## Cost breakdown (approximate, at 100 calls × 2 minutes)

| Service | Usage | Cost |
|---|---|---|
| Twilio number | $1.15/mo fixed | $1.15 |
| Twilio voice | ~200 min × $0.014/min | $2.80 |
| Twilio SMS | ~100 msg × $0.0083 | $0.83 |
| Retell AI | ~200 min × $0.08/min (GPT-4o + 11labs) | $16.00 |
| Retell phone minutes (if buying via Retell) | ~200 min × $0.015 | $3.00 |
| Zapier | Starter plan (if needed for multi-step Zaps) | $20 |
| **Monthly total** | | **~$45** |

At 500 calls/mo, multiply voice costs by 5 and Zapier stays fixed: **~$120/mo**. Well within the $100–$300 budget.

---

## Troubleshooting

**Agent speaks over the caller / interrupts too much**
In `retell-agent.json`, lower `interruption_sensitivity` from 0.8 to 0.5.

**Agent is too slow to respond**
Raise `responsiveness` closer to 1.0. Switch model to `gpt-4o-mini` in the LLM config if you need more speed (slight quality trade-off).

**Agent commits to a price**
Reinforce the "never commit to a specific price" rule in the system prompt. You can also move it to the very top of the prompt.

**Call summary is too sparse**
Make sure `post_call_analysis_data` fields in `retell-agent.json` match your downstream needs. Retell only extracts fields you list.

**Webhook not firing**
Check Vercel logs: Vercel dashboard → Project → Logs → filter to `/api/retell-webhook`. You should see the incoming POST. If not, check that the webhook URL in Retell points to the production domain (not a preview URL).

**Zapier not seeing data**
Go to Zapier → your Zap → History. Every incoming hook is logged even if no action matched. If nothing shows up, the Vercel function isn't hitting Zapier — check the `ZAPIER_WEBHOOK_URL` env var and look at Vercel function logs for errors.

---

## What to change in the prompt over time

Every week, pull 10 call transcripts from Retell's dashboard. Skim for:

1. **Questions the agent couldn't answer** → add to `knowledge-base.md`.
2. **Places it got confused** → tighten the `general_prompt`.
3. **Things it committed to that it shouldn't have** → add to the "hard rules."
4. **Common asks not in the collected fields** → add to `post_call_analysis_data` so they come out structured.

Then update the Retell LLM in the dashboard (or re-import the JSON) and redeploy.
