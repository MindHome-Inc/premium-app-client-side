/* ============================================================
     MindHome premium rating engine
     ------------------------------------------------------------
     Takes the property facts from the quote form and returns an
     annual premium plus the credit breakdown. Runs in the browser
     (loaded by index.html as window.MHRating) and in Node (the
     /api/rate Netlify function and the tests require it).

     ⚠ EVERY NUMBER IN RATING_CONFIG IS ILLUSTRATIVE.
     Nothing here is a filed factor. Each table carries
     `illustrative: true` and a `swap` note saying what replaces it.
     To swap in filed factors, replace the table values (and flip
     `illustrative` to false) — the engine code does not change.

     The illustrative tables were calibrated so the plan's sample
     Boulder home (2,150 sq ft, 1998 frame, 2014 asphalt roof, PC 3)
     rates to Cov A $613k at $3,193/yr, and $1,611/yr with the
     Complete Bundle + pro install. See rating/engine.test.js.

     Items marked `pendingDecision` are Daniel's calls (filed
     factors, the 50% cap, credit / CLUE vendors, AIF name + fee).
     They are placeholders, not guesses.
     ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MHRating = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ENGINE_VERSION = "0.1.0-illustrative";

  const RATING_CONFIG = {
    state: "CO",

    /* Base rate per $1,000 of Coverage A (from the plan). */
    baseRatePer1kCovA: {
      illustrative: true,
      swap: "Filed base rate for the CO HO-3 program",
      value: 4.2,
    },

    /* Replacement cost per sq ft, used to estimate Coverage A when the
       quote doesn't supply one. Rounded to the nearest $1,000. */
    replacementCostPerSqft: {
      illustrative: true,
      swap: "Replacement-cost vendor estimate (e.g. HeyCapto per-address RC, or a 360Value-type tool)",
      roundTo: 1000,
      byConstruction: {
        frame: 285,
        masonry_veneer: 295,
        masonry: 305,
        fire_resistive: 325,
      },
    },

    /* Multiplicative factor tables. Bands are inclusive [min, max]. */
    factors: {
      construction: {
        illustrative: true,
        swap: "Filed construction-type relativities",
        table: { frame: 1.0, masonry_veneer: 0.96, masonry: 0.92, fire_resistive: 0.85 },
      },
      protectionClass: {
        illustrative: true,
        swap: "Filed ISO protection-class relativities",
        table: { 1: 0.92, 2: 0.96, 3: 1.0, 4: 1.02, 5: 1.05, 6: 1.1, 7: 1.18, 8: 1.3, 9: 1.6, 10: 1.85 },
      },
      homeAge: {
        illustrative: true,
        swap: "Filed age-of-home relativities",
        bands: [
          { min: 0, max: 5, factor: 0.9 },
          { min: 6, max: 10, factor: 0.95 },
          { min: 11, max: 20, factor: 1.0 },
          { min: 21, max: 30, factor: 1.05 },
          { min: 31, max: 40, factor: 1.1 },
          { min: 41, max: 60, factor: 1.15 },
          { min: 61, max: Infinity, factor: 1.25 },
        ],
      },
      roof: {
        illustrative: true,
        swap: "Filed roof age x material relativities (CO hail exposure)",
        byMaterial: {
          asphalt: [
            { min: 0, max: 5, factor: 0.95 },
            { min: 6, max: 10, factor: 1.05 },
            { min: 11, max: 15, factor: 1.17 },
            { min: 16, max: 20, factor: 1.3 },
            { min: 21, max: Infinity, factor: 1.5 },
          ],
          impact_resistant: [
            { min: 0, max: 10, factor: 0.85 },
            { min: 11, max: 20, factor: 0.95 },
            { min: 21, max: Infinity, factor: 1.1 },
          ],
          metal: [
            { min: 0, max: 20, factor: 0.85 },
            { min: 21, max: Infinity, factor: 0.95 },
          ],
          tile: [
            { min: 0, max: 20, factor: 0.9 },
            { min: 21, max: Infinity, factor: 1.0 },
          ],
          wood_shake: [
            { min: 0, max: 10, factor: 1.25 },
            { min: 11, max: Infinity, factor: 1.45 },
          ],
        },
      },
      /* Credit-based insurance score. Neutral (1.00) until a vendor is
         chosen and tiers are filed. */
      insuranceScore: {
        illustrative: true,
        pendingDecision: "Credit-based insurance score vendor (Daniel)",
        swap: "Filed insurance-score tiers from the chosen vendor's model",
        notPulledFactor: 1.0,
        bands: [
          { min: 0, max: 549, factor: 1.0 },
          { min: 550, max: 649, factor: 1.0 },
          { min: 650, max: 749, factor: 1.0 },
          { min: 750, max: 999, factor: 1.0 },
        ],
      },
      /* CLUE loss history: count of property claims in the last 5 years.
         Neutral (1.00) until a vendor is chosen and surcharges are filed. */
      lossHistory: {
        illustrative: true,
        pendingDecision: "CLUE vendor (Daniel)",
        swap: "Filed prior-loss surcharge schedule",
        notPulledFactor: 1.0,
        byClaimCount: { 0: 1.0, 1: 1.0, 2: 1.0, "3+": 1.0 },
      },
    },

    /* Coverage selections from the Coverage stage. Defaults rate at 1.00 /
       $0, so a quote with no selections matches the plan's sample home.
       Factor items multiply the property premium (before MH-100 credits);
       flat charges are added after credits, before the policy fee. */
    coverage: {
      /* Coverages B/C/D as a share of Coverage A (HO-3 defaults). */
      limitsPctOfA: { B: 10, C: 50, D: 20 },
      medPay: 5000,
      liability: {
        illustrative: true,
        swap: "Filed Coverage E liability charges",
        default: 300000,
        flat: { 100000: -15, 300000: 0, 500000: 25 },
      },
      aopDeductible: {
        illustrative: true,
        swap: "Filed all-other-perils deductible relativities",
        default: 1000,
        table: { 500: 1.08, 1000: 1.0, 2500: 0.9, 5000: 0.82 },
      },
      windHailDeductiblePct: {
        illustrative: true,
        swap: "Filed wind/hail percentage deductible relativities (CO)",
        default: 1,
        table: { 1: 1.0, 2: 0.94, 5: 0.85 },
      },
      endorsements: {
        illustrative: true,
        swap: "Filed endorsement charges",
        table: {
          "HO 04 20": { name: "Specified additional amount of insurance for Cov A", factor: 1.04 },
          "HO 04 95": { name: "Water back-up and sump discharge or overflow", flat: 75 },
          "HO 04 77": { name: "Ordinance or law, increased amount", factor: 1.02 },
          "HO 04 93": { name: "Actual cash value for windstorm or hail losses to roof surfacing", factor: 0.88 },
        },
      },
    },

    /* Mitigation credits — provisional at bind as endorsement MH-100,
       verified within 60 days. */
    credits: {
      endorsement: "MH-100",
      verifyWithinDays: 60,
      fire: {
        illustrative: true,
        swap: "Filed MH-100 fire credit (needs loss-cost support)",
        pct: 20,
        requires: "≥1 auto fire extinguisher + Ting arc fault monitor",
      },
      water: {
        illustrative: true,
        swap: "Filed MH-100 water credit (needs loss-cost support)",
        pct: 30,
        requires: "water shutoff valve + ≥3 leak sensors + professional install of the valve",
      },
      combinedCapPct: {
        illustrative: true,
        pendingDecision: "Is a 50% combined credit cap supportable in a CO filing? (Daniel)",
        value: 50,
      },
    },

    /* Flat policy fee, added after credits. */
    policyFee: {
      illustrative: true,
      swap: "Filed policy fee",
      value: 30,
    },

    /* Attorney-in-fact allocation. Informational: carved out of the
       premium, it does not change what the customer pays. */
    aif: {
      illustrative: true,
      pendingDecision: "AIF entity name and AIF fee % (Daniel)",
      entityName: "[AIF ENTITY TBD]",
      feePct: 20,
    },

    /* HeyCapto hazard grades are recorded with the quote but NOT rated:
       there is no real-time API, and grades need actuarial support
       before they can move price. */
    hazardGrades: {
      illustrative: true,
      pendingDecision: "HeyCapto data licensing + actuarial review of grade sources",
      rated: false,
      perils: ["wildfire", "flood", "crime", "earthquake", "environmental", "wind", "hail"],
    },
  };

  /* ---------- helpers ---------- */
  function band(bands, value, label) {
    const b = bands.find((x) => value >= x.min && value <= x.max);
    if (!b) throw new Error(`No ${label} band for ${value}`);
    return b;
  }
  function bandLabel(b) {
    return b.max === Infinity ? `${b.min}+` : `${b.min}–${b.max}`;
  }
  function round2(n) {
    return Math.round(n * 100) / 100;
  }
  function addDays(iso, days) {
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /* Which credits does a device cart unlock? Cart keys match the app's
     CATALOG: ext, ting, shutoff, sensor. */
  function creditEligibility(devices, proInstall) {
    const d = devices || {};
    const fire = (d.ext || 0) >= 1 && (d.ting || 0) >= 1;
    const waterDevices = (d.shutoff || 0) >= 1 && (d.sensor || 0) >= 3;
    return {
      fire,
      water: waterDevices && !!proInstall,
      waterDevicesOnly: waterDevices && !proInstall,
    };
  }

  function estimateCoverageA(sqft, construction, cfg) {
    const rc = cfg.replacementCostPerSqft;
    const perSqft = rc.byConstruction[construction];
    if (perSqft == null) throw new Error(`Unknown construction type: ${construction}`);
    return Math.round((sqft * perSqft) / rc.roundTo) * rc.roundTo;
  }

  /* ---------- the engine ---------- */
  /**
   * @param {object} input
   *   sqft, yearBuilt, construction, roofYear, roofMaterial,
   *   protectionClass, coverageA (optional; estimated from sqft if absent),
   *   insuranceScore  { score, vendor, pulledAt } | null
   *   lossHistory     { claimCount, vendor, pulledAt } | null
   *   hazardGrades    { wildfire: "B", ... , source } | null
   *   devices         { ext, ting, shutoff, sensor, ... }
   *   proInstall      boolean — valve professionally installed
   *   coverage        { liability, aopDeductible, windHailDeductiblePct,
   *                     endorsements: ["HO 04 93", ...] } (optional; defaults)
   *   asOf            ISO date of the quote (defaults to now)
   */
  function rate(input, cfg) {
    cfg = cfg || RATING_CONFIG;
    const asOf = input.asOf || new Date().toISOString();
    const year = new Date(asOf).getUTCFullYear();
    const f = cfg.factors;

    const sqft = Number(input.sqft);
    const yearBuilt = Number(input.yearBuilt);
    const roofYear = Number(input.roofYear);
    const pc = Number(input.protectionClass);
    const construction = input.construction;
    const roofMaterial = input.roofMaterial;
    if (!(sqft > 0)) throw new Error("sqft is required");
    if (!(yearBuilt > 1700)) throw new Error("yearBuilt is required");
    if (!(roofYear > 1700)) throw new Error("roofYear is required");
    if (!f.protectionClass.table[pc]) throw new Error(`Unknown protection class: ${input.protectionClass}`);

    const coverageASource = input.coverageA ? "input" : "estimated";
    const coverageA = input.coverageA
      ? Math.round(Number(input.coverageA))
      : estimateCoverageA(sqft, construction, cfg);

    const basePremium = (coverageA / 1000) * cfg.baseRatePer1kCovA.value;

    const homeAge = Math.max(0, year - yearBuilt);
    const roofAge = Math.max(0, year - roofYear);
    const roofBands = f.roof.byMaterial[roofMaterial];
    if (!roofBands) throw new Error(`Unknown roof material: ${roofMaterial}`);
    if (f.construction.table[construction] == null)
      throw new Error(`Unknown construction type: ${construction}`);

    const ageBand = band(f.homeAge.bands, homeAge, "home age");
    const roofBand = band(roofBands, roofAge, "roof age");

    const score = input.insuranceScore && input.insuranceScore.score;
    const scoreFactor =
      score != null
        ? { factor: band(f.insuranceScore.bands, score, "insurance score").factor, basis: `score ${score}` }
        : { factor: f.insuranceScore.notPulledFactor, basis: "not pulled (vendor TBD)" };

    const claims = input.lossHistory && input.lossHistory.claimCount;
    const lossFactor =
      claims != null
        ? { factor: f.lossHistory.byClaimCount[claims >= 3 ? "3+" : claims], basis: `${claims} claim(s), 5 yr` }
        : { factor: f.lossHistory.notPulledFactor, basis: "not pulled (vendor TBD)" };

    const factors = [
      { name: "construction", basis: construction, factor: f.construction.table[construction], illustrative: f.construction.illustrative },
      { name: "protectionClass", basis: `PC ${pc}`, factor: f.protectionClass.table[pc], illustrative: f.protectionClass.illustrative },
      { name: "homeAge", basis: `${homeAge} yrs (band ${bandLabel(ageBand)})`, factor: ageBand.factor, illustrative: f.homeAge.illustrative },
      { name: "roof", basis: `${roofMaterial}, ${roofAge} yrs (band ${bandLabel(roofBand)})`, factor: roofBand.factor, illustrative: f.roof.illustrative },
      { name: "insuranceScore", basis: scoreFactor.basis, factor: scoreFactor.factor, illustrative: f.insuranceScore.illustrative },
      { name: "lossHistory", basis: lossFactor.basis, factor: lossFactor.factor, illustrative: f.lossHistory.illustrative },
    ];

    /* coverage selections */
    const cov = cfg.coverage;
    const sel = input.coverage || {};
    const liability = Number(sel.liability || cov.liability.default);
    const aopDed = Number(sel.aopDeductible || cov.aopDeductible.default);
    const whPct = Number(sel.windHailDeductiblePct || cov.windHailDeductiblePct.default);
    if (cov.liability.flat[liability] == null) throw new Error(`Unknown liability limit: ${liability}`);
    if (cov.aopDeductible.table[aopDed] == null) throw new Error(`Unknown AOP deductible: ${aopDed}`);
    if (cov.windHailDeductiblePct.table[whPct] == null) throw new Error(`Unknown wind/hail deductible: ${whPct}%`);
    const endorsementCodes = [...new Set(sel.endorsements || [])];
    for (const code of endorsementCodes)
      if (!cov.endorsements.table[code]) throw new Error(`Unknown endorsement: ${code}`);

    factors.push(
      { name: "aopDeductible", basis: `$${aopDed.toLocaleString("en-US")} AOP deductible`, factor: cov.aopDeductible.table[aopDed], illustrative: cov.aopDeductible.illustrative },
      { name: "windHailDeductible", basis: `${whPct}% wind/hail deductible`, factor: cov.windHailDeductiblePct.table[whPct], illustrative: cov.windHailDeductiblePct.illustrative },
    );
    const flatCharges = [];
    if (cov.liability.flat[liability])
      flatCharges.push({ name: "liability", basis: `$${liability / 1000}k liability`, amount: cov.liability.flat[liability], illustrative: cov.liability.illustrative });
    for (const code of endorsementCodes) {
      const e = cov.endorsements.table[code];
      if (e.factor != null)
        factors.push({ name: "endorsement", code, basis: `${code} ${e.name}`, factor: e.factor, illustrative: cov.endorsements.illustrative });
      if (e.flat != null)
        flatCharges.push({ name: "endorsement", code, basis: `${code} ${e.name}`, amount: e.flat, illustrative: cov.endorsements.illustrative });
    }
    const flatTotal = flatCharges.reduce((s, x) => s + x.amount, 0);

    const factorProduct = factors.reduce((p, x) => p * x.factor, 1);
    const premiumBeforeCredits = basePremium * factorProduct;

    /* credits */
    const c = cfg.credits;
    const elig = creditEligibility(input.devices, input.proInstall);
    const creditLines = [];
    if (elig.fire) creditLines.push({ name: "fire", pct: c.fire.pct, illustrative: c.fire.illustrative });
    if (elig.water) creditLines.push({ name: "water", pct: c.water.pct, illustrative: c.water.illustrative });
    const uncappedPct = creditLines.reduce((s, x) => s + x.pct, 0);
    const capPct = c.combinedCapPct.value;
    const creditPct = Math.min(uncappedPct, capPct);
    const creditAmount = premiumBeforeCredits * (creditPct / 100);
    const premiumAfterCredits = premiumBeforeCredits - creditAmount;

    const policyFee = cfg.policyFee.value;
    const annualPremium = Math.round(premiumAfterCredits + flatTotal + policyFee);
    const annualPremiumWithoutCredits = Math.round(premiumBeforeCredits + flatTotal + policyFee);

    const aifFee = round2(premiumAfterCredits * (cfg.aif.feePct / 100));

    const hints = [];
    if (!elig.fire) hints.push("Fire credit needs ≥1 auto fire extinguisher + Ting arc fault monitor.");
    if (elig.waterDevicesOnly) hints.push("Water credit needs the shutoff valve professionally installed.");
    else if (!elig.water) hints.push("Water credit needs the shutoff valve + ≥3 leak sensors, professionally installed.");

    return {
      engineVersion: ENGINE_VERSION,
      illustrative: true,
      asOf,
      coverageA,
      coverageASource,
      baseRatePer1kCovA: cfg.baseRatePer1kCovA.value,
      basePremium: round2(basePremium),
      factors,
      factorProduct: Math.round(factorProduct * 1e6) / 1e6,
      premiumBeforeCredits: round2(premiumBeforeCredits),
      credits: {
        status: creditLines.length ? "provisional" : "none",
        endorsement: c.endorsement,
        verifyBy: creditLines.length ? addDays(asOf, c.verifyWithinDays) : null,
        applied: creditLines,
        uncappedPct,
        capPct,
        capped: uncappedPct > capPct,
        pct: creditPct,
        amount: round2(creditAmount),
        hints,
      },
      premiumAfterCredits: round2(premiumAfterCredits),
      flatCharges,
      policyFee,
      limits: {
        A: coverageA,
        B: Math.round((coverageA * cov.limitsPctOfA.B) / 100),
        C: Math.round((coverageA * cov.limitsPctOfA.C) / 100),
        D: Math.round((coverageA * cov.limitsPctOfA.D) / 100),
        liability,
        medPay: cov.medPay,
        aopDeductible: aopDed,
        windHailDeductiblePct: whPct,
        windHailDeductible: Math.round((coverageA * whPct) / 100),
        endorsements: endorsementCodes,
      },
      annualPremium,
      annualPremiumWithoutCredits,
      annualSavings: annualPremiumWithoutCredits - annualPremium,
      aif: { entityName: cfg.aif.entityName, feePct: cfg.aif.feePct, fee: aifFee, placeholder: true },
      hazardGrades: input.hazardGrades || null,
      hazardGradesRated: cfg.hazardGrades.rated,
    };
  }

  /* The quote.rated event written to the integration log. */
  function buildQuoteRatedEvent(quoteRef, input, result) {
    return {
      type: "quote.rated",
      quoteRef: quoteRef || null,
      occurredAt: new Date().toISOString(),
      engineVersion: result.engineVersion,
      illustrative: result.illustrative,
      premium: {
        annual: result.annualPremium,
        annualWithoutCredits: result.annualPremiumWithoutCredits,
        annualSavings: result.annualSavings,
        coverageA: result.coverageA,
        basePremium: result.basePremium,
        factorProduct: result.factorProduct,
        premiumBeforeCredits: result.premiumBeforeCredits,
        premiumAfterCredits: result.premiumAfterCredits,
        flatCharges: result.flatCharges,
        policyFee: result.policyFee,
      },
      limits: result.limits,
      factors: result.factors,
      credits: result.credits,
      aif: result.aif,
      inputs: {
        sqft: input.sqft,
        yearBuilt: input.yearBuilt,
        construction: input.construction,
        roofYear: input.roofYear,
        roofMaterial: input.roofMaterial,
        protectionClass: input.protectionClass,
        coverageA: result.coverageA,
        coverageASource: result.coverageASource,
        insuranceScore: input.insuranceScore || { status: "not_pulled", reason: "vendor TBD" },
        lossHistory: input.lossHistory || { status: "not_pulled", reason: "vendor TBD" },
        hazardGrades: input.hazardGrades || { status: "not_available", reason: "HeyCapto has no real-time API" },
        devices: input.devices || {},
        proInstall: !!input.proInstall,
        coverage: input.coverage || {},
        property: input.property || {},
      },
      pendingDecisions: pendingDecisions(),
    };
  }

  /* Every open gating decision, collected from the config. */
  function pendingDecisions(cfg) {
    cfg = cfg || RATING_CONFIG;
    const out = [];
    (function walk(node, path) {
      if (!node || typeof node !== "object") return;
      if (node.pendingDecision) out.push({ path: path.join("."), decision: node.pendingDecision });
      for (const [k, v] of Object.entries(node)) if (v && typeof v === "object") walk(v, path.concat(k));
    })(cfg, []);
    return out;
  }

  /* Every table still marked illustrative, for audit. */
  function illustrativeFactors(cfg) {
    cfg = cfg || RATING_CONFIG;
    const out = [];
    (function walk(node, path) {
      if (!node || typeof node !== "object") return;
      if (node.illustrative === true) out.push(path.join("."));
      for (const [k, v] of Object.entries(node)) if (v && typeof v === "object") walk(v, path.concat(k));
    })(cfg, []);
    return out;
  }

  return {
    ENGINE_VERSION,
    RATING_CONFIG,
    rate,
    estimateCoverageA: (sqft, construction, cfg) => estimateCoverageA(sqft, construction, cfg || RATING_CONFIG),
    creditEligibility,
    buildQuoteRatedEvent,
    pendingDecisions,
    illustrativeFactors,
  };
});
