const test = require("node:test");
const assert = require("node:assert/strict");

/* Loads a fresh copy of the function (clears its token cache) with a fake fetch. */
function load(env, responder) {
  for (const k of ["SHOPIFY_STORE", "SHOPIFY_ADMIN_TOKEN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"]) delete process.env[k];
  Object.assign(process.env, env);
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const [status, body] = responder(url, opts);
    return { ok: status < 400, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  };
  const path = require.resolve("../netlify/functions/createDiscount");
  delete require.cache[path];
  return { handler: require(path).handler, calls };
}

const discountOk = {
  data: { discountCodeBasicCreate: { codeDiscountNode: { codeDiscount: { codes: { nodes: [{ code: "HQ-1-ABC" }] } } }, userErrors: [] } },
};
const event = { body: JSON.stringify({ quoteRef: "HQ-1" }) };

test("client credentials: exchanges ID + secret for a token and uses it", async () => {
  const { handler, calls } = load(
    { SHOPIFY_STORE: "https://smartinsure.myshopify.com/", SHOPIFY_CLIENT_ID: "cid", SHOPIFY_CLIENT_SECRET: "sec" },
    (url) => (url.endsWith("/admin/oauth/access_token") ? [200, { access_token: "tok123", scope: "write_discounts", expires_in: 86399 }] : [200, discountOk]),
  );
  const res = await handler(event);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).discountCode, "HQ-1-ABC");
  assert.equal(calls[0].url, "https://smartinsure.myshopify.com/admin/oauth/access_token");
  const form = new URLSearchParams(calls[0].opts.body.toString());
  assert.equal(form.get("grant_type"), "client_credentials");
  assert.equal(form.get("client_id"), "cid");
  assert.equal(calls[1].url, "https://smartinsure.myshopify.com/admin/api/2026-07/graphql.json");
  assert.equal(calls[1].opts.headers["X-Shopify-Access-Token"], "tok123");

  // second order reuses the cached token
  await handler(event);
  assert.equal(calls.filter((c) => c.url.endsWith("/access_token")).length, 1);
});

test("a permanent admin token is used as-is", async () => {
  const { handler, calls } = load({ SHOPIFY_STORE: "smartinsure.myshopify.com", SHOPIFY_ADMIN_TOKEN: "shpat_x" }, () => [200, discountOk]);
  const res = await handler(event);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.headers["X-Shopify-Access-Token"], "shpat_x");
});

test("missing credentials give a clear error", async () => {
  const { handler } = load({ SHOPIFY_STORE: "smartinsure.myshopify.com" }, () => [200, discountOk]);
  const res = await handler(event);
  assert.equal(res.statusCode, 500);
  assert.match(JSON.parse(res.body).error, /SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET/);
});

test("a rejected token request reports Shopify's reason", async () => {
  const { handler } = load(
    { SHOPIFY_STORE: "smartinsure.myshopify.com", SHOPIFY_CLIENT_ID: "cid", SHOPIFY_CLIENT_SECRET: "bad" },
    () => [400, { error: "shop_not_permitted", error_description: "Client credentials cannot be performed on this shop." }],
  );
  const res = await handler(event);
  assert.equal(res.statusCode, 500);
  assert.match(JSON.parse(res.body).error, /HTTP 400: Client credentials cannot be performed/);
});

test("an Admin API 401 names the store and which credential was used", async () => {
  const { handler } = load(
    { SHOPIFY_STORE: "test-store-11233.myshopify.com", SHOPIFY_ADMIN_TOKEN: "shpat_old" },
    () => [401, { errors: "[API] Invalid API key or access token (unrecognized login or wrong password)" }],
  );
  const res = await handler(event);
  assert.match(JSON.parse(res.body).error, /store: test-store-11233\.myshopify\.com, auth: SHOPIFY_ADMIN_TOKEN/);
});
