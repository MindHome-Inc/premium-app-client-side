# Quote stage

The page now runs the 7-stage flow: Property → Coverage → Quote → Protect →
Install → Bind → Issued. Quote is stage 3. It shows the rated premium from
`rating/engine.js` with the full worksheet, the underwriting decision from
`rating/underwriting.js`, and the MH-100 offer card where the old "save 50%"
teaser was. The savings ledger (a sticky bar on mobile) starts at Quote and
runs through Bind.

## Inputs

- **Property (stage 1):** address, year built, sq ft, stories, baths, walls,
  finish quality, roof material + year, hydrant feet, fire station miles,
  protection class, wildfire, occupancy, losses in 5 years, wood stove,
  unfenced pool. Stories, baths, finish quality and hydrant distance are
  recorded on `quote.rated` (`inputs.property`) for the replacement-cost
  vendor; they don't move the price yet.
- **Coverage (stage 2):** Coverage A from the rebuild estimate (editable);
  B/C/D at 10/50/20% of A; liability $100k/$300k/$500k; Med Pay $5k; AOP
  deductible; wind/hail % deductible; endorsements HO 04 20, HO 04 95,
  HO 04 77 and HO 04 93 (roof ACV, lowers the premium). Prices for these are
  in `RATING_CONFIG.coverage`, illustrative, and neutral at the defaults, so
  the sample home still rates to $3,193.

## Worksheet

Coverage A → base premium ($4.20 per $1,000) → each factor with its basis and
running total → premium before credits → MH-100 credits (capped at 50%) →
flat charges (liability, HO 04 95) → $30 policy fee → annual premium. A note
under it says the insurance score and CLUE are not pulled yet and the AIF
name and % are placeholders.

## Underwriting rules

Any decline rule → **decline**; otherwise any refer rule → **refer**;
otherwise **accept**. Every rule that fires is listed as a reason.

| Decline | Refer |
|---|---|
| Rental | Secondary home |
| Vacant | Shingle roof 21–25 yrs |
| Wood shake roof | 2 losses in 5 yrs |
| Shingle roof over 25 yrs | High wildfire |
| 3+ losses in 5 yrs | Built before 1940 |
| Protection class 10 (station over 8 mi forces PC 10) | Wood stove |
| | Unfenced pool |
| | Coverage A over $1.5M or under $150k |

"Shingle" means asphalt or impact-resistant shingle. Losses are self-reported
until the CLUE vendor is chosen.

A declined quote shows the worksheet and banner but can't continue to Protect.
A refer sets `state.uw.referral.flag`. Bind then reads "Submit to
underwriter", and the Shopify cart carries `uw_decision`, `uw_referral`,
`order_hold_until` (7 days out) and `uw_reasons`. The Storefront API can't
hold an order itself, so a Shopify Flow or the fulfillment team has to act on
those attributes.

## `uw.decision` event

The page posts the rating input and the facts to
`/.netlify/functions/underwrite`, which re-rates, decides and writes:

```
INTEGRATION_LOG {"type":"uw.decision","quoteRef":"HQ-…","decision":"refer","reasons":[{"code":"wood_stove","outcome":"refer","message":"Wood stove in the home"}],"referral":{"flag":true,"bindAction":"Submit to underwriter","orderHoldDays":7,"orderHoldUntil":"…"},"pendingChecks":[…],"inputs":{…}}
```

It fires when the customer first reaches Quote, again (debounced) when a fact
changes after that, and is forced on bind or "just submit my quote". If the
function can't be reached it is built in the browser with `source: "client"`.
Events also land in `window.MH_INTEGRATION_LOG` and as a `uw.decision` DOM
event.

## Sanity check

The sample Boulder home (2,150 sq ft, 1998 frame, 2014 asphalt roof, PC 3)
shows Coverage A $613,000 at $3,193/yr with an accept banner. The MH-100 card
shows $1,611/yr with the Complete Bundle and pro install, a $1,582/yr saving.
On the test store the bundle checks out as its items ($921), which pays back
in about 7 months. Where the store sells the $599.99 bundle product, it is
about 5 months.

## Open decisions (Daniel)

- Credit-based insurance score and CLUE vendors for the pull at quote.
- AIF entity name and fee % (placeholder 20%).
