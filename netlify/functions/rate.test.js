const test = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("./rate");

test("rate function returns the premium and logs quote.rated", async () => {
  const logged = [];
  const orig = console.log;
  console.log = (line) => logged.push(line);
  try {
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        quoteRef: "HQ-100200",
        input: {
          sqft: 2150, yearBuilt: 1998, construction: "frame", roofYear: 2014,
          roofMaterial: "asphalt", protectionClass: 3, asOf: "2026-10-13T00:00:00Z",
          devices: { ext: 2, ting: 1, shutoff: 1, sensor: 5 }, proInstall: true,
        },
      }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.result.annualPremium, 1611);
    assert.equal(body.event.type, "quote.rated");
    const line = logged.find((l) => String(l).startsWith("INTEGRATION_LOG "));
    assert.ok(line, "quote.rated should be written to the integration log");
    const e = JSON.parse(line.slice("INTEGRATION_LOG ".length));
    assert.equal(e.quoteRef, "HQ-100200");
    assert.equal(e.premium.annual, 1611);
    assert.equal(e.credits.pct, 50);
  } finally {
    console.log = orig;
  }
});

test("rate function rejects bad input", async () => {
  const res = await handler({ httpMethod: "POST", body: JSON.stringify({ input: { sqft: 0 } }) });
  assert.equal(res.statusCode, 400);
});
