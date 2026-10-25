const test = require("node:test");
const assert = require("node:assert/strict");
const UW = require("./underwriting");

const AS_OF = "2026-10-13T00:00:00Z";
/* The plan's sample Boulder home, owner-occupied, no losses. */
const BOULDER = {
  occupancy: "primary",
  yearBuilt: 1998,
  roofMaterial: "asphalt",
  roofYear: 2014,
  protectionClass: 3,
  stationMiles: 1.4,
  losses: 0,
  wildfire: "moderate",
  woodStove: false,
  unfencedPool: false,
  coverageA: 613000,
};
const decide = (over) => UW.decide({ ...BOULDER, ...over }, AS_OF);
const codes = (r) => r.reasons.map((x) => x.code);

test("Boulder sample is accepted with no reasons", () => {
  const r = decide({});
  assert.equal(r.decision, "accept");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.referral, null);
});

for (const [name, over, code] of [
  ["rental", { occupancy: "rental" }, "occupancy_rental"],
  ["vacant", { occupancy: "vacant" }, "occupancy_vacant"],
  ["wood shake roof", { roofMaterial: "wood_shake" }, "roof_wood_shake"],
  ["shingle roof 26 yrs", { roofYear: 2000 }, "roof_shingle_over_25"],
  ["3 losses", { losses: 3 }, "losses_3_plus"],
  ["5 losses", { losses: 5 }, "losses_3_plus"],
  ["PC 10", { protectionClass: 10 }, "protection_class_10"],
  ["station over 8 mi", { stationMiles: 8.5 }, "protection_class_10"],
]) {
  test(`decline: ${name}`, () => {
    const r = decide(over);
    assert.equal(r.decision, "decline");
    assert.ok(codes(r).includes(code), codes(r).join());
    assert.equal(r.referral, null);
  });
}

for (const [name, over, code] of [
  ["secondary home", { occupancy: "secondary" }, "occupancy_secondary"],
  ["shingle roof 21 yrs", { roofYear: 2005 }, "roof_shingle_21_25"],
  ["shingle roof 25 yrs", { roofYear: 2001 }, "roof_shingle_21_25"],
  ["impact-resistant shingle 23 yrs", { roofMaterial: "impact_resistant", roofYear: 2003 }, "roof_shingle_21_25"],
  ["2 losses", { losses: 2 }, "losses_2"],
  ["high wildfire", { wildfire: "high" }, "wildfire_high"],
  ["built 1939", { yearBuilt: 1939 }, "built_pre_1940"],
  ["wood stove", { woodStove: true }, "wood_stove"],
  ["unfenced pool", { unfencedPool: true }, "unfenced_pool"],
  ["Cov A over $1.5M", { coverageA: 1500001 }, "cov_a_over_1_5m"],
  ["Cov A under $150k", { coverageA: 149999 }, "cov_a_under_150k"],
]) {
  test(`refer: ${name}`, () => {
    const r = decide(over);
    assert.equal(r.decision, "refer");
    assert.deepEqual(codes(r), [code]);
  });
}

test("boundaries that stay accepted", () => {
  for (const over of [
    { roofYear: 2006 }, // 20 yrs
    { yearBuilt: 1940 },
    { coverageA: 1500000 },
    { coverageA: 150000 },
    { losses: 1 },
    { stationMiles: 8 },
    { roofMaterial: "metal", roofYear: 1990 }, // the age rules are for shingle roofs
  ])
    assert.equal(decide(over).decision, "accept", JSON.stringify(over));
});

test("refer carries the referral flag, the Submit to underwriter action and a 7-day hold", () => {
  const r = decide({ woodStove: true });
  assert.deepEqual(r.referral, {
    flag: true,
    bindAction: "Submit to underwriter",
    orderHoldDays: 7,
    orderHoldUntil: "2026-10-20",
  });
});

test("decline wins over refer, and lists every reason", () => {
  const r = decide({ occupancy: "rental", woodStove: true });
  assert.equal(r.decision, "decline");
  assert.deepEqual(codes(r), ["occupancy_rental", "wood_stove"]);
});

test("uw.decision event carries the decision, reasons and inputs", () => {
  const e = UW.buildUwDecisionEvent("HQ-123456", decide({ losses: 2 }));
  assert.equal(e.type, "uw.decision");
  assert.equal(e.quoteRef, "HQ-123456");
  assert.equal(e.decision, "refer");
  assert.equal(e.reasons[0].message, "2 losses in the last 5 years");
  assert.equal(e.referral.flag, true);
  assert.equal(e.inputs.losses, 2);
  assert.ok(e.pendingChecks.some((c) => c.check === "clue"));
});
