# Voice Agent Handbook

**Internal operations guide for Maya, the AI phone assistant for North Columbus Cleaning Company.**

This is the document you re-read when you've been away for a month and need to remember how everything works. Keep it skimmable.

---

## Table of contents

1. [Who Maya is](#1-who-maya-is)
2. [What Maya does](#2-what-maya-does)
3. [What Maya doesn't do](#3-what-maya-doesnt-do)
4. [How calls flow through the stack](#4-how-calls-flow-through-the-stack)
5. [Tools Maya can use](#5-tools-maya-can-use)
6. [Agent personality & rules](#6-agent-personality--rules)
7. [Typical call examples](#7-typical-call-examples)
8. [Weekly operator review (15 min, every Monday)](#8-weekly-operator-review-15-min-every-monday)
9. [How to update the agent](#9-how-to-update-the-agent)
10. [Cost tracking](#10-cost-tracking)
11. [Troubleshooting common issues](#11-troubleshooting-common-issues)
12. [Legal & compliance basics](#12-legal--compliance-basics)
13. [Handoff notes (when a human takes over)](#13-handoff-notes-when-a-human-takes-over)
14. [Change log](#14-change-log)

---

## 1. Who Maya is

Maya is the automated phone assistant for North Columbus Cleaning Company. She picks up the line when:
- The team is out of office
- The team is on another call
- It's after business hours (outside Mon–Sat 7am–7pm)

She identifies herself as automated in her first sentence. **She never pretends to be human.** If a caller asks "am I talking to a robot?", she confirms it honestly.

**She is not a sales bot.** She's a competent receptionist who can quote prices, take messages, and send booking links. The tone is plain-spoken and warm — like the best employee you've ever had, on the phone.

---

## 2. What Maya does

The four things she's good at, in priority order:

1. **Quotes flat-rate prices** for Regular, Deep, and Move-in/out cleanings by calling the `calculate_quote` tool. She reads back the exact number and offers to text a booking link.
2. **Answers common questions** about services, hours, areas, insurance, supplies, scheduling, cancellation, payment — all from the embedded knowledge base and the uploaded FAQ document.
3. **Takes structured messages** from callers whose request she can't handle directly. The message hits your phone via SMS within ~30 seconds of the call ending.
4. **Transfers to a human** if the caller explicitly asks for one during business hours.

---

## 3. What Maya doesn't do

Things she will always refuse, by design. Baked into the prompt as "hard rules":

- **Never commit to a custom price.** If the calculator can't handle it (commercial, Airbnb, unusual scope), she collects details and promises team follow-up.
- **Never confirm a specific date or time.** She'll say "the team handles scheduling — I can text you the booking link to lock in a slot." The BK booking form owns calendars.
- **Never accept payment info.** No card numbers over this line, ever.
- **Never promise a refund, discount, or make-good.** That escalates to you.
- **Never share employee personal details.**
- **Never claim to be human.**
- **Never quote commercial or short-term rental pricing automatically.** Those need a human eye.
- **Never answer outside her scope.** If a caller asks about something she doesn't know, she says "I don't have that in front of me — let me note it for the team" and captures the question.

When in doubt, she escalates. That's the correct default behavior.

---

## 4. How calls flow through the stack

```
Customer dials Quo main line: (740) 913-3693
         │
         ▼
Quo call flow:
  ├── Business hours (Mon–Sat 7am–7pm):
  │     ring team ring group for 20 seconds
  │     └── if unanswered → forward to Retell number
  │
  └── After hours:
        forward straight to Retell number
         │
         ▼
Retell receives the call → Maya picks up
  ├── Uses embedded knowledge base + FAQ KB to answer
  ├── Calls calculate_quote tool for pricing
  ├── Calls check_service_area tool for zips
  ├── Calls transfer_to_manager if caller asks for human
  └── Ends call, sends end-of-call-report webhook
         │
         ▼
POST https://northcolumbuscleaning.com/api/retell-webhook
  ├── Extracts structured data from Retell's call analysis
  │     (caller_name, intent, service_type, urgency, etc.)
  │
  ├── Sends SMS recap to manager via Quo API
  │     (lands in Quo's shared inbox — the team sees it there)
  │
  └── Forwards clean JSON to Zapier
           │
           ├── New quote → Booking Koala lead
           ├── Any call → Google Sheet row (audit log)
           ├── Complaint → urgent Slack/SMS ping
           └── After-hours call → Google Calendar callback event
```

**Every piece has a "single responsibility":**
- **Quo** owns the customer-facing number, the team inbox, and routing logic
- **Retell** owns the voice conversation
- **Our Vercel webhooks** own the glue (SMS recap, Zapier forward)
- **Zapier** owns the downstream branching (BK lead, sheet log, notifications)
- **Booking Koala** owns actual scheduling and invoicing

---

## 5. Tools Maya can use

Four tools, configured in Retell's LLM. Maya decides when to call each one based on the conversation.

### `calculate_quote`

**Input**: `service`, `sqft`, `bedrooms`, `bathrooms`, `frequency`
**Backend**: `https://northcolumbuscleaning.com/api/voice-agent/calculate-quote`
**Source of truth**: `voice-agent/pricing.csv` → `api/voice-agent/calculate-quote.js`

Returns a ready-to-speak price and — for one-time quotes — auto-offers the bi-weekly and weekly alternatives as upsells.

**When she uses it**: Any time a caller wants to know the price for Regular, Deep, or Move-in/out cleaning, as soon as she has all five inputs. If inputs are missing, she returns a graceful prompt ("I need a rough square footage — even a ballpark").

**When she does NOT use it**: Commercial or short-term rental — those return a message for team follow-up instead.

### `check_service_area`

**Input**: `zip` (5-digit)
**Backend**: `https://northcolumbuscleaning.com/api/voice-agent/check-service-area`

Returns `served: true/false` + the neighborhood name. When served, Maya says "Yes, that's Worthington — we've got you." When not, she says "Not in our standard area, but I'll take the details and the team can see if it's a fit."

**When she uses it**: Anytime a caller mentions a zip or a city she doesn't instantly recognize.

### `transfer_to_manager`

**Destination**: `+17409133693` *(currently the Quo main line — update to manager cell to avoid loops)*

**When she uses it**: Only during business hours, only when the caller explicitly asks for a human. Never proactively.

### `end_call`

**When she uses it**: After the wrap-up, when the conversation has reached a natural close. Also if the caller says goodbye or the conversation has been silent for 20+ seconds.

---

## 6. Agent personality & rules

Pulled directly from the system prompt, for quick reference:

### Voice
- Plain-spoken, warm, direct. Not corporate, not cute, not over-apologetic.
- Short sentences. Uses contractions.
- Never uses: "revolutionize," "synergize," "solutions provider," "world-class," "industry-leading."
- Max one exclamation mark per call.
- Replies under three sentences unless asked for detail.

### Accuracy
- Spells back names she's unsure about.
- Reads back phone numbers, addresses, and dates one chunk at a time.
- Never fills in gaps from imagination — asks for missing info.

### Hard rules (baked into prompt)
- Quote only using `calculate_quote`'s output. Never make up a number.
- Never accept payment info.
- Never promise refunds, discounts, or make-goods.
- Never share employee personal details.
- Never claim to be human.
- Never confirm a specific date/time.

---

## 7. Typical call examples

### Example 1 — Quote request (happy path)

```
Maya: Thanks for calling North Columbus Cleaning. I'm Maya, the automated
      assistant covering the line. Are you looking for a quote, or is there
      something else I can help with?
Caller: Yeah, I need a price for my house.
Maya: Happy to help. Standard, deep, or move-in-out?
Caller: Just a normal cleaning.
Maya: Got it. How big is the home, roughly?
Caller: Uh, I think like 1800 square feet?
Maya: Perfect. Bedrooms?
Caller: Three.
Maya: Bathrooms? Half-baths count as .5.
Caller: Two and a half.
Maya: And how often are you thinking — one-time, weekly, bi-weekly, or monthly?
Caller: Let's start with one-time.
Maya: [calls calculate_quote]
      For a regular cleaning of an 1800-square-foot home with 3 bedrooms and
      2.5 bathrooms, the one-time price is $348. If you'd like it recurring,
      bi-weekly would be $261 each visit, or weekly $243.60 each visit.
      Want me to text you the booking link to lock it in?
Caller: Yeah, bi-weekly sounds good.
Maya: Great. What's your name and the service address?
Caller: Sarah Miller, 4512 Oakmont in Worthington.
Maya: Is (614) 555-1234 the best number to text?
Caller: Yep.
Maya: Perfect. I'll send the booking link now, and Dave or whoever's on the
      schedule will follow up within one business day. Have a good one.
      [calls end_call]
```

### Example 2 — After-hours information request

```
Maya: Thanks for calling North Columbus Cleaning. I'm Maya, the automated
      assistant covering the line. Are you looking for a quote, or is there
      something else I can help with?
Caller: Actually I have a question. Do you guys clean inside fridges?
Maya: Yes — inside the fridge is part of our deep cleaning. It's not in a
      regular clean by default, but we can add it as an extra. Want a quote
      for a deep clean, or just that one add-on?
Caller: Oh never mind, I'll call back tomorrow.
Maya: No problem. Can I get your name and number so I can let the team know
      you're interested, and they'll call you back during business hours?
Caller: It's John, 614-555-9988.
Maya: Got it. Thanks John — they'll reach out tomorrow morning. Have a
      good night.
      [calls end_call]
```

### Example 3 — Out-of-scope: commercial

```
Caller: I need cleaning for my dental office, twice a week.
Maya: Commercial cleanings aren't something I quote automatically — the
      team sizes those up individually. Can I grab a few details and have
      them call you back tomorrow morning?
Caller: Sure.
Maya: Great. What's the office's rough square footage, and how many rooms
      or treatment areas?
Caller: About 2000 square feet, 6 treatment rooms.
Maya: Any specific concerns — restroom traffic, medical waste handling,
      anything like that?
Caller: Just a standard office clean, nothing biohazard.
Maya: Got it. Name and best callback number?
      [Continues collecting; ends with end_call]
```

### Example 4 — Complaint

```
Caller: I need to complain about the cleaning yesterday — the bathroom
      wasn't done.
Maya: I'm sorry that happened. I'm getting this in front of the team today.
      Can you tell me the specific date, and what was missed?
Caller: Tuesday, April 15th. The guest bathroom wasn't touched — tub still
      had water spots, mirror was smudged, trash wasn't emptied.
Maya: Noted. The satisfaction guarantee is — if something's missed, we come
      back within 24 hours at no charge. Would you like them to come back
      and re-do the bathroom, or do you want to talk to the owner directly?
Caller: Yeah, I want a redo.
Maya: Got it. I'll flag this as urgent. The team will call you back today
      to schedule the redo. What's the best callback number?
      [Continues; ends with urgency=today flag + end_call]
```

The post-call SMS to you will say:
> 🔴 Urgent: Complaint from [Caller] (+16145559988) • Tuesday 4/15 cleaning • guest bathroom not cleaned — water spots on tub, smudged mirror, trash • caller wants re-do today. Call (614) 555-9988.

---

## 8. Weekly operator review (15 min, every Monday)

This is the #1 thing that keeps Maya good. Set a recurring calendar block.

### The routine

1. **Open Retell dashboard → Calls → last 7 days**
2. **Sort by duration**, skim the 5 longest calls (those are where she probably struggled)
3. **Open each transcript** and ask:
   - Did she answer correctly?
   - Did she ask unnecessary questions?
   - Did she miss info she should have collected?
   - Did she commit to anything she shouldn't have?
4. **Open the Google Sheet** (Recipe 2 from zapier-recipes.md) and skim all calls
5. **For any issues you spot**, fix them in the prompt (see Section 9) and redeploy

### What to flag

| Issue | Action |
|---|---|
| She quoted a commercial job automatically | Add to hard rules: "Commercial is never quoted. Always collect details and escalate." |
| She committed to a specific date | Reinforce "Never confirm a date/time" at the top of the prompt |
| She misunderstood an accent or a number | Usually auto-fixes as Retell's speech model improves; no action |
| She said something off-brand | Add the exact phrasing to "never say" list |
| Repeated customer question that's not in FAQ | Add a new entry to `voice-agent/faq.md` |
| Repeated pricing mistake | Check `voice-agent/pricing.csv` against BK — update if out of sync |
| A caller got frustrated and hung up | Listen carefully. If Maya was looping on a question, tighten the relevant prompt section |

### KPIs to watch (per week)

- **Call volume** (Retell dashboard)
- **Average call duration** (sweet spot: 60–180 seconds — much longer means she's struggling)
- **% of calls that resulted in a quote or lead** (from Zapier → Google Sheet)
- **Complaint rate** (should be <5% of calls)
- **Transfer rate to human** (~10–20% is healthy; >30% means she's not confident enough)

---

## 9. How to update the agent

Two levers to pull:

### A. The system prompt (`voice-agent/retell-llm.json`)

This controls Maya's personality, rules, and knowledge. You update this when you want to change what Maya *does* or *says*.

**Workflow:**
1. Edit `voice-agent/retell-llm.json` — specifically the `general_prompt` field
2. Commit and push to git (auto-deploys the webhook code, but the prompt lives in Retell's dashboard)
3. **In Retell Dashboard → LLM → your LLM → Edit:**
   - Paste the new `general_prompt`
   - Save
4. The new prompt takes effect **on the next call** (no deploy delay)

**Common edits:**
- Add a new FAQ → Add to `### FAQ` section
- Update pricing → Change `voice-agent/pricing.csv` (auto-deployed via Vercel) + update prompt's "Pricing bands" section for consistency
- Add a hard rule → Add to "## Hard rules" list
- Change the greeting → Update `begin_message` in the JSON and in Retell's UI

### B. The FAQ knowledge base (`voice-agent/faq.md`)

This is the document uploaded to Retell's Knowledge Base. Update it when you notice a question Maya didn't know the answer to.

**Workflow:**
1. Edit `voice-agent/faq.md` — add the Q/A following the existing format (H2 question, answer below)
2. Commit to git (just for version history)
3. **In Retell Dashboard → Knowledge Base → your KB → Delete and re-upload** the updated file
4. Retell re-indexes it (30–60 sec)
5. New content is live on the next call

**Future improvement**: if you publish `faq.md` at a stable URL, Retell can auto-sync from that URL and skip the re-upload step.

### C. Tool behavior (`api/voice-agent/*.js`)

You update tool code when you want to change what Maya *can do*.

**Workflow:**
1. Edit the .js file in `api/voice-agent/`
2. Commit and push → Vercel auto-deploys (~30 sec)
3. The tool is live on the next call — no Retell dashboard change needed

**Example**: to update pricing, edit `api/voice-agent/calculate-quote.js` (or just `voice-agent/pricing.csv` if I structured it that way). Next call uses the new numbers.

---

## 10. Cost tracking

Monthly cost at different call volumes:

| Calls/mo (avg 2 min) | Retell usage | Twilio/Quo | Zapier | **Total** |
|---|---|---|---|---|
| 50 | ~$10 | $1 | $0–20 | **$11–31** |
| 100 | ~$20 | $1 | $0–20 | **$21–41** |
| 250 | ~$50 | $3 | $20 | **~$73** |
| 500 | ~$100 | $5 | $20 | **~$125** |

**Where to watch spend:**
- **Retell dashboard → Billing** — real-time usage, can set a monthly cap
- **Vercel dashboard → Usage** — should stay free-tier for our traffic
- **Quo plan** — the subscription doesn't change; outbound SMS is included in your plan quota

**If Retell usage spikes unexpectedly:**
1. Check for loop conditions (e.g., if `transfer_to_manager` points back to Quo, calls could loop)
2. Check Retell's "call minutes" metric — long calls might mean Maya is struggling
3. Consider switching the model from `gpt-4o` to `gpt-4o-mini` (quality slightly lower, cost ~1/5)

---

## 11. Troubleshooting common issues

### Maya won't answer the phone at all

1. Is the Retell agent **published/active**? Dashboard → Agents → check status
2. Is the Retell phone number **linked to the agent**? Dashboard → Phone Numbers
3. Did Quo's call flow **actually forward to the Retell number**? Quo → Settings → Phone numbers → Call flow → verify the forward destination
4. Test by calling the Retell number directly from your phone (skip Quo) — if that works, the problem is in Quo's flow. If it doesn't, the problem is in Retell.

### Maya answers but gives wrong prices

1. Open the call transcript in Retell → search for `calculate_quote`
2. Check the inputs she passed — did she mishear the square footage?
3. Check the output — did the tool return the right number?
4. If inputs correct but output wrong → bug in `api/voice-agent/calculate-quote.js`. Fix and redeploy.
5. If output correct but she said something different → she hallucinated. Reinforce "Quote only using calculate_quote's output" in the prompt.

### The SMS recap isn't landing in Quo's inbox

1. Check Vercel logs: Dashboard → your project → Logs → filter to `/api/retell-webhook`
2. Look for errors in the response — probably `"sms":{"ok":false}`
3. Common causes:
   - `QUO_API_KEY` env var missing or expired → regenerate in Quo, update Vercel
   - `QUO_FROM_NUMBER` wrong format → must be E.164 (`+17409133693`)
   - `MANAGER_PHONE` wrong format → same
   - Quo A2P registration not approved → check Quo → Settings → Phone numbers → A2P status

### Caller says Maya is robotic / hard to understand

1. Test the current voice in Retell's web player
2. Consider switching to a different 11labs voice — "Sarah," "Rachel," "Adrian" are warm defaults
3. Lower `interruption_sensitivity` (currently 0.8) to 0.5 if she's talking over callers
4. Raise `responsiveness` to 1.0 if she has long pauses

### Maya transfers to a human but nobody answers

1. `transfer_to_manager` destination is currently `+17409133693` (the Quo line)
2. Change to a direct cell number in:
   - Retell Dashboard → LLM → Tools → transfer_to_manager → Transfer Number
   - `voice-agent/retell-llm.json` (for reference/version control)

### A customer says Maya promised something she shouldn't have

1. Find the call in Retell → pull the transcript
2. If Maya made the promise: **honor it** for this customer (customer experience > policy), then tighten the prompt to prevent recurrence
3. If the customer is wrong about what Maya said: politely play back the transcript

---

## 12. Legal & compliance basics

### Call recording disclosure (Ohio)

Ohio is a **one-party consent** state — you don't legally have to tell callers they're being recorded. However, it's best practice. Maya's opening line ("I'm the automated assistant") doesn't explicitly disclose recording. If you want to be belt-and-suspenders, update `begin_message` to:

> "Thanks for calling North Columbus Cleaning. I'm Maya, the automated assistant. This call is recorded for quality. How can I help?"

### TCPA (Telephone Consumer Protection Act)

Because Maya is an automated system and makes autodialed decisions, TCPA applies. The big rules:

- **No outbound marketing calls** without prior express written consent
- **Honor Do Not Call requests** immediately — if a caller says "don't call me again," Maya should log it and you should add them to a suppression list
- **Recurring booking reminders** are transactional and generally fine under TCPA

Maya only **answers inbound** calls, which avoids most TCPA risk. The risk surface is if we add outbound automation later (call-back reminders, etc.).

### Data retention

- **Call recordings**: Retell stores for 30 days by default. Can be extended in settings.
- **Transcripts**: Stored indefinitely in Retell + in the Google Sheet log.
- **SMS recaps**: Stored in Quo + on the manager's phone.

If a customer requests deletion (GDPR/CCPA concepts, though OH doesn't have a comprehensive law yet):
1. Delete from Retell (Dashboard → Calls → specific call → Delete)
2. Delete the row from the Google Sheet
3. Delete the SMS thread if the customer requests

### ADA

The voice agent should be usable by callers who are hard of hearing or have speech impairments. In practice this means:
- She doesn't hang up on callers who speak slowly
- Silence timeout is 20+ seconds
- She's available as a web/text alternative — the website and SMS are fully functional substitutes

---

## 13. Handoff notes (when a human takes over)

When Maya transfers or when you call a customer back after her message:

1. **Pull the call summary** from Quo SMS inbox (lands as a DM from the Quo workspace number to your cell)
2. **Pull the full transcript** from Retell dashboard if you need context the summary missed
3. **Reference the quote** she gave: "Hi Sarah, I'm Dave from North Columbus Cleaning — Maya mentioned you're looking at a bi-weekly cleaning for your 3-bedroom in Worthington. We quoted $253.50 — does that still work for you?"
4. **Honor her commitments.** If she promised a callback by tomorrow, make it happen.
5. **Correct her mistakes gracefully.** "Maya actually misheard that — the deep-cleaning price for your home would be $X, not $Y." Don't throw her under the bus, just correct.

### Maya's "handoff bundle" (what you get after every call)

- **SMS** to manager's cell via Quo (in Quo shared inbox)
- **Row in Google Sheet** with all fields
- **Booking Koala lead** (if intent was a quote)
- **Full transcript + recording** in Retell dashboard
- **Email** from Zapier (optional, if configured)

---

## 14. Change log

Track major changes to the agent here. Date / what changed / why.

| Date | Change | Why |
|---|---|---|
| 2026-04-23 | Initial launch | Phase 1 of AI-forward operations |
| | | |
| | | |

---

## Quick links

- **Repo**: https://github.com/localseobot/northcolumbuscleaning
- **Retell dashboard**: https://beta.retellai.com
- **Quo dashboard**: https://my.quo.com
- **Vercel dashboard**: https://vercel.com/localseobots-projects/northcolumbuscleaning
- **Google Sheet (call log)**: *(link once Zapier is wired)*
- **Booking Koala**: https://northcolumbuscleaning.bookingkoala.com

**Key files**:
- `voice-agent/retell-llm.json` — full prompt + tools config
- `voice-agent/retell-agent.json` — voice + post-call fields
- `voice-agent/faq.md` — uploaded FAQ knowledge base
- `voice-agent/pricing.csv` — pricing source of truth
- `voice-agent/SETUP.md` — first-time setup walkthrough
- `api/retell-webhook.js` — post-call handler
- `api/voice-agent/calculate-quote.js` — quote engine
- `api/voice-agent/check-service-area.js` — zip check
- `api/quo-webhook.js` — inbound Quo events (Phase 2)
- `api/_lib/quo.js` — Quo SMS helper

---

*Last updated: 2026-04-23*
