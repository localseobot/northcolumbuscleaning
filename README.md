# North Columbus Cleaning

A local lead-generation business. The site and the phone number produce
cleaning leads in the North Columbus, OH suburbs, and those leads are sold —
exclusively — to one cleaning company.

We do not perform cleanings. The public site still presents as a cleaning
company, because that is what makes a homeowner call or fill in the form.
Everything behind it exists to capture that enquiry, hand it to the buyer
within seconds, and prove what was delivered.

## How a lead flows

```
Website form ─┐                        ┌─→ SMS to the buyer (seconds)
              ├─→ record in the ledger ─┼─→ Email with full detail
Phone call ───┘        (GHL)            └─→ Row on the buyer's dashboard
```

| Source | Entry point | Recorded by |
|---|---|---|
| Quote form on any page | `POST /api/lead` | `api/lead.js` |
| Price calculator on `/quote` | `POST /api/lead` | `api/lead.js` |
| Inbound call (GHL → buyer phone) | GHL inbound-call / call-status webhook | `api/ghl-call-webhook.js` |
| Inbound call (Retell → "Taylor") | Retell post-call webhook | `api/retell-webhook.js` step 4b |

Both paths converge on `recordLead()` in `api/_lib/lead-ledger.js` and then
`deliverLead()` in `api/_lib/lead-delivery.js`.

The live phone path is **GoHighLevel call forwarding**, not Retell. A homeowner
dials the tracking number on the site; GHL forwards that call to the buyer's
phone; this app records it when GHL posts the webhook. Retell stays wired for
any call that still lands on Taylor — booking/quote intents only.

### Phone leads: what is billable

Forwarded calls are sold when they were **connected / answered**. That is
deliberate: a ring that nobody picked up is not a lead the buyer can work.

| GHL / Twilio status | Recorded as a sold lead? |
|---|---|
| `answered`, `completed`, `connected`, `in-progress` | Yes (subject to the 30-day dedupe window) |
| Duration > 0 with no conflicting status | Yes |
| `missed`, `no-answer`, `busy`, `failed`, `canceled`, `voicemail` | No |
| `ringing`, `initiated`, `queued` | No — wait for a terminal event |
| Completed with duration `0` | No |
| Workflow "Inbound Call" payload with **no** status | Yes, so tracking is live once forwarding is on. Set `GHL_CALL_REQUIRE_ANSWERED=1` to skip these, and filter the GHL workflow to Call Status = completed / answered. |

Outbound calls and SMS/email conversation events posted at this URL are ignored.

The click-to-call number on the site is env-driven: `GET /api/site-config`
returns `TRACKING_NUMBER` (else `GHL_FROM_NUMBER`, else the number already
printed in the HTML). `script.js` rewrites every `tel:` link to match. That
number is the GHL tracking line homeowners dial — never the buyer's personal
phone.

## The ledger

There is no database. GoHighLevel is the system of record, and each fact is
stored at the grain it belongs to:

- **A lead** is an opportunity in the Sales Pipeline. One call or one form
  submission = one opportunity = one row on the dashboard.
- **The outcome** (won / lost / no answer / …) is the opportunity's native
  status and stage, so GHL's own reporting stays correct.
- **Billing state** (repeat caller? credited?) lives in contact tags, because
  "have we already charged for this person" is a fact about a person, not
  about one enquiry.

Tags rather than custom fields is deliberate — tags need no provisioning in
the GHL UI, so nothing has to be clicked through settings before this works.

| Tag | Meaning |
|---|---|
| `lead:delivered` | We sold this contact as a lead. Only these appear on the dashboard. |
| `lead:web` / `lead:phone` | Which channel produced it |
| `lead:duplicate` | Repeat contact inside the dedupe window — delivered, not billed |
| `lead:credited` | We approved a dispute; not billed |
| `dispute:open` / `:approved` / `:denied` | Dispute state |

## The buyer dashboard

`/dashboard` — the buyer sees every lead, what it cost, what they marked it,
and a month-by-month split of website vs phone volume. They can set an outcome
on each lead and report a bad one.

