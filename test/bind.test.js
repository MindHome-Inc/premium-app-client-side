const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../rating/engine");
const U = require("../rating/underwriting");
const B = require("../bind/bind");

/* The plan's sample Boulder home, with the Complete Bundle + pro install. */
const BOULDER = {
  sqft: 2150, yearBuilt: 1998, construction: "frame", roofYear: 2014,
  roofMaterial: "asphalt", protectionClass: 3, asOf: "2026-11-03T00:00:00Z",
};
const BUNDLE = { ext: 2, ting: 1, shutoff: 1, sensor: 5 };
const FACTS = { occupancy: "primary", stationMiles: 1.4, losses: 0, wildfire: "moderate", woodStove: false, unfencedPool: false };
const NOW = new Date("2026-11-03T17:00:00Z"); // 10:00 in Denver
const TODAY = "2026-11-03";

function snapshot({ devices = BUNDLE, proInstall = true, facts = {}, deviceCharge } = {}) {
  const rated = R.rate({ ...BOULDER, devices, proInstall });
  const uw = U.decide({ ...FACTS, ...facts, yearBuilt: 1998, roofYear: 2014, roofMaterial: "asphalt", protectionClass: 3, coverageA: rated.coverageA }, BOULDER.asOf);
  return B.snapshotFromQuote(rated, uw, {
    quoteRef: "HQ-978754",
    namedInsured: { first: "Jordan", last: "Maxwell" },
    propertyAddress: "482 Marigold Ln, Boulder, CO 80302",
    devices,
    proInstall,
    installWindow: "Week of Nov 16 · mornings",
    deviceCharge: deviceCharge || { amount: 921, financing: "once" },
  });
}
const ACKS = Object.fromEntries(B.BIND_CONFIG.acknowledgements.map((a) => [a.id, true]));
const CARD = { method: "card", card: { name: "Jordan Maxwell", number: "4242 4242 4242 4242", exp: "12/28", cvc: "123", zip: "80302" } };
function app(over = {}) {
  return {
    effectiveDate: "2026-11-10",
    mortgagee: { has: false },
    plan: "full",
    payment: B.sandboxTokenize(CARD),
    acks: ACKS,
    signature: "Jordan Maxwell",
    ...over,
  };
}

