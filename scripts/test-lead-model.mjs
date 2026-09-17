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

console.log(`\n${passed} passed${process.exitCode ? " — WITH FAILURES" : ""}\n`);
