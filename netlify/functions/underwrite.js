// Decides accept / refer / decline for a quote and writes a `uw.decision`
// event to the integration log (Netlify function logs, one JSON line per
// event, prefixed "INTEGRATION_LOG"). Coverage A comes from re-rating the
// quote, so the decision uses the same figure the customer was shown.
const { rate } = require("../../rating/engine");
const { decide, effectiveProtectionClass, buildUwDecisionEvent } = require("../../rating/underwriting");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POST only" }) };
  }
  try {
    const { quoteRef, input, facts } = JSON.parse(event.body || "{}");
    if (!input) throw new Error("input is required");
    if (!facts) throw new Error("facts are required");

    const pc = effectiveProtectionClass(input.protectionClass, facts.stationMiles);
    const rated = rate({ ...input, protectionClass: pc });
    const result = decide(
      {
        ...facts,
        yearBuilt: input.yearBuilt,
        roofYear: input.roofYear,
        roofMaterial: input.roofMaterial,
        protectionClass: pc,
        coverageA: rated.coverageA,
      },
      input.asOf,
    );
    const uwDecision = buildUwDecisionEvent(quoteRef, result);

    console.log("INTEGRATION_LOG " + JSON.stringify(uwDecision));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result, event: uwDecision }),
    };
  } catch (e) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
