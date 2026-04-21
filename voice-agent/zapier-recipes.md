# Zapier recipes — Voice agent → Booking Koala + team notifications

These are the flows to build in Zapier so the voice agent's calls actually do something. The webhook at `/api/retell-webhook` posts a clean, structured payload to your Zapier **Catch Hook**.

## Incoming payload shape

```json
{
  "callId": "retell_abc123",
  "startedAt": "2026-04-20T15:42:00.000Z",
  "durationSec": 127,
  "callerNumber": "+16145551234",
  "summary": "Sarah called asking about a deep clean for her 3 bed 2 bath in Worthington before her in-laws visit next Saturday...",
  "sentiment": "positive",
  "intent": "new_quote",
  "callerName": "Sarah Miller",
  "callbackNumber": "+16145551234",
  "serviceType": "deep",
  "propertyDetails": "3 bed 2 bath house",
  "serviceAddressOrArea": "Worthington",
  "preferredTiming": "Next Saturday morning",
  "specialNotes": "Cat in bedroom, keep door closed",
  "urgency": "this_week",
  "requiresHumanFollowup": true,
  "transcript": "Agent: Thanks for calling...\nCaller: Hi, I'm looking for..."
}
```

---

## Recipe 1 — New quote lead → Booking Koala

**Trigger**: Webhooks by Zapier → Catch Hook
**Filter**: `intent` equals `new_quote`
**Action A**: Booking Koala → Create lead (or "Create customer" depending on your plan's actions)
  - Map `callerName` → Name
  - Map `callbackNumber` → Phone
  - Map `serviceAddressOrArea` → Address
  - Map `serviceType` → Service type (use a Formatter step to map "deep" → "Deep cleaning" etc.)
  - Map `summary` → Notes
**Action B**: Gmail → Send email to `admin@northcolumbuscleaning.com`
  - Subject: `New quote call — {{callerName}} ({{serviceAddressOrArea}})`
  - Body: summary + all fields

> Booking Koala's Zapier integration supports several actions. If "Create lead" isn't exposed, use their API endpoint (`POST /customers`) through the **Webhooks by Zapier → Custom Request** action instead.

---

## Recipe 2 — Any call → Google Sheet log

**Trigger**: Webhooks by Zapier → Catch Hook (same hook, multi-step Zap fan-out)
**Action**: Google Sheets → Create spreadsheet row
  - One row per call with all fields
  - Useful for auditing the agent's performance weekly

Columns (in order):
`startedAt | durationSec | callerNumber | callerName | intent | serviceType | propertyDetails | serviceAddressOrArea | preferredTiming | urgency | sentiment | summary | transcript`

---

## Recipe 3 — Complaints → urgent SMS to owner

**Trigger**: Webhooks by Zapier → Catch Hook
**Filter**: `intent` equals `complaint` OR `requiresHumanFollowup` is `true` AND `urgency` equals `today`
**Action**: SMS by Zapier (or Twilio) → send to owner's phone
  - "🔴 URGENT call from {{callerName}} ({{callbackNumber}}): {{summary}}"

This is a backup to the built-in SMS recap in the webhook — helpful if you want a separate urgent-only channel.

---

## Recipe 4 — After-hours missed calls → scheduled callback

**Trigger**: Webhooks by Zapier → Catch Hook
**Filter**: call happened outside 7am–7pm Mon–Sat
**Action 1**: Google Calendar → Create detailed event
  - Title: `Callback: {{callerName}} — {{serviceType}}`
  - Start: next business day 8:00 AM
  - Description: summary + all fields
**Action 2**: Email to the person who handles mornings

---

## Recipe 5 — Existing customer questions → team Slack / Discord / email

**Trigger**: Webhooks by Zapier → Catch Hook
**Filter**: `intent` equals `existing_customer`
**Action**: Slack → Post channel message (or email)
  - "{{callerName}} ({{callbackNumber}}) called: {{summary}}"

---

## How to wire it up

1. In Zapier, create a new Zap, trigger = **Webhooks by Zapier → Catch Hook**.
2. Zapier gives you a unique URL like `https://hooks.zapier.com/hooks/catch/12345/abcdef/`.
3. Copy that URL.
4. In Vercel project settings → Environment Variables, add:
   - `ZAPIER_WEBHOOK_URL` = (the URL from step 3)
5. Redeploy (auto-deploys on env-var change in Vercel).
6. Test the agent — the next call's end-of-call report will fire the webhook into Zapier.
7. In Zapier, pull in the sample data and build the actions above.

> **Tip**: you can fan out one Catch Hook into multiple Zaps. Create Zap #2, #3, etc. all listening to the same hook with different filters.
