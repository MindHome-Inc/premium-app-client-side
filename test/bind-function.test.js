const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../rating/engine");
const U = require("../rating/underwriting");
const B = require("../bind/bind");
const { handler } = require("../netlify/functions/bind");

const BOULDER = {
  sqft: 2150, yearBuilt: 1998, construction: "frame", roofYear: 2014,
  roofMaterial: "asphalt", protectionClass: 3, asOf: "2026-11-03T00:00:00Z",
  devices: { ext: 2, ting: 1, shutoff: 1, sensor: 5 }, proInstall: true,
};
const rated = R.rate(BOULDER);
const uw = U.decide({ occupancy: "primary", stationMiles: 1.4, losses: 0, yearBuilt: 1998, roofYear: 2014, roofMaterial: "asphalt", protectionClass: 3, coverageA: rated.coverageA }, BOULDER.asOf);
const SNAPSHOT = B.snapshotFromQuote(rated, uw, {
  quoteRef: "HQ-100200",
  namedInsured: { first: "Jordan", last: "Maxwell" },
  devices: BOULDER.devices,
  proInstall: true,
  deviceCharge: { amount: 921, financing: "once" },
});
const today = B.todayIn();
const APPLICATION = {
  effectiveDate: today,
  mortgagee: { has: false },
  plan: "full",
  payment: B.sandboxTokenize({ method: "card", card: { name: "Jordan Maxwell", number: "4242424242424242", exp: "12/39", cvc: "123", zip: "80302" } }),
  acks: Object.fromEntries(B.BIND_CONFIG.acknowledgements.map((a) => [a.id, true])),
  signature: "Jordan Maxwell",
};

async function call(body) {
  const logged = [];
  const orig = console.log;
  console.log = (line) => logged.push(line);
  try {
    const res = await handler({ httpMethod: "POST", headers: { "user-agent": "test" }, body: JSON.stringify(body) });
    const events = logged.filter((l) => String(l).startsWith("INTEGRATION_LOG ")).map((l) => JSON.parse(l.slice(16)));
    return { res, body: JSON.parse(res.body), events };
  } finally {
    console.log = orig;
  }
}

test("bind function binds the Boulder sample and logs each event in order", async () => {
  const { res, body, events } = await call({ snapshot: SNAPSHOT, application: APPLICATION });
  assert.equal(res.statusCode, 200);
  assert.equal(body.status, "bound");
  assert.equal(body.dueToday.premium.amount, 1611);
  assert.equal(body.dueToday.device.amount, 921);
  assert.deepEqual(events.map((e) => e.type), [
    "application.signed", "payment.captured", "policy.bound", "endorsement.attached",
    "subscriber.enrolled", "fulfillment.released", "install.booked",
  ]);
  assert.ok(events.every((e) => e.sandbox === true && e.quoteRef === "HQ-100200"));
});

test("bind function returns field-level errors as 422", async () => {
  const { res, body, events } = await call({ snapshot: SNAPSHOT, application: { ...APPLICATION, signature: "", acks: {} } });
  assert.equal(res.statusCode, 422);
  assert.ok(body.errors.signature);
  assert.ok(body.errors["acks.device_separate"]);
  assert.equal(events.length, 0);
});

test("bind function refuses a quote that doesn't reconcile", async () => {
  const { res, events } = await call({ snapshot: { ...SNAPSHOT, annualPremium: 1500 }, application: APPLICATION });
  assert.equal(res.statusCode, 409);
  assert.equal(events.length, 0);
});

test("bind function refuses a raw card number in place of a token", async () => {
  const { res, body } = await call({ snapshot: SNAPSHOT, application: { ...APPLICATION, payment: { method: "card", card: { number: "4242424242424242" } } } });
  assert.equal(res.statusCode, 422);
  assert.ok(body.errors["payment.token"]);
});

test("bind function refuses an unconfigured premium processor", async () => {
  process.env.PREMIUM_PROCESSOR = "stripe";
  try {
    const { res, body } = await call({ snapshot: SNAPSHOT, application: APPLICATION });
    assert.equal(res.statusCode, 500);
    assert.match(body.error, /not set up/);
  } finally {
    delete process.env.PREMIUM_PROCESSOR;
  }
});