Access is a signed link, not a password: `/dashboard?t=<token>`. Holding the
link is the credential, the same model as a private calendar feed. It is
unforgeable (HMAC-SHA256, `BUYER_SECRET`) and revocable (change
`BUYER_ACCESS_NONCE` and every link ever issued dies).

Mint one:

```sh
curl "https://www.northcolumbuscleaning.com/api/admin/buyer-link?token=$ADMIN_TOKEN"
curl "https://www.northcolumbuscleaning.com/api/admin/buyer-link?token=$ADMIN_TOKEN&send=1"  # and email it
```

### Disputes

The buyer files a dispute from the dashboard; that *opens* it, it does not
credit it. Review and resolve from the admin side — a buyer who could approve
their own refunds isn't disputing, they're just not paying.

```sh
curl "https://www.northcolumbuscleaning.com/api/admin/resolve-dispute?token=$ADMIN_TOKEN"
curl -X POST "https://www.northcolumbuscleaning.com/api/admin/resolve-dispute?token=$ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"id":"<leadId>","decision":"approved","note":"wrong number"}'
```

Approving credits the lead: it drops out of the month's total and out of the
cost-per-lead figure the buyer sees.

## Pricing

Currently **per lead**, moving to a flat monthly rate later. That is a config
change, not a code change — set `LEAD_PRICING_MODE=flat` and the dashboard,
the invoicing arithmetic and the weekly digest all follow.

- `per_lead` — every billable lead × `LEAD_PRICE`.
- `flat` — `LEAD_FLAT_MONTHLY` covers `LEAD_MONTHLY_INCLUDED` leads; extras
  bill at `LEAD_PRICE`.

A contact who comes back inside `LEAD_DEDUPE_DAYS` is delivered again but not
billed again.

## Environment variables

Set in Vercel → Settings → Environment Variables.

| Var | Purpose |
|---|---|
| `BUYER_NAME` | Shown on the dashboard |
| `BUYER_EMAIL` | Lead alert emails + dashboard link |
| `BUYER_PHONE` | Lead alert texts (E.164, e.g. `+16145551234`) |
| `BUYER_SECRET` | Signs dashboard links. Falls back to `ONBOARDING_SECRET` |
| `BUYER_ACCESS_NONCE` | Change to revoke every issued dashboard link |
| `LEAD_PRICING_MODE` | `per_lead` (default) or `flat` |
| `LEAD_PRICE` | Per-lead price in dollars (default 35) |
| `LEAD_FLAT_MONTHLY` | Flat monthly price (default 200) |
| `LEAD_MONTHLY_INCLUDED` | Leads included in the flat rate (default 10) |
| `LEAD_DEDUPE_DAYS` | Repeat-contact grace window (default 30) |
| `OWNER_EMAIL` | Weekly lead digest recipient |
| `ADMIN_TOKEN` | Gates every `/api/admin/*` endpoint |
| `GHL_PIT`, `GHL_LOCATION_ID` | GoHighLevel API. Sub-account id is `XIA5AmegWaylDoPVe3r8`. |
| `TRACKING_NUMBER` | Public click-to-call number in E.164 (the GHL line on the site). |
| `GHL_FROM_NUMBER` | Fallback for `TRACKING_NUMBER` if unset; also the SMS from-number. |
| `GHL_CALL_WEBHOOK_SECRET` | Optional. If set, GHL must send it as `X-Webhook-Secret`. |
| `GHL_CALL_REQUIRE_ANSWERED` | If `1`, skip inbound-call payloads that have no connected/answered signal. |
| `GHL_CALL_MIN_DURATION` | Optional minimum connected seconds (default 0). |
| `RESEND_API_KEY`, `RESEND_FROM` | Transactional email |
| `SITE_BASE_URL` | Canonical origin; used for CORS and link building |
| `CRON_SECRET` | Optional. If set, crons require `Authorization: Bearer` |

Nothing here is required for the site to serve. Missing config degrades
rather than breaks: with no `RESEND_API_KEY` the alert email is skipped, with
no `BUYER_PHONE` the text is skipped, and the lead is still recorded.

