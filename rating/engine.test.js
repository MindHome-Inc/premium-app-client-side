const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./engine");

/* The plan's sample Boulder home. */
const BOULDER = {
  sqft: 2150,
  yearBuilt: 1998,
  construction: "frame",
  roofYear: 2014,
  roofMaterial: "asphalt",
  protectionClass: 3,
  asOf: "2026-10-13T00:00:00Z",
};
const COMPLETE_BUNDLE = { ext: 2, ting: 1, shutoff: 1, sensor: 5 };

test("Boulder sample: Cov A $613k at $3,193/yr with no devices", () => {
  const r = R.rate(BOULDER);
  assert.equal(r.coverageA, 613000);
  assert.equal(r.annualPremium, 3193);
  assert.equal(r.credits.pct, 0);
});

test("Boulder sample: $1,611/yr with Complete Bundle + pro install", () => {
  const r = R.rate({ ...BOULDER, devices: COMPLETE_BUNDLE, proInstall: true });
  assert.equal(r.annualPremium, 1611);
  assert.equal(r.credits.pct, 50);
  assert.deepEqual(r.credits.applied.map((c) => c.name), ["fire", "water"]);
  assert.equal(r.credits.status, "provisional");
  assert.equal(r.credits.endorsement, "MH-100");
  assert.equal(r.credits.verifyBy, "2026-12-12");
});

test("water credit requires pro install of the valve", () => {
  const r = R.rate({ ...BOULDER, devices: COMPLETE_BUNDLE, proInstall: false });
  assert.equal(r.credits.pct, 20);
  assert.ok(r.credits.hints.some((h) => /professionally installed/.test(h)));
});

test("water credit requires ≥3 sensors; fire requires extinguisher + Ting", () => {
  assert.equal(R.rate({ ...BOULDER, devices: { shutoff: 1, sensor: 2 }, proInstall: true }).credits.pct, 0);
  assert.equal(R.rate({ ...BOULDER, devices: { shutoff: 1, sensor: 3 }, proInstall: true }).credits.pct, 30);
  assert.equal(R.rate({ ...BOULDER, devices: { ext: 1 } }).credits.pct, 0);
  assert.equal(R.rate({ ...BOULDER, devices: { ext: 1, ting: 1 } }).credits.pct, 20);
});

test("credits are capped and applied before the policy fee", () => {
  const cfg = structuredClone(R.RATING_CONFIG);
  cfg.credits.combinedCapPct.value = 40;
  const r = R.rate({ ...BOULDER, devices: COMPLETE_BUNDLE, proInstall: true }, cfg);
  assert.equal(r.credits.uncappedPct, 50);
  assert.equal(r.credits.pct, 40);
  assert.equal(r.credits.capped, true);
  assert.equal(r.annualPremium, Math.round(r.premiumBeforeCredits * 0.6 + 30));
});

test("Coverage A override is used instead of the estimate", () => {
  const r = R.rate({ ...BOULDER, coverageA: 500000 });
  assert.equal(r.coverageA, 500000);
  assert.equal(r.coverageASource, "input");
});

test("every rating table is flagged illustrative", () => {
  const flagged = R.illustrativeFactors();
  for (const p of [
    "baseRatePer1kCovA",
    "replacementCostPerSqft",
    "factors.construction",
    "factors.protectionClass",
    "factors.homeAge",
    "factors.roof",
    "factors.insuranceScore",
    "factors.lossHistory",
    "credits.fire",
    "credits.water",
    "credits.combinedCapPct",
    "policyFee",
    "aif",
    "hazardGrades",
  ])
    assert.ok(flagged.includes(p), `${p} should be illustrative`);
});

test("Daniel's gating decisions are listed as pending", () => {
  const paths = R.pendingDecisions().map((d) => d.path);
  for (const p of ["factors.insuranceScore", "factors.lossHistory", "credits.combinedCapPct", "aif"])
    assert.ok(paths.includes(p), `${p} should be pending`);
});

test("quote.rated event carries premium, credits and inputs", () => {
  const input = { ...BOULDER, devices: COMPLETE_BUNDLE, proInstall: true };
  const e = R.buildQuoteRatedEvent("HQ-123456", input, R.rate(input));
  assert.equal(e.type, "quote.rated");
  assert.equal(e.quoteRef, "HQ-123456");
  assert.equal(e.premium.annual, 1611);
  assert.equal(e.premium.annualWithoutCredits, 3193);
  assert.equal(e.credits.pct, 50);
  assert.equal(e.inputs.sqft, 2150);
  assert.equal(e.inputs.protectionClass, 3);
  assert.equal(e.inputs.insuranceScore.status, "not_pulled");
  assert.equal(e.inputs.lossHistory.status, "not_pulled");
  // 6 property factors + the AOP and wind/hail deductible factors
  assert.equal(e.factors.length, 8);
  assert.equal(e.limits.A, 613000);
  assert.ok(e.pendingDecisions.length >= 4);
});

test("default coverage selections leave the Boulder sample unchanged", () => {
  const r = R.rate({
    ...BOULDER,
    coverage: { liability: 300000, aopDeductible: 1000, windHailDeductiblePct: 1, endorsements: [] },
  });
  assert.equal(r.annualPremium, 3193);
  assert.deepEqual(
    { B: r.limits.B, C: r.limits.C, D: r.limits.D, medPay: r.limits.medPay },
    { B: 61300, C: 306500, D: 122600, medPay: 5000 },
  );
});

test("HO 04 93 (roof ACV) lowers the premium; HO 04 20 and HO 04 77 raise it", () => {
  const base = R.rate(BOULDER).annualPremium;
  assert.ok(R.rate({ ...BOULDER, coverage: { endorsements: ["HO 04 93"] } }).annualPremium < base);
  assert.ok(R.rate({ ...BOULDER, coverage: { endorsements: ["HO 04 20"] } }).annualPremium > base);
  assert.ok(R.rate({ ...BOULDER, coverage: { endorsements: ["HO 04 77"] } }).annualPremium > base);
});

test("flat charges (liability, HO 04 95) are added after MH-100 credits", () => {
  const input = { ...BOULDER, devices: COMPLETE_BUNDLE, proInstall: true };
  const plain = R.rate(input);
  const r = R.rate({ ...input, coverage: { liability: 500000, endorsements: ["HO 04 95"] } });
  assert.equal(r.credits.amount, plain.credits.amount);
  assert.equal(r.annualPremium, plain.annualPremium + 25 + 75);
});

test("unknown coverage options are rejected", () => {
  assert.throws(() => R.rate({ ...BOULDER, coverage: { liability: 250000 } }), /liability/);
  assert.throws(() => R.rate({ ...BOULDER, coverage: { endorsements: ["HO 99 99"] } }), /endorsement/);
});
