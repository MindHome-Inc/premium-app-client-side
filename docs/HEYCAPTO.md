# HeyCapto: answers from their public site

Checked 2026-10-13 against heycapto.com, /plans, /reports, /how-it-works,
/contact and /terms (Terms last revised 2026-06-03). Nothing was sent to
HeyCapto; anything their site doesn't answer is listed as a question for them.

## Do they offer a data feed or API for rating systems?

**No, not publicly.** No page mentions an API or data feed. The product is a
Chrome extension plus portal. The only bulk path is CSV/Excel upload (one
address per row) on Professional and Enterprise: Stage 1 runs free on every
row, Stage 2 analyses are billed per address, and a "CSV batch report" mode
returns "a trimmed spreadsheet." Enterprise is custom-priced with unlimited
tokens; real-time access would have to be negotiated there.

Pricing: Starter $29/seat/mo (30 tokens), Professional $49/seat/mo (60 pooled
tokens), Enterprise custom. Tokens: Full Hazard 3, Replacement Cost 3, Permits
3, Advanced Wildfire 3, Advanced Flood 1, Emergency Response Proximity 1, Roof
Condition 16; RCE + Hazard + Permits bundle 7; all Stage 2 is 23.

## Do seat terms permit extracting scores for training?

**Not on standard terms, for our use.** The Terms allow downloads only "for
your internal business purposes," bar "scraping, crawling, bots, or automated
tools" without prior written permission, say "you may not sell or modify the
Content" without permission, and bar using the site or its outputs "to
develop, train or improve any product, model, service or dataset that
competes with Hey Capto or the Site." Third-Party Content (which includes
"climate and hazard datasets") is "provided subject to applicable third-party
terms" and may not be reproduced or commercially exploited.

An internal pricing training set is arguably internal business use and not a
competing product, but scores built into a filed rating plan are a commercial
use of their outputs and of third-party data. **This needs written permission
or an Enterprise data-licensing agreement before we build on it.** Also note
the Terms let HeyCapto keep and train on what we upload, during and after the
subscription.

## What models and sources back each hazard grade?

**Mostly undisclosed.** Their FAQ lists "What data sources do you use?" but
the public page gives no answer. The site says only that they "pull from a
deep stack of property, hazard, permit, and imagery sources," that every
score is "sourced, dated, and documented," that the product is "designed with
the NAIC Model Bulletin on AI in mind," and that "compliance documentation"
and "score methodology documentation" are available on request. Named so far:

- Advanced Wildfire: "Athena Intelligence advanced wildfire models," with a
  WUI zone assessment.
- Advanced Flood: a "FloodGrade composite across five risk components," with
  100- and 500-year zones and elevation; components and weights not listed.
- Roof Condition: satellite and aerial imagery "analyzed by machine learning
  models"; imagery provider not named.
- Replacement Cost: "local construction costs, materials, and property
  characteristics," with a confidence level; source not named.
- Crime, earthquake, environmental, wind, hail, permits: no source named.

Their own footer says Capto "provides decision support — never underwriting
advice," so actuarial defensibility rests on the methodology documents, not
the site.

One inconsistency: the home page lists Full Hazard perils as wildfire, flood,
crime, earthquake, environmental, wind, hail; the reports page lists hail,
tornado, hurricane, crime, earthquake, wildfire.

## Still to ask HeyCapto (via Daniel)

1. Is there an API or data feed for rating systems, or is that an Enterprise
   build?
2. Written terms for using scores in a filed rating plan and in a training
   set, including the third-party data inside them.
3. The score methodology and compliance documentation for each grade
   (sources, vintage, model owners), which their site offers on request.
4. Whether they will waive or narrow the clause letting them retain and train
   on our uploaded addresses.
