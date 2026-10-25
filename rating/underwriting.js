/* ============================================================
     MindHome underwriting rules (Quote stage)
     ------------------------------------------------------------
     Turns the property facts and the rated Coverage A into an
     accept / refer / decline decision with the specific reasons.
     Runs in the browser (window.MHUnderwriting), in the
     /.netlify/functions/underwrite function and in the tests.

     Any decline rule → decline. Otherwise any refer rule → refer.
     Otherwise accept. Every rule that fires is listed as a reason,
     so a decline also shows the refer reasons it would have had.

     A refer carries a referral flag: Bind becomes "Submit to
     underwriter" and the Shopify order is held 7 days.

     Losses are self-reported until the CLUE vendor is chosen
     (Daniel's call); the decision lists that as a pending check.
     ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MHUnderwriting = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const UW_VERSION = "0.1.0";

  const SHINGLE = ["asphalt", "impact_resistant"];

  const UW_RULES = {
    /* Fire station distance past which the home is protection class 10. */
    pc10StationMiles: 8,
    referral: { holdDays: 7, bindAction: "Submit to underwriter" },
    decline: [
      { code: "occupancy_rental", test: (f) => f.occupancy === "rental", message: () => "Rental (tenant-occupied) home" },
      { code: "occupancy_vacant", test: (f) => f.occupancy === "vacant", message: () => "Vacant home" },
      { code: "roof_wood_shake", test: (f) => f.roofMaterial === "wood_shake", message: () => "Wood shake roof" },
      { code: "roof_shingle_over_25", test: (f) => isShingle(f) && f.roofAge > 25, message: (f) => `Shingle roof is ${f.roofAge} years old (over 25)` },
      { code: "losses_3_plus", test: (f) => f.losses >= 3, message: (f) => `${f.losses} losses in the last 5 years (3 or more)` },
      { code: "protection_class_10", test: (f) => f.protectionClass === 10, message: (f) => f.stationMiles > UW_RULES.pc10StationMiles ? `Protection class 10: fire station ${f.stationMiles} mi away (over ${UW_RULES.pc10StationMiles} mi)` : "Protection class 10" },
    ],
    refer: [
      { code: "occupancy_secondary", test: (f) => f.occupancy === "secondary", message: () => "Secondary home" },
      { code: "roof_shingle_21_25", test: (f) => isShingle(f) && f.roofAge >= 21 && f.roofAge <= 25, message: (f) => `Shingle roof is ${f.roofAge} years old (21–25)` },
      { code: "losses_2", test: (f) => f.losses === 2, message: () => "2 losses in the last 5 years" },
      { code: "wildfire_high", test: (f) => f.wildfire === "high", message: () => "High wildfire risk" },
      { code: "built_pre_1940", test: (f) => f.yearBuilt < 1940, message: (f) => `Built in ${f.yearBuilt} (before 1940)` },
      { code: "wood_stove", test: (f) => f.woodStove, message: () => "Wood stove in the home" },
      { code: "unfenced_pool", test: (f) => f.unfencedPool, message: () => "Unfenced pool" },
      { code: "cov_a_over_1_5m", test: (f) => f.coverageA > 1500000, message: (f) => `Coverage A ${money(f.coverageA)} is over $1.5M` },
      { code: "cov_a_under_150k", test: (f) => f.coverageA < 150000, message: (f) => `Coverage A ${money(f.coverageA)} is under $150k` },
    ],
  };

  function isShingle(f) {
    return SHINGLE.includes(f.roofMaterial);
  }
  function money(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function addDays(iso, days) {
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /* A fire station more than 8 miles away makes the home PC 10,
     whatever class was entered. */
  function effectiveProtectionClass(protectionClass, stationMiles) {
    return Number(stationMiles) > UW_RULES.pc10StationMiles ? 10 : Number(protectionClass);
  }

  /* Normalises the facts the rules read. */
  function normalise(facts, asOf) {
    const year = new Date(asOf).getUTCFullYear();
    return {
      occupancy: facts.occupancy || "primary",
      roofMaterial: facts.roofMaterial,
      roofYear: Number(facts.roofYear),
      roofAge: Math.max(0, year - Number(facts.roofYear)),
      yearBuilt: Number(facts.yearBuilt),
      losses: Number(facts.losses) || 0,
      stationMiles: Number(facts.stationMiles) || 0,
      protectionClass: effectiveProtectionClass(facts.protectionClass, facts.stationMiles),
      wildfire: facts.wildfire || "low",
      woodStove: !!facts.woodStove,
      unfencedPool: !!facts.unfencedPool,
      coverageA: Number(facts.coverageA),
    };
  }

  /**
   * @param {object} facts
   *   occupancy ("primary" | "secondary" | "rental" | "vacant"),
   *   roofMaterial, roofYear, yearBuilt, losses (5 yr, self-reported),
   *   protectionClass, stationMiles, wildfire ("low" | "moderate" | "high"),
   *   woodStove, unfencedPool, coverageA (the rated Cov A)
   * @param {string} asOf ISO date of the quote (defaults to now)
   */
  function decide(facts, asOf) {
    asOf = asOf || new Date().toISOString();
    const f = normalise(facts, asOf);
    if (!(f.coverageA > 0)) throw new Error("coverageA is required");
    if (!(f.yearBuilt > 1700)) throw new Error("yearBuilt is required");
    if (!(f.roofYear > 1700)) throw new Error("roofYear is required");

    const reasons = [];
    for (const outcome of ["decline", "refer"])
      for (const r of UW_RULES[outcome])
        if (r.test(f)) reasons.push({ code: r.code, outcome, message: r.message(f) });

    const decision = reasons.some((r) => r.outcome === "decline")
      ? "decline"
      : reasons.length
        ? "refer"
        : "accept";

    const ref = UW_RULES.referral;
    return {
      uwVersion: UW_VERSION,
      asOf,
      decision,
      reasons,
      referral:
        decision === "refer"
          ? { flag: true, bindAction: ref.bindAction, orderHoldDays: ref.holdDays, orderHoldUntil: addDays(asOf, ref.holdDays) }
          : null,
      pendingChecks: [
        { check: "clue", note: "Losses are self-reported; CLUE pull at quote waits on the vendor choice (Daniel)" },
        { check: "insuranceScore", note: "Credit-based insurance score pull at quote waits on the vendor choice (Daniel)" },
      ],
      facts: f,
    };
  }

  /* The uw.decision event written to the integration log. */
  function buildUwDecisionEvent(quoteRef, result) {
    return {
      type: "uw.decision",
      quoteRef: quoteRef || null,
      occurredAt: new Date().toISOString(),
      uwVersion: result.uwVersion,
      decision: result.decision,
      reasons: result.reasons,
      referral: result.referral,
      pendingChecks: result.pendingChecks,
      inputs: result.facts,
    };
  }

  return { UW_VERSION, UW_RULES, decide, effectiveProtectionClass, buildUwDecisionEvent };
});
