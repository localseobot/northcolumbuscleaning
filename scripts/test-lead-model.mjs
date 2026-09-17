// Tests for the lead-sales business rules.
//
// These cover the arithmetic the buyer's invoice depends on and the state
// mapping the dashboard reads back — the parts where being quietly wrong
// costs real money or real trust. Run: node scripts/test-lead-model.mjs

import assert from "node:assert/strict";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
}

// The libs read config from the environment, so set it before importing.
process.env.LEAD_PRICING_MODE = "per_lead";
process.env.LEAD_PRICE = "35";
process.env.LEAD_FLAT_MONTHLY = "200";
process.env.LEAD_MONTHLY_INCLUDED = "10";
process.env.BUYER_SECRET = "test-secret-not-a-real-one";

const { priceLeads, getPricing } = await import("../api/_lib/buyer.js");
const { groupByMonth, outcomeLabel, OUTCOME_KEYS } = await import("../api/_lib/lead-ledger.js");
const { signBuyerToken, verifyBuyerToken } = await import("../api/_lib/buyer-token.js");
const { parseGhlCallEvent, classifyGhlCall, selectCallerPhone } = await import("../api/_lib/ghl-call.js");
const { toE164, formatUsDisplay, getTrackingNumber, FALLBACK_TRACKING_E164 } = await import("../api/_lib/phone.js");
const ghlCallWebhook = (await import("../api/ghl-call-webhook.js")).default;

const leads = (n, billable = true) => Array.from({ length: n }, () => ({ billable }));

console.log("\nper-lead billing");
{
  const p = { ...getPricing(), mode: "per_lead", perLead: 35 };
  test("bills every billable lead", () => {
    assert.equal(priceLeads(leads(4), p).total, 140);
  });
  test("free leads cost nothing", () => {
    const mixed = [...leads(3), ...leads(2, false)];
    const r = priceLeads(mixed, p);
    assert.equal(r.billable, 3);
    assert.equal(r.total, 105);
  });
  test("a month with no leads owes nothing and reports no cost per lead", () => {
    const r = priceLeads([], p);
    assert.equal(r.total, 0);
    assert.equal(r.costPerLead, null);
  });
}

console.log("\nflat billing");
{
  const p = { ...getPricing(), mode: "flat", flatMonthly: 200, includedPerMonth: 10, perLead: 35 };
  test("under the allowance costs the flat fee only", () => {
    const r = priceLeads(leads(6), p);
    assert.equal(r.total, 200);
    assert.equal(r.overage, 0);
  });
  test("at exactly the allowance there is no overage", () => {
    const r = priceLeads(leads(10), p);
    assert.equal(r.total, 200);
    assert.equal(r.overage, 0);
  });
  test("over the allowance bills the extras", () => {
    const r = priceLeads(leads(13), p);
    assert.equal(r.overage, 3);
    assert.equal(r.total, 200 + 3 * 35);
  });
  test("cost per lead falls as volume rises", () => {
    const few = priceLeads(leads(4), p).costPerLead;
    const many = priceLeads(leads(10), p).costPerLead;
    assert.equal(few, 50);
    assert.equal(many, 20);
    assert.ok(many < few);
  });
  test("free leads do not consume the allowance", () => {
    const r = priceLeads([...leads(10), ...leads(4, false)], p);
    assert.equal(r.billable, 10);
    assert.equal(r.total, 200);
  });
}

console.log("\nmonth grouping");
{
  test("groups by calendar month, newest first", () => {
    const g = groupByMonth([
      { receivedAt: "2026-09-02T10:00:00Z", billable: true },
      { receivedAt: "2026-08-30T10:00:00Z", billable: true },
      { receivedAt: "2026-09-28T10:00:00Z", billable: true },
    ]);
    assert.equal(g.length, 2);
    assert.equal(g[0][0], "2026-09");
    assert.equal(g[0][1].length, 2);
    assert.equal(g[1][0], "2026-08");
  });
  test("ignores leads with no or unparseable date", () => {
    const g = groupByMonth([
      { receivedAt: null, billable: true },
      { receivedAt: "not a date", billable: true },
      { receivedAt: "2026-09-02T10:00:00Z", billable: true },
    ]);
    assert.equal(g.length, 1);
    assert.equal(g[0][1].length, 1);
  });
}

console.log("\noutcomes");
{
  test("every outcome the dashboard offers has a label", () => {
    for (const k of OUTCOME_KEYS) {
      assert.ok(outcomeLabel(k), `no label for ${k}`);
    }
  });
  test("the dashboard's outcome list matches the ledger's", () => {
    // Kept in step by hand — this test is the thing that catches the drift.
    const inDashboard = ["new", "contacted", "quoted", "booked", "won", "lost", "no_answer"];
    assert.deepEqual([...OUTCOME_KEYS].sort(), [...inDashboard].sort());
  });
}

