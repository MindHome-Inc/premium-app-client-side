const test = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../netlify/functions/underwrite");

const INPUT = {
  sqft: 2150, yearBuilt: 1998, construction: "frame", roofYear: 2014,
  roofMaterial: "asphalt", protectionClass: 3, asOf: "2026-10-13T00:00:00Z",
};
const FACTS = { occupancy: "primary", stationMiles: 1.4, losses: 0, wildfire: "moderate", woodStove: false, unfencedPool: false };

async function call(body) {
  const logged = [];
  const orig = console.log;
  console.log = (line) => logged.push(line);
  try {
    const res = await handler({ httpMethod: "POST", body: JSON.stringify(body) });
    const line = logged.find((l) => String(l).startsWith("INTEGRATION_LOG "));
    return { res, logged: line && JSON.parse(line.slice("INTEGRATION_LOG ".length)) };
  } finally {
    console.log = orig;
  }
}

test("underwrite function accepts the Boulder sample and logs uw.decision", async () => {
  const { res, logged } = await call({ quoteRef: "HQ-100200", input: INPUT, facts: FACTS });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).result.decision, "accept");
  assert.equal(logged.type, "uw.decision");
  assert.equal(logged.quoteRef, "HQ-100200");
  assert.equal(logged.decision, "accept");
  assert.equal(logged.inputs.coverageA, 613000);
});

test("underwrite function refers with reasons and the referral flag", async () => {
  const { logged } = await call({ quoteRef: "HQ-1", input: INPUT, facts: { ...FACTS, unfencedPool: true } });
  assert.equal(logged.decision, "refer");
  assert.deepEqual(logged.reasons.map((r) => r.code), ["unfenced_pool"]);
  assert.equal(logged.referral.flag, true);
});

test("underwrite function declines a station over 8 mi as PC 10", async () => {
  const { logged } = await call({ quoteRef: "HQ-1", input: INPUT, facts: { ...FACTS, stationMiles: 9 } });
  assert.equal(logged.decision, "decline");
  assert.equal(logged.inputs.protectionClass, 10);
});

test("underwrite function rejects missing facts", async () => {
  const { res } = await call({ input: INPUT });
  assert.equal(res.statusCode, 400);
});
