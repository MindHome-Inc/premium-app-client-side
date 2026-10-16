// Rates a quote server-side and writes a `quote.rated` event to the
// integration log (Netlify function logs, one JSON line per event,
// prefixed "INTEGRATION_LOG"). The browser rates locally for instant
// display; this endpoint is the record of what was quoted.
const { rate, buildQuoteRatedEvent } = require("../../rating/engine");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POST only" }) };
  }
  try {
    const { quoteRef, input } = JSON.parse(event.body || "{}");
    if (!input) throw new Error("input is required");

    const result = rate(input);
    const quoteRated = buildQuoteRatedEvent(quoteRef, input, result);

    console.log("INTEGRATION_LOG " + JSON.stringify(quoteRated));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result, event: quoteRated }),
    };
  } catch (e) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
