// Admin API credentials. Either:
//   SHOPIFY_ADMIN_TOKEN                        a permanent shpat_ token (legacy custom app), or
//   SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET  a Dev Dashboard app installed on the store.
// Dev Dashboard apps use the client credentials grant: we exchange the ID and
// secret for a token that lasts 24 hours, and cache it while the function is warm.
// SHOPIFY_STORE is the store's myshopify.com domain, e.g. smartinsure.myshopify.com.
let cachedToken = null; // { value, expiresAt }

function shopDomain() {
  const store = (process.env.SHOPIFY_STORE || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!store) throw new Error("SHOPIFY_STORE is not set");
  return store;
}

// Which credential the last Admin API call used, so errors can say so.
function authPath() {
  return process.env.SHOPIFY_ADMIN_TOKEN
    ? "SHOPIFY_ADMIN_TOKEN"
    : "token from SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET";
}

async function getAdminToken() {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "No Shopify Admin API credentials: set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (or SHOPIFY_ADMIN_TOKEN)",
    );
  }

  // Reuse the cached token until 5 minutes before it expires.
  if (cachedToken && Date.now() < cachedToken.expiresAt - 5 * 60 * 1000) {
    return cachedToken.value;
  }

  const response = await fetch(`https://${shopDomain()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const text = await response.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch (e) { }
  if (!response.ok || !json.access_token) {
    const detail = json.error_description || json.error || json.errors || text || "empty body";
    throw new Error(`Shopify token request HTTP ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }

  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 86399) * 1000,
  };
  return cachedToken.value;
}

exports.handler = async (event) => {
  try {
    // const scopeResponse = await fetch(
    //   `https://${process.env.SHOPIFY_STORE}/admin/oauth/access_scopes.json`,
    //   {
    //     headers: {
    //       "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN
    //     }
    //   }
    // );

    // console.log(
    //   "SCOPES:",
    //   await scopeResponse.json()
    // );

    const { quoteRef } = JSON.parse(event.body); // extracting the quote reference sent from the frontend for unique discount code

    const code =
      quoteRef +
      "-" +
      Math.random().toString(36).substring(2, 8).toUpperCase();

    // GraphQL mutation for creating a discount code
    const mutation = `
      mutation CreateDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                codes(first: 1) {
                  nodes {
                    code
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      basicCodeDiscount: {
        title: code,
        code,
        startsAt: new Date().toISOString(),

        customerGets: {
          value: {
            percentage: 1 // 100% off discount
          },
          items: {
            all: true
          }
        },

        customerSelection: {
          all: true
        },

        appliesOncePerCustomer: true,
        usageLimit: 1
      }
    };

    // send the mutation to GraphQL API
    const adminToken = await getAdminToken();

    const response = await fetch(
      `https://${shopDomain()}/admin/api/2026-07/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminToken
        },
        body: JSON.stringify({
          query: mutation,
          variables
        })
      }
    );

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `Shopify Admin API returned HTTP ${response.status} with ${text ? "a non-JSON" : "an empty"} body (check SHOPIFY_STORE and the Shopify credentials)`,
      );
    }

    if (!response.ok) {
      const detail = typeof json.errors === "string" ? json.errors : JSON.stringify(json.errors || json);
      if (response.status === 401) cachedToken = null; // fetch a fresh token next time
      throw new Error(
        `Shopify Admin API HTTP ${response.status}: ${detail} (store: ${shopDomain()}, auth: ${authPath()})`,
      );
    }

    if (json.errors?.length) {
        console.error("SHOPIFY ERRORS:", json.errors);

        return {
            statusCode: 500,
            body: JSON.stringify({
            error: json.errors[0].message,
            details: json.errors
            })
        };
    }

    const result = json.data.discountCodeBasicCreate;

    if (result.userErrors?.length) {
        console.error("USER ERRORS:", result.userErrors);

        return {
            statusCode: 500,
            body: JSON.stringify({
            error: result.userErrors[0].message,
            details: result.userErrors
            })
        };
    }

    // returned to the frontend so it can be appended to the checkout URL
    const discountCode =
    result.codeDiscountNode
        .codeDiscount
        .codes
        .nodes[0]
        .code;

    return {
        statusCode: 200,
        body: JSON.stringify({
            discountCode
        })
    };

    } catch (err) {
    console.error("CREATE DISCOUNT ERROR:", err);

    return {
        statusCode: 500,
        body: JSON.stringify({
        error: err.message
        })
    };
    }
};