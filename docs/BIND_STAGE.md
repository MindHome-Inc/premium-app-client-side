# Bind stage

Bind turns an accepted quote into a bound HO-3 policy plus a separately
charged device/install order. It **consumes** the Quote's outputs (premium,
underwriting decision, MH-100 provisional credit, devices, install choice)
and never calls `rate()` or `decide()`. Fulfillment stays held until
`policy.bound`.

Code: `bind/bind.js` (shared by the page, the function and the tests),
`netlify/functions/bind.js`, stage 6 in `index.html`. Tests:
`test/bind.test.js`, `test/bind-function.test.js`.

## Page

1. **Named insured** as on the quote (read-only; edit on Property).
2. **Effective date**: today through +60 days (Mountain time).
3. **Mortgagee**: yes/no, then name + loan number.
4. **Premium plan**: pay in full, 2-pay, 10-pay ($6 fee once, with installment 1),
   mortgagee bill (only with a mortgagee).
5. **Payment**: card or ACH. ACH checks the routing checksum, a matching
   account number and a debit authorization. Hidden when the mortgagee pays
   the premium and there's nothing to charge for devices.
6. **Due today** as two separate charges, never totalled: premium to
   MindHome Homeowners Reciprocal Exchange (premium trust account) and
   devices/install from MindHome Inc.
7. **Acknowledgements** (all four required) and a **typed e-signature** that
   must match the named insured.

Every field is validated with field-level errors (shown once a field is
touched, or on a bind attempt). The Bind button stays disabled, with a count
of items left, until everything passes. The function re-validates and
returns `422 { errors: { field: message } }`, which the page shows by field.

Card and bank numbers never leave the page: `MHBind.sandboxTokenize()` stands
in for the processor's hosted fields and sends only a token + last 4. The
function refuses raw numbers.

## Quote reconcile

`reconcileQuote()` checks the snapshot adds up: annual premium = premium after
credits + flat charges + policy fee; credit % = applied credits under the cap;
credit amount = % × premium before credits; credits match the devices and
install. A mismatch is refused (409), never rounded. The Boulder sample binds
at $1,611/yr; Due today is $1,611 premium (pay in full) and $921 devices.

## Plans (Boulder sample, $1,611)

| Plan | Today | Later |
|---|---|---|
| Pay in full | $1,611.00 | — |
| 2-pay | $805.50 | $805.50 at effective + 6 months |
| 10-pay | $167.10 ($161.10 + $6 fee) | 9 × $161.10 monthly from the effective date |
| Mortgagee bill | $0 | billed to the mortgagee |

Uneven cents go on installment 1, so installments always add back to the
premium.

## Events, in order

Accept: `application.signed` → `payment.captured` (both charges, each with its
own processor ref) → `policy.bound` → `endorsement.attached` (MH-100, when a
credit applies) → `subscriber.enrolled` → `fulfillment.released` (devices) →
`install.booked` (pro-installed valve) → `evidence.sent` (mortgagee).

Refer ("Submit to underwriter"): `application.signed` → `application.referred`.
Nothing is captured: the premium and the devices are charged only if an
underwriter approves (`dueOnApproval` on the event). The device order and
install window are held 7 days from submission. No `policy.bound`, no
fulfillment release.

If the device charge fails after the premium was captured, the premium is
voided and the customer sees the error.

`policy.bound` carries `policyNumber: null`; Issue policy assigns it.

## MH-100 at bind

Provisional, never permanent. `verifyBy` = effective date + 60 days (install
visit or devices online); otherwise removed by endorsement with pro-rata
additional premium; continues while devices keep a heartbeat. Fire 20%, water
30%, cap 50%, applied before the $30 policy fee (all from the Quote).

## Sandbox

`PREMIUM_PROCESSOR` unset = sandbox: nothing is charged, every event has
`sandbox: true`. Any other value is refused until a real adapter exists. If
the function can't be reached, the page runs the same sandbox bind in the
browser and marks events `source: "client"`.

The old Shopify checkout hand-off (and its 100% off discount code) is no
longer called from Bind. The cart helpers stay in `index.html` for the port
into premium-app.netlify.app.

## Open calls (Daniel)

- Premium processor and the segregated fiduciary/trust account.
- AIF entity name and fee % (placeholder "MindHome Reciprocal Management,
  LLC", 20%) and any surplus contribution.
- Filed rating, insurance score and CLUE vendors (Bind uses whatever Quote
  produced).
- Install scheduling backend / dispatch (Cal.com Atoms); the hub isn't in the
  package or pricing.