## Go-live checklist (phone tracking)

Do these in order. Tracking is live in code the moment this deploy is up;
GHL only has to forward and post.

1. **Deploy this branch** to Vercel (Production). Confirm
   `https://www.northcolumbuscleaning.com/api/ghl-call-webhook` returns
   `{ "ok": true, "endpoint": "ghl-call-webhook" }`.
2. **Vercel → Settings → Environment Variables** (Production), then redeploy:
   - `GHL_PIT`, `GHL_LOCATION_ID=XIA5AmegWaylDoPVe3r8`
   - `TRACKING_NUMBER` — the GHL number printed on the site, E.164
   - `BUYER_NAME`, `BUYER_EMAIL`, `BUYER_PHONE`, `BUYER_SECRET`, `BUYER_ACCESS_NONCE`
   - Suggested buyer (set in Vercel, not in this repo): Lukas / All Cleans
     Solution, `740-971-2907` → `BUYER_PHONE=+17409712907`
3. **GHL phone → forward-to.** Location `XIA5AmegWaylDoPVe3r8` → Phone
   numbers → the tracking line → call forwarding **to the buyer's phone**
   (the same number as `BUYER_PHONE`). Do not forward the live path to
   Retell.
4. **GHL webhook.** Settings → Integrations → Webhooks, or a workflow
   action, POST to:
   `https://www.northcolumbuscleaning.com/api/ghl-call-webhook`
   Prefer Inbound Message (CALL) or Call Status = completed / answered.
   If you use a bare "Inbound Call" trigger, payloads with no status still
   count unless `GHL_CALL_REQUIRE_ANSWERED=1`. Optional header:
   `X-Webhook-Secret` = `GHL_CALL_WEBHOOK_SECRET`.
   Do not also create an opportunity in that workflow — this app does that.
5. **Smoke test.** Call the tracking number from a cell that is not the
   buyer's. The buyer should ring. Within a minute: a row on `/dashboard`,
   a buyer SMS, a buyer email. A hang-up before answer should not bill.

Retell (`/api/retell-webhook`) is left in place. Any call that still reaches
Taylor is recorded on booking/quote intents only.

## Scheduled jobs

| Cron | Schedule | What it does |
|---|---|---|
| `/api/cron/lead-digest` | Mon 13:00 UTC | Weekly owner summary: leads by channel, owed month-to-date, open disputes |
| `/api/admin/audit-calls` | Mon 14:00 UTC | Call-quality audit — how well the phone is capturing leads |

## Tests

```sh
node scripts/test-lead-model.mjs
```

Covers the billing arithmetic in both pricing modes, month grouping, the
outcome vocabulary shared between the ledger and the dashboard, dashboard
token signing, expiry and revocation, GHL call-webhook parsing / billable
rules, and tracking-number formatting. No live GoHighLevel account is
required.

## Stack

Static HTML/CSS/JS with Vercel serverless functions under `api/`. No build
step. Node 24.

```sh
python3 -m http.server 8000   # serve the static site locally
```

Location and service pages under `locations/` and `services/` are generated
by `scripts/generate-pages.py` — edit the template there, not the output.

## Still to wind down

Left in place deliberately, because Booking Koala may still be running while
the old business closes out. Remove once it is disconnected:

- `api/bk-webhook.js` — Booking Koala booking webhook
- `api/onboarding/*`, `onboard.html`, `checklist.html` — cleaner onboarding.
  Already unreachable: the pages redirect, and the only thing that granted
  onboarding eligibility (`api/provider-sync.js`) has been deleted, so no new
  codes can be issued.
- `api/apply.js`, `apply.html` — cleaner recruitment. The careers links are
  gone from the site and `/apply` redirects to the homepage.
- `api/_lib/email-templates/` — several templates (reminder-24h, review
  request, recurring pitch, reactivation, cancellation winback) now have no
  caller except `/api/admin/email-preview`.

The `/promo-signup` popup still captures emails into GHL as a nurture
contact. It is not recorded as a billable lead: an email with no phone number
and no stated job isn't something the buyer can act on.