console.log("\ndashboard access tokens");
{
  test("a freshly minted token verifies", () => {
    const t = signBuyerToken();
    assert.equal(verifyBuyerToken(t).sub, "buyer");
  });
  test("a tampered payload is rejected", () => {
    const t = signBuyerToken();
    const [p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({
      sub: "buyer", nonce: "v1", purpose: "buyer-dashboard",
      exp: Math.floor(Date.now() / 1000) + 999, v: 1,
    })).toString("base64url");
    assert.notEqual(forged, p);
    assert.throws(() => verifyBuyerToken(`${forged}.${s}`), (e) => e.code === "badsig");
  });
  test("an expired token is rejected", () => {
    assert.throws(() => verifyBuyerToken(signBuyerToken({ ttlSeconds: -10 })), (e) => e.code === "expired");
  });
  test("rotating the nonce revokes outstanding links", () => {
    const t = signBuyerToken();
    process.env.BUYER_ACCESS_NONCE = "rotated";
    assert.throws(() => verifyBuyerToken(t), (e) => e.code === "revoked");
    delete process.env.BUYER_ACCESS_NONCE;
  });
  test("garbage is rejected without throwing something unexpected", () => {
    for (const bad of ["", "nope", "a.b", "....", "eyJ9.x"]) {
      assert.throws(() => verifyBuyerToken(bad), (e) => typeof e.code === "string");
    }
  });
}

console.log("\nGHL call webhook parsing");
{
  const inboundCompleted = {
    type: "OutboundMessage",
    locationId: "XIA5AmegWaylDoPVe3r8",
    contactId: "gblakL5aYQC4glDtP1r2t3",
    direction: "inbound",
    messageType: "CALL",
    status: "completed",
    callDuration: 120,
    callStatus: "completed",
    messageId: "tyW42xCD0HQpb3hhfLcx",
  };

  test("parses GHL InboundMessage CALL completed (official shape)", () => {
    const e = parseGhlCallEvent(inboundCompleted);
    assert.equal(e.isCall, true);
    assert.equal(e.direction, "inbound");
    assert.equal(e.status, "completed");
    assert.equal(e.duration, 120);
    assert.equal(e.contactId, "gblakL5aYQC4glDtP1r2t3");
    assert.equal(e.locationId, "XIA5AmegWaylDoPVe3r8");
    assert.equal(e.messageId, "tyW42xCD0HQpb3hhfLcx");
  });

  test("completed inbound call is billable", () => {
    const c = classifyGhlCall(parseGhlCallEvent(inboundCompleted));
    assert.equal(c.skip, false);
    assert.equal(c.connected, true);
  });

  test("missed / no-answer / voicemail are not sold", () => {
    for (const status of ["missed", "no-answer", "voicemail", "busy", "failed", "canceled"]) {
      const c = classifyGhlCall(parseGhlCallEvent({
        direction: "inbound",
        messageType: "CALL",
        callStatus: status,
        from: "+16145551212",
      }));
      assert.equal(c.skip, true, status);
    }
  });

  test("ringing is ignored until a terminal event", () => {
    const c = classifyGhlCall(parseGhlCallEvent({
      direction: "inbound",
      messageType: "CALL",
      CallStatus: "ringing",
      From: "+16145551212",
    }));
    assert.equal(c.skip, true);
    assert.match(c.reason, /early status/);
  });

  test("zero-duration completed is not connected", () => {
    const c = classifyGhlCall(parseGhlCallEvent({
      direction: "inbound",
      messageType: "CALL",
      callStatus: "completed",
      callDuration: 0,
      from: "+16145551212",
    }));
    assert.equal(c.skip, true);
  });

  test("outbound calls are ignored", () => {
    const c = classifyGhlCall(parseGhlCallEvent({
      type: "OutboundMessage",
      direction: "outbound",
      messageType: "CALL",
      callStatus: "completed",
      callDuration: 90,
    }));
    assert.equal(c.skip, true);
    assert.match(c.reason, /outbound/);
  });

  test("SMS conversation events are ignored", () => {
    const c = classifyGhlCall(parseGhlCallEvent({
      direction: "inbound",
      messageType: "SMS",
      body: "hi",
      phone: "+16145551212",
    }));
    assert.equal(c.skip, true);
  });

  test("GHL workflow inbound-call payload (contact + phone, no status) is a lead", () => {
    const e = parseGhlCallEvent({
      contact_id: "abc123",
      first_name: "Maya",
      last_name: "Lee",
      phone: "(614) 555-1212",
      email: "maya@example.com",
      location: { id: "XIA5AmegWaylDoPVe3r8" },
    });
    assert.equal(e.contactId, "abc123");
    assert.equal(e.phone, "+16145551212");
    assert.equal(e.name, "Maya Lee");
    assert.equal(e.email, "maya@example.com");
    const c = classifyGhlCall(e);
    assert.equal(c.skip, false);
  });

  test("requireAnswered skips the no-status workflow payload", () => {
    const e = parseGhlCallEvent({ contact_id: "abc123", phone: "+16145551212" });
    const c = classifyGhlCall(e, { requireAnswered: true });
    assert.equal(c.skip, true);
  });

  test("Twilio-style status callback (completed + duration) is connected", () => {
    const e = parseGhlCallEvent({
      CallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      CallStatus: "completed",
      CallDuration: "45",
      From: "+16145551212",
      To: "+16143522588",
      Direction: "inbound",
    });
    assert.equal(e.isCall, true);
    assert.equal(e.phone, "+16145551212");
    assert.equal(e.to, "+16143522588");
    assert.equal(e.duration, 45);
    assert.equal(classifyGhlCall(e).connected, true);
  });

  test("nested customData fields are found", () => {
    const e = parseGhlCallEvent({
      customData: { phone: "+17405550100", call_status: "answered" },
      contact: { id: "contact-1", firstName: "Lukas" },
    });
    assert.equal(e.phone, "+17405550100");
    assert.equal(e.status, "answered");
    assert.equal(e.contactId, "contact-1");
    assert.equal(e.name, "Lukas");
    assert.equal(classifyGhlCall(e).skip, false);
  });

  test("contact.phone wins over From when From is our tracking line", () => {
    const e = parseGhlCallEvent({
      direction: "inbound",
      messageType: "CALL",
      callStatus: "completed",
      callDuration: 30,
      From: "+16143522588",
      To: "+17409712907",
      contact: { phone: "(614) 555-1212" },
    });
    assert.equal(e.phone, "+16145551212");
  });

  test("selectCallerPhone drops tracking and buyer numbers", () => {
    assert.equal(
      selectCallerPhone(
        ["+16143522588", "+17409712907", "6145551212"],
        ["+16143522588", "+17409712907"],
      ),
      "+16145551212",
    );
  });
}

