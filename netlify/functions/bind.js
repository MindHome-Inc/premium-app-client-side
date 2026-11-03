// Binds a quote (accept) or submits it to an underwriter (refer), and
// writes each bind event to the integration log in order (Netlify
// function logs, one JSON line per event, prefixed "INTEGRATION_LOG").
// Bind consumes the Quote snapshot the page sends; it does not re-rate
// or re-underwrite. Payment arrives tokenized, never as raw numbers.
//
// PREMIUM_PROCESSOR selects the premium processor. Only "sandbox" (the
// default) exists until the processor and trust account are chosen
// (Daniel's call); anything else is refused rather than faked.
const { runBind, SANDBOX_PROCESSORS } = require("../../bind/bind");

function processors() {
  const name = (process.env.PREMIUM_PROCESSOR || "sandbox").trim();
  if (name !== "sandbox") throw new Error(`Premium processor "${name}" is not set up yet`);
  return SANDBOX_PROCESSORS;
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "Body must be JSON" });
  }
  try {
    const headers = event.headers || {};
    const result = await runBind(
      {
        snapshot: body.snapshot,
        application: body.application,
        meta: {
          ip: headers["x-nf-client-connection-ip"] || headers["x-forwarded-for"] || null,
          userAgent: headers["user-agent"] || null,
        },
      },
      { processors: processors() },
    );
    // Field errors → 422 so the page can show them next to each field.
    if (!result.ok && result.errors) return json(422, { error: "Some fields need attention", errors: result.errors });
    if (!result.ok) return json(409, { error: "The quote doesn't reconcile: " + result.problems.join("; "), problems: result.problems });

    for (const ev of result.events) console.log("INTEGRATION_LOG " + JSON.stringify(ev));
    return json(200, result);
  } catch (e) {
    return json(500, { error: e.message });
  }
};
