# Post-job review request — GHL workflow

When a Sales Pipeline opportunity moves to **Won**, fire an SMS asking the customer for a Google review 4 hours later. This is the single highest-leverage CRO move for a new business: a steady stream of fresh reviews compounds trust over time.

Build once in the GHL UI (can't be done via API). Should take ~10 minutes.

## Step-by-step

### 1. Get your Google review link

1. Open https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID
2. Find your `place_id`: go to https://www.google.com/maps, search "North Columbus Cleaning Company," click your business, copy the URL. The Place ID lookup tool is at https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder
3. The final link looks like: `https://search.google.com/local/writereview?placeid=ChIJ_____...`
4. Test it on your phone — it should open Google Maps with the review modal already open
5. Bonus: shorten via Google's official short-URL or bit.ly so it doesn't look spammy in SMS

### 2. Build the workflow in GHL

1. GHL sub-account → **Automation** → **Workflows** → **+ Create workflow** → **Start from scratch**
2. Name: `Post-job review request`
3. **Trigger**: click **+ Add Trigger** → **"Pipeline Stage Changed"** (or "Opportunity Status Changed")
4. Trigger filters:
   - **Pipeline**: `Sales Pipeline`
   - **Stage**: `Won`
5. Save trigger.

### 3. Add the wait

1. Click **+ Add Action** → **"Wait"**
2. Type: **Time delay**
3. Value: **4 hours**
4. (Optional: add "Wait until business hours" sub-condition so the text doesn't fire at 3am if you marked the opp Won late at night. Business hours: M–Sa 9a–7p Eastern.)
5. Save.

### 4. Add the SMS

1. Click **+ Add Action** → **"Send SMS"**
2. **From**: leave on your A2P-verified GHL number (the location default)
3. **To**: `{{contact.phone}}`
4. **Message** — paste this:

```
Hi {{contact.first_name}}, this is the team at North Columbus Cleaning. Hope your home is looking great! 🧼

If you have 30 seconds, we'd love a quick Google review — it genuinely helps a local business like ours: https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID

Thanks so much!
— NCC
```

Replace `YOUR_PLACE_ID` with your real Place ID. Don't include emoji if you're worried about character count; A2P short codes count emoji as multiple SMS segments.

5. Save the SMS action.

### 5. Add an opt-out check (compliance)

Before the SMS, add an If/Else block:
- **Condition**: contact does NOT have tag `do-not-contact` AND does NOT have tag `sms-consent:no`
- **Yes branch**: continue to SMS (which you just built)
- **No branch**: end workflow

This prevents accidentally texting someone who opted out.

### 6. Publish

1. Top right: **Draft → Published**
2. Confirm.

## Optional: 3-day "gentle nudge" if no review yet

You can't directly detect whether they left a review (Google doesn't ping you). But you can use the absence of a "left-review" tag as a proxy:

1. After the first SMS, add **Wait 3 days**
2. Add If/Else: contact has tag `left-google-review`?
   - **Yes** → end
   - **No** → send a friendly second SMS: *"Just a quick follow-up — if you have a sec, a Google review really means a lot. Link: …"*

To use this, you'd manually add the `left-google-review` tag to contacts when you see their review on Google. Or skip the nudge entirely — many operators only send once to avoid feeling pushy.

## How to measure

Track in your dashboard (`/api/admin/calls?token=…`) — the win-rate KPI captures "opps moved to Won." Cross-reference with Google reviews count weekly.

Realistic target: if you're winning ~3 opps/week and you ask each one, expect 1–2 new reviews/week. That's 50+ new reviews per year from this single workflow.

## Troubleshooting

| Symptom | Fix |
|---|---|
| SMS sends to people without phones | Add another If/Else condition: `{{contact.phone}}` is not empty |
| Wrong customer name in SMS | Make sure your BK→GHL sync puts firstName on the contact, not in a custom field |
| SMS never fires | Check the workflow's "Execution log" tab — usually trigger filters are mismatched (wrong pipeline, wrong stage spelling) |
| Customers complain about getting the text at odd hours | Add the "wait until business hours" condition step #3 above |