test("Boulder sample: bind reconciles to the $1,611 worksheet, two separate charges", async () => {
  const s = snapshot();
  assert.equal(s.annualPremium, 1611);
  assert.deepEqual(B.reconcileQuote(s), []);
  const r = await B.runBind({ snapshot: s, application: app() }, { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.status, "bound");
  assert.equal(r.dueToday.premium.amount, 1611);
  assert.equal(r.dueToday.device.amount, 921);
  assert.equal(r.dueToday.premium.payee, "MindHome Homeowners Reciprocal Exchange");
  assert.equal(r.dueToday.device.payee, "MindHome Inc.");
  const cap = r.events.find((e) => e.type === "payment.captured");
  assert.deepEqual(cap.charges.map((c) => [c.kind, c.amount]), [["premium", 1611], ["device", 921]]);
  assert.notEqual(cap.charges[0].processorRef, cap.charges[1].processorRef);
});

test("bind emits events in the required order", async () => {
  const r = await B.runBind({ snapshot: snapshot(), application: app({ mortgagee: { has: true, name: "First Western Bank", loanNumber: "LN-55821" } }) }, { now: NOW });
  assert.deepEqual(r.events.map((e) => e.type), [
    "application.signed", "payment.captured", "policy.bound", "endorsement.attached",
    "subscriber.enrolled", "fulfillment.released", "install.booked", "evidence.sent",
  ]);
  const times = r.events.map((e) => e.occurredAt);
  assert.deepEqual([...times].sort(), times);
  const bound = r.events.find((e) => e.type === "policy.bound");
  assert.equal(bound.form, "HO-3");
  assert.equal(bound.effectiveDate, "2026-11-10");
  assert.equal(bound.expirationDate, "2027-11-10");
  assert.equal(bound.premium.annual, 1611);
  assert.equal(bound.policyNumber, null);
});

test("optional events drop out: no devices, no mortgagee", async () => {
  const s = snapshot({ devices: {}, proInstall: false, deviceCharge: { amount: 0, financing: "once" } });
  assert.equal(s.annualPremium, 3193);
  const r = await B.runBind({ snapshot: s, application: app() }, { now: NOW });
  assert.deepEqual(r.events.map((e) => e.type), ["application.signed", "payment.captured", "policy.bound", "subscriber.enrolled"]);
});

test("MH-100 is attached as provisional, verified within 60 days of the effective date", async () => {
  const r = await B.runBind({ snapshot: snapshot(), application: app() }, { now: NOW });
  const e = r.events.find((x) => x.type === "endorsement.attached").endorsement;
  assert.equal(e.code, "MH-100");
  assert.equal(e.status, "provisional");
  assert.equal(e.pct, 50);
  assert.equal(e.verifyBy, "2027-01-09");
  assert.match(e.ifUnverified, /pro-rata additional premium/);
  assert.match(e.continuesWhile, /heartbeat/);
});

test("premium plans split $1,611 exactly; 10-pay adds a one-time $6 fee", () => {
  const opts = { bindDate: TODAY, effectiveDate: "2026-11-10" };
  const two = B.premiumSchedule(1611, "two_pay", opts);
  assert.deepEqual(two.installments.map((i) => i.amount), [805.5, 805.5]);
  assert.deepEqual(two.installments.map((i) => i.dueDate), ["2026-11-03", "2027-05-10"]);
  const ten = B.premiumSchedule(1611, "ten_pay", opts);
  assert.equal(ten.installments.length, 10);
  assert.equal(ten.dueToday, 167.1);
  assert.deepEqual(ten.installments.slice(1).map((i) => i.amount), Array(9).fill(161.1));
  assert.equal(ten.fees, 6);
  assert.equal(ten.totalPayable, 1617);
  assert.equal(ten.installments.reduce((s, i) => s + Math.round(i.premium * 100), 0), 161100);
  const odd = B.premiumSchedule(1000, "ten_pay", opts); // uneven cents go on installment 1
  assert.equal(odd.installments.reduce((s, i) => s + Math.round(i.premium * 100), 0), 100000);
  const mort = B.premiumSchedule(1611, "mortgagee", opts);
  assert.equal(mort.billedTo, "mortgagee");
  assert.equal(mort.dueToday, 0);
});

test("mortgagee bill: no premium charged today, device still charged separately", async () => {
  const r = await B.runBind({ snapshot: snapshot(), application: app({ plan: "mortgagee", mortgagee: { has: true, name: "First Western Bank", loanNumber: "LN-55821" } }) }, { now: NOW });
  assert.equal(r.dueToday.premium.amount, 0);
  assert.equal(r.dueToday.device.amount, 921);
  const cap = r.events.find((e) => e.type === "payment.captured");
  assert.deepEqual(cap.charges.map((c) => [c.kind, c.amount, c.status]), [["premium", 0, "billed_to_mortgagee"], ["device", 921, "captured"]]);
});

test("refer: submit to underwriter, nothing charged, no policy.bound, order + install held 7 days", async () => {
  const s = snapshot({ facts: { woodStove: true, losses: 2 } });
  assert.equal(s.uw.decision, "refer");
  const r = await B.runBind({ snapshot: s, application: app() }, { now: NOW });
  assert.equal(r.status, "referred");
  const types = r.events.map((e) => e.type);
  assert.deepEqual(types, ["application.signed", "application.referred"]);
  assert.equal(r.dueToday.premium.amount, 0);
  assert.equal(r.dueToday.device.amount, 0);
  assert.ok(!types.includes("policy.bound"));
  assert.ok(!types.includes("fulfillment.released"));
  assert.deepEqual(r.charges.map((c) => [c.kind, c.amount, c.status]), [["premium", 0, "not_captured_referral"], ["device", 0, "not_captured_referral"]]);
  const ref = r.events.find((e) => e.type === "application.referred");
  assert.equal(ref.premium.dueOnApproval, 1611);
  assert.equal(ref.devices.dueOnApproval, 921);
  assert.equal(ref.deviceOrder.status, "on_hold");
  assert.equal(ref.deviceOrder.holdUntil, "2026-11-10");
  assert.equal(ref.installWindow.status, "held");
  assert.equal(ref.fulfillmentReleased, false);
});

test("a declined quote can't be bound", async () => {
  const s = snapshot({ facts: { losses: 3 } });
  const r = await B.runBind({ snapshot: s, application: app() }, { now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /declined/);
});

test("a premium that doesn't reconcile to the worksheet is refused, not rounded", async () => {
  const s = { ...snapshot(), annualPremium: 1612 };
  assert.match(B.reconcileQuote(s).join(), /doesn't match the worksheet/);
  const t = { ...snapshot(), credits: { ...snapshot().credits, applied: [{ name: "fire", pct: 20 }, { name: "water", pct: 30 }] }, proInstall: false };
  assert.match(B.reconcileQuote(t).join(), /don't match the devices/);
});

test("field-level errors, one per field", () => {
  const s = snapshot();
  const errs = B.validateApplication(
    {
      effectiveDate: "2027-02-01",
      mortgagee: { has: true, name: "", loanNumber: "x" },
      plan: "ten_pay",
      payment: { method: "card", card: { name: "", number: "4242 4242 4242 4241", exp: "01/25", cvc: "12", zip: "803" } },
      acks: { device_separate: true },
      signature: "Jordan Max",
    },
    { snapshot: s, today: TODAY, paymentMode: "raw" },
  );
  assert.deepEqual(Object.keys(errs).sort(), [
    "acks.mh100_provisional", "acks.other_devices", "acks.subscriber_aif",
    "effectiveDate", "mortgagee.loanNumber", "mortgagee.name",
    "payment.card.cvc", "payment.card.exp", "payment.card.name", "payment.card.number", "payment.card.zip",
    "signature",
  ]);
  assert.match(errs.effectiveDate, /within 60 days/);
});

test("effective date window is today through +60", () => {
  const s = snapshot();
  const v = (d) => B.validateApplication(app({ effectiveDate: d }), { snapshot: s, today: TODAY, paymentMode: "token" }).effectiveDate;
  assert.equal(v("2026-11-03"), undefined);
  assert.equal(v("2027-01-02"), undefined);
  assert.match(v("2027-01-03"), /within 60 days/);
  assert.match(v("2026-11-02"), /past/);
});

test("ACH checks routing checksum, matching account and the debit authorization", () => {
  const s = snapshot();
  const raw = (ach) => B.validateApplication(app({ payment: { method: "ach", ach } }), { snapshot: s, today: TODAY, paymentMode: "raw" });
  const ok = { name: "Jordan Maxwell", routing: "021000021", account: "000123456789", accountConfirm: "000123456789", type: "checking", authorized: true };
  assert.deepEqual(raw(ok), {});
  const bad = raw({ ...ok, routing: "021000022", accountConfirm: "1", authorized: false });
  assert.deepEqual(Object.keys(bad).sort(), ["payment.ach.accountConfirm", "payment.ach.authorized", "payment.ach.routing"]);
});

test("signature must match the named insured (case and spacing don't matter)", () => {
  const s = snapshot();
  const v = (sig) => B.validateApplication(app({ signature: sig }), { snapshot: s, today: TODAY, paymentMode: "token" }).signature;
  assert.equal(v("  jordan   maxwell "), undefined);
  assert.match(v("J Maxwell"), /exactly as the named insured/);
});

test("tokenizing keeps raw numbers out of the payload", () => {
  const t = B.sandboxTokenize(CARD);
  assert.equal(t.last4, "4242");
  assert.equal(t.brand, "visa");
  assert.ok(!JSON.stringify(t).includes("4242424242424242"));
  assert.ok(!("cvc" in t));
});

test("a failed device charge voids the premium charge", async () => {
  const voided = [];
  const proc = {
    premium: { capture: async () => ({ ref: "pi_1", status: "captured" }), void: async (ref) => voided.push(ref) },
    device: { capture: async () => { throw new Error("card declined"); }, void: async () => {}, createOrder: async () => ({}) },
  };
  const r = await B.runBind({ snapshot: snapshot(), application: app() }, { now: NOW, processors: proc });
  assert.equal(r.ok, false);
  assert.match(r.errors.payment, /card declined/);
  assert.deepEqual(voided, ["pi_1"]);
});

test("refer still asks for payment, so devices can be charged on approval", () => {
  const s = snapshot({ facts: { woodStove: true } });
  const sched = B.premiumSchedule(s.annualPremium, "mortgagee", { bindDate: TODAY, effectiveDate: TODAY });
  assert.equal(B.paymentRequired(s, sched), true);
  const noDevices = snapshot({ facts: { woodStove: true }, devices: {}, proInstall: false, deviceCharge: { amount: 0, financing: "once" } });
  assert.equal(B.paymentRequired(noDevices, sched), false);
});