console.log("\ntracking number");
{
  test("10-digit US numbers become E.164", () => {
    assert.equal(toE164("(614) 352-2588"), "+16143522588");
    assert.equal(toE164("7409712907"), "+17409712907");
  });
  test("formats the public display string", () => {
    assert.equal(formatUsDisplay("+16143522588"), "(614) 352-2588");
  });
  test("falls back to the number already on the site", () => {
    const t = getTrackingNumber({});
    assert.equal(t.e164, FALLBACK_TRACKING_E164);
    assert.equal(t.href, "tel:+16143522588");
    assert.equal(t.display, "(614) 352-2588");
  });
  test("TRACKING_NUMBER wins over GHL_FROM_NUMBER", () => {
    const t = getTrackingNumber({
      TRACKING_NUMBER: "6145550100",
      GHL_FROM_NUMBER: "+16143522588",
    });
    assert.equal(t.e164, "+16145550100");
    assert.equal(t.display, "(614) 555-0100");
  });
}

function mockReq(method, body = {}, headers = {}) {
  return { method, body, headers, query: {} };
}
function mockRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.setHeader = (k, v) => {
    r.headers[k] = v;
  };
  r.status = (c) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b) => {
    r.body = b;
    return r;
  };
  r.end = () => r;
  return r;
}

console.log("\nGHL call webhook handler (no live GHL)");
{
  await (async () => {
    async function atest(name, fn) {
      try {
        await fn();
        passed++;
        console.log(`  ok   ${name}`);
      } catch (e) {
        process.exitCode = 1;
        console.error(`  FAIL ${name}\n       ${e.message}`);
      }
    }

    await atest("GET is a liveness check", async () => {
      const res = mockRes();
      await ghlCallWebhook(mockReq("GET"), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.endpoint, "ghl-call-webhook");
    });

    await atest("missed call is acknowledged and not recorded", async () => {
      const res = mockRes();
      await ghlCallWebhook(
        mockReq("POST", {
          direction: "inbound",
          messageType: "CALL",
          callStatus: "missed",
          from: "+16145551212",
        }),
        res,
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.lead.attempted, false);
      assert.match(String(res.body.skipped), /not connected/);
    });

    await atest("wrong webhook secret is rejected", async () => {
      process.env.GHL_CALL_WEBHOOK_SECRET = "s3cret";
      const res = mockRes();
      await ghlCallWebhook(mockReq("POST", { from: "+16145551212" }, {}), res);
      assert.equal(res.statusCode, 401);
      delete process.env.GHL_CALL_WEBHOOK_SECRET;
    });

    await atest("location mismatch is skipped", async () => {
      process.env.GHL_LOCATION_ID = "XIA5AmegWaylDoPVe3r8";
      const res = mockRes();
      await ghlCallWebhook(
        mockReq("POST", {
          ...{
            direction: "inbound",
            messageType: "CALL",
            callStatus: "completed",
            callDuration: 30,
            from: "+16145551212",
          },
          locationId: "some-other-location",
        }),
        res,
      );
      assert.equal(res.statusCode, 200);
      assert.match(String(res.body.skipped), /location mismatch/);
      delete process.env.GHL_LOCATION_ID;
    });
  })();
}

console.log(`\n${passed} passed${process.exitCode ? " — WITH FAILURES" : ""}\n`);
