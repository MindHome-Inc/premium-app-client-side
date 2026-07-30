exports.handler = async (event) => {
  try {
    const scopeResponse = await fetch(
      `https://${process.env.SHOPIFY_STORE}/admin/oauth/access_scopes.json`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN
        }
      }
    );

    console.log(
      "SCOPES:",
      await scopeResponse.json()
    );

    const { quoteRef } = JSON.parse(event.body);

    const code =
      quoteRef +
      "-" +
      Math.random().toString(36).substring(2, 8).toUpperCase();

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
            percentage: 1
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

    const response = await fetch(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2026-07/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN
        },
        body: JSON.stringify({
          query: mutation,
          variables
        })
      }
    );

    const json = await response.json();

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