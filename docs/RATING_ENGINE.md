# Premium rating engine

The quote form in `index.html` rates the home with `rating/engine.js`. The
same file runs in the browser (`window.MHRating`), in the `/.netlify/functions/rate` Netlify
function, and in the tests.

> **Every factor is illustrative.** Nothing in `RATING_CONFIG` is a filed
> factor. Each table carries `illustrative: true` and a `swap` note. To swap in
> filed factors, change the values in `RATING_CONFIG` and set
> `illustrative: false`; the engine code does not change. Run
> `MHRating.illustrativeFactors()` (or `npm test`) to list what is still
> illustrative.

## How a premium is built

1. **Coverage A** = square footage × replacement cost per sq ft for the
   construction type, rounded to the nearest $1,000 (or the customer's own
   figure if they type one).
2. **Base premium** = $4.20 per $1,000 of Coverage A.
3. **× factors**: construction, protection class, age of home, roof age ×
   material, credit-based insurance score, CLUE loss history.
4. **− mitigation credits** (endorsement MH-100, provisional at bind, verified
   within 60 days), capped at 50% combined:
   - Fire 20%: ≥1 auto fire extinguisher + Ting arc fault monitor
   - Water 30%: shutoff valve + ≥3 leak sensors + professional install of the valve
5. **+ $30 policy fee**, then rounded to the dollar.

The AIF fee is shown as an allocation of the credited premium; it does not
change what the customer pays.

## Sample Boulder home (sanity check)

2,150 sq ft, 1998 frame, 2014 asphalt roof, PC 3, rated on 2026-10-13:

| Step | Value |
|---|---|
| Coverage A | 2,150 × $285 → **$613,000** |
| Base premium | 613 × $4.20 = $2,574.60 |
| Factors | frame 1.00 × PC3 1.00 × age 28 yrs 1.05 × asphalt roof 12 yrs 1.17 × score 1.00 × CLUE 1.00 = 1.2285 |
| Before credits | $3,162.90 + $30 fee = **$3,193/yr** |
| Complete Bundle + pro install | 50% credit → $1,581.45 + $30 = **$1,611/yr** |

The illustrative tables were calibrated to reproduce these plan targets.
`rating/engine.test.js` locks them in.

## `quote.rated` event

The page posts the rating inputs to `/.netlify/functions/rate` (debounced, and again when the
quote is submitted). The function re-rates and writes one line to the Netlify
function log:

```
INTEGRATION_LOG {"type":"quote.rated","quoteRef":"HQ-…","premium":{…},"factors":[…],"credits":{…},"aif":{…},"inputs":{…},"pendingDecisions":[…]}
```

The event carries the annual premium (with and without credits), Coverage A,
every factor with its basis, the credits applied (status, MH-100, verify-by
date, cap), the AIF allocation, every input used (including the credit-score,
CLUE and hazard-grade slots and whether they were pulled), and the open
decisions. The page also keeps each event in `window.MH_INTEGRATION_LOG` and
fires a `quote.rated` DOM event. If the function is unreachable, the page
builds the event itself and marks it `source: "client"`.

## Open decisions (Daniel)

These are placeholders, not guesses:

| Decision | Where it lives | Placeholder today |
|---|---|---|
| Filed factors for the CO program | every table in `RATING_CONFIG` | illustrative values above |
| Is the 50% combined credit cap supportable in a CO filing (loss-cost support for MH-100)? | `credits.combinedCapPct` | 50 |
| Credit-based insurance score vendor | `factors.insuranceScore` | not pulled, factor 1.00 |
| CLUE vendor | `factors.lossHistory` | not pulled, factor 1.00 |
| AIF entity name and fee % | `aif` | `[AIF ENTITY TBD]`, 20% |

Once vendors are picked, the quote flow fills `insuranceScore` and
`lossHistory` in `ratingInput()` (index.html) and the filed tiers go in the
two factor tables.

## HeyCapto

HeyCapto hazard grades have a slot in the inputs (`hazardGrades`) and are
recorded on `quote.rated`, but they do not move the price
(`hazardGrades.rated: false`). See `docs/HEYCAPTO.md` for what their public
site says about the open questions.

## Running it

```
npm test   # engine + rate function
```

To try the page locally with the function, use `netlify dev`. Opened any other
way, the page falls back to rating in the browser (`source: "client"`).
