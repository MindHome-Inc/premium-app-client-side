/* ============================================================
     MindHome bind workflow (Bind stage)
     ------------------------------------------------------------
     Turns an accepted quote into a bound HO-3 policy plus a
     separately charged device/install order. Runs in the browser
     (window.MHBind), in /.netlify/functions/bind and in the tests.

     Bind CONSUMES the Quote's outputs (premium, underwriting
     decision, MH-100 provisional credit, devices, install choice).
     It never calls rate() or decide(). reconcileQuote() only checks
     that the worksheet the customer saw adds up, so a premium that
     doesn't reconcile is caught as a bug, not rounded away.

     Accept → application.signed, payment.captured, policy.bound,
       endorsement.attached, subscriber.enrolled, fulfillment.released,
       install.booked, evidence.sent (the last few as applicable).
     Refer  → "Submit to underwriter": application.signed, the device
       charge, application.referred. No premium capture, no
       policy.bound, and the device order + install window are held.

     Payment processors are adapters. Only the sandbox exists until
     Daniel picks the premium processor and the trust account; raw
     card / bank numbers never leave the browser (tokenize first).
     ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../rating/engine"));
  else root.MHBind = factory(root.MHRating);
})(typeof self !== "undefined" ? self : this, function (MHRating) {
  "use strict";

  const BIND_VERSION = "0.1.0";

  const BIND_CONFIG = {
    timeZone: "America/Denver",
    form: "HO-3",
    termMonths: 12,
    effectiveWindowDays: 60,
    carrier: {
      name: "MindHome Homeowners Reciprocal Exchange",
      plan: "Plan HR",
    },
    /* Placeholders until Daniel decides (also on the ticket). */
    aif: {
      placeholder: true,
      pendingDecision: "AIF entity name, fee % and any surplus contribution (Daniel)",
      entityName: "MindHome Reciprocal Management, LLC",
      feePct: 20,
      surplusContribution: null,
    },
    premiumPayee: {
      name: "MindHome Homeowners Reciprocal Exchange",
      account: "premium_trust",
      pendingDecision: "Premium processor + segregated fiduciary/trust account (Daniel)",
    },
    devicePayee: { name: "MindHome Inc.", account: "operating" },
    plans: {
      full: { label: "Pay in full", installments: 1, intervalMonths: 0, fee: 0 },
      two_pay: { label: "2-pay", installments: 2, intervalMonths: 6, fee: 0 },
      /* $6 once per term, charged with installment 1 (the boss's
         answer on Nov 23, still to be confirmed). For $6 on every
         installment, set feePer to "installment". */
      ten_pay: { label: "10-pay", installments: 10, intervalMonths: 1, fee: 6, feePer: "term" },
      mortgagee: { label: "Mortgagee bill", installments: 1, intervalMonths: 0, fee: 0, billedTo: "mortgagee" },
    },
    acknowledgements: [
      {
        id: "device_separate",
        version: "2026-11-03",
        text: "My device purchase is separate from my insurance coverage. Coverage is not conditioned on buying devices.",
      },
      {
        id: "other_devices",
        version: "2026-11-03",
        text: "Devices from other sources can earn the MH-100 credit after a verification visit.",
      },
      {
        id: "mh100_provisional",
        version: "2026-11-03",
        text: "My MH-100 credit is provisional at bind. It is verified by the install visit or my devices reporting online within 60 days; otherwise it is removed by endorsement and I owe pro-rata additional premium. It continues while my devices keep a heartbeat.",
      },
      {
        id: "subscriber_aif",
        version: "2026-11-03",
        text: "I agree to the Subscriber Agreement of MindHome Homeowners Reciprocal Exchange (Plan HR) and appoint the attorney-in-fact named below.",
      },
    ],
  };

  /* ---------- dates (YYYY-MM-DD strings, calendar days) ---------- */
  function todayIn(timeZone, now) {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || BIND_CONFIG.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now || new Date());
  }
  function isIsoDate(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
  }
  function addDays(iso, days) {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  /* Adds months, clamping to the month's last day (Jan 31 + 1 → Feb 28). */
  function addMonths(iso, months) {
    const [y, m, d] = iso.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1 + months, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(d, last));
    return first.toISOString().slice(0, 10);
  }
  function effectiveWindow(today) {
    return { min: today, max: addDays(today, BIND_CONFIG.effectiveWindowDays) };
  }

  const cents = (n) => Math.round(n * 100);
  const dollars = (c) => c / 100;

  /* ---------- premium plans ---------- */
  /**
   * Splits the annual premium the Quote produced into the plan's
   * installments. Cents left over from an uneven split go on the first
   * installment, so the installments always add back to the premium.
   * The first installment is due on the bind date; later ones count
   * from the effective date.
   */
  function premiumSchedule(annualPremium, planId, { bindDate, effectiveDate }) {
    const plan = BIND_CONFIG.plans[planId];
    if (!plan) throw new Error(`Unknown premium plan: ${planId}`);
    const total = cents(annualPremium);
    const n = plan.installments;
    const each = Math.floor(total / n);
    const firstPremium = total - each * (n - 1);
    const feeEach = plan.fee ? cents(plan.fee) : 0;
    const installments = [];
    for (let i = 0; i < n; i++) {
      const premium = i === 0 ? firstPremium : each;
      const fee = plan.feePer === "term" ? (i === 0 ? feeEach : 0) : feeEach;
      installments.push({
        n: i + 1,
        dueDate: i === 0 ? bindDate : addMonths(effectiveDate, i * plan.intervalMonths),
        premium: dollars(premium),
        fee: dollars(fee),
        amount: dollars(premium + fee),
      });
    }
    const billedToMortgagee = plan.billedTo === "mortgagee";
    return {
      plan: planId,
      label: plan.label,
      billedTo: billedToMortgagee ? "mortgagee" : "insured",
      annualPremium: dollars(total),
      fees: dollars(installments.reduce((s, x) => s + cents(x.fee), 0)),
      totalPayable: dollars(installments.reduce((s, x) => s + cents(x.amount), 0)),
      installments,
      // The mortgagee is billed; nothing is charged to the insured today.
      dueToday: billedToMortgagee ? 0 : installments[0].amount,
    };
  }

  /**
   * What is charged today, as TWO separate charges that are never
   * added together: the premium (to the exchange's premium trust
   * account) and the devices/install (from MindHome Inc.).
   * On a referral nothing is captured: the premium and the devices
   * are charged only if an underwriter approves.
   */
  function dueToday(snapshot, schedule) {
    const referral = snapshot.uw.decision === "refer";
    const dc = snapshot.deviceCharge || { amount: 0, financing: "once" };
    const financed = dc.financing === "powerpay";
    return {
      premium: {
        kind: "premium",
        payee: BIND_CONFIG.premiumPayee.name,
        account: BIND_CONFIG.premiumPayee.account,
        amount: referral ? 0 : schedule.dueToday,
        note: referral
          ? "Not charged until an underwriter approves"
          : schedule.billedTo === "mortgagee"
            ? "Billed to your mortgagee"
            : schedule.installments.length > 1
              ? `Installment 1 of ${schedule.installments.length}`
              : "Annual premium",
      },
      device: {
        kind: "device",
        payee: BIND_CONFIG.devicePayee.name,
        account: BIND_CONFIG.devicePayee.account,
        amount: financed || referral ? 0 : dc.amount || 0,
        note: !dc.amount
          ? "No devices"
          : financed
            ? "Financed with PowerPay"
            : referral
              ? "Not charged until an underwriter approves; order held"
              : "Devices and install, one-time",
      },
    };
  }

  /* ---------- Quote snapshot: consume, don't re-rate ---------- */
  /**
   * Freezes what the Quote produced into the snapshot Bind works from.
   * @param rated  the rate() result the customer was shown
   * @param uw     the decide() result for that quote
   * @param extra  { quoteRef, namedInsured: { first, last }, propertyAddress,
   *                 email, phone, devices, proInstall, installWindow,
   *                 deviceCharge: { amount, financing: "once" | "powerpay" } }
   */
  function snapshotFromQuote(rated, uw, extra) {
    return {
      quoteRef: extra.quoteRef,
      ratedAt: rated.asOf,
      engineVersion: rated.engineVersion,
      coverageA: rated.coverageA,
      limits: rated.limits,
      premiumBeforeCredits: rated.premiumBeforeCredits,
      premiumAfterCredits: rated.premiumAfterCredits,
      flatCharges: rated.flatCharges,
      policyFee: rated.policyFee,
      annualPremium: rated.annualPremium,
      annualPremiumWithoutCredits: rated.annualPremiumWithoutCredits,
      credits: rated.credits,
      uw: uw && { decision: uw.decision, reasons: uw.reasons, referral: uw.referral, uwVersion: uw.uwVersion },
      namedInsured: extra.namedInsured,
      propertyAddress: extra.propertyAddress || null,
      email: extra.email || null,
      phone: extra.phone || null,
      devices: { ...(extra.devices || {}) },
      proInstall: !!extra.proInstall,
      installWindow: extra.installWindow || null,
      deviceCharge: extra.deviceCharge || { amount: 0, financing: "once" },
    };
  }

  /**
   * Checks the Quote snapshot is complete and that its worksheet adds
   * up. Returns a list of problems; empty means it reconciles.
   */
  function reconcileQuote(s) {
    const problems = [];
    if (!s || typeof s !== "object") return ["quote snapshot is missing"];
    if (!s.quoteRef) problems.push("quoteRef is missing");
    if (!s.uw || !["accept", "refer", "decline"].includes(s.uw.decision)) problems.push("underwriting decision is missing");
    else if (s.uw.decision === "decline") problems.push("a declined quote can't be bound");
    else if ((s.uw.decision === "refer") !== !!(s.uw.referral && s.uw.referral.flag))
      problems.push("referral flag doesn't match the underwriting decision");
    if (!(s.annualPremium > 0)) problems.push("annual premium is missing");
    if (problems.length) return problems;

    const flat = (s.flatCharges || []).reduce((t, x) => t + x.amount, 0);
    const expectAnnual = Math.round(s.premiumAfterCredits + flat + s.policyFee);
    if (expectAnnual !== s.annualPremium)
      problems.push(`annual premium ${s.annualPremium} doesn't match the worksheet (${expectAnnual})`);

    const c = s.credits || {};
    const appliedPct = (c.applied || []).reduce((t, x) => t + x.pct, 0);
    if (c.pct !== Math.min(appliedPct, c.capPct)) problems.push("credit % doesn't match the credits applied and the cap");
    if (Math.abs(cents(s.premiumBeforeCredits * (c.pct / 100)) - cents(c.amount)) > 1)
      problems.push("credit amount doesn't match the credit %");
    if (Math.abs(cents(s.premiumBeforeCredits - c.amount) - cents(s.premiumAfterCredits)) > 1)
      problems.push("premium after credits doesn't match");

    if (MHRating) {
      const e = MHRating.creditEligibility(s.devices, s.proInstall);
      const names = (c.applied || []).map((x) => x.name).sort().join(",");
      const expect = [e.fire && "fire", e.water && "water"].filter(Boolean).sort().join(",");
      if (names !== expect) problems.push(`credits applied (${names || "none"}) don't match the devices (${expect || "none"})`);
    }
    return problems;
  }

  /* ---------- payment field checks ---------- */
  const digits = (s) => String(s || "").replace(/\D/g, "");
  function luhn(num) {
    const d = digits(num);
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let x = +d[d.length - 1 - i];
      if (i % 2) {
        x *= 2;
        if (x > 9) x -= 9;
      }
      sum += x;
    }
    return d.length > 0 && sum % 10 === 0;
  }
  function cardBrand(num) {
    const d = digits(num);
    if (/^4/.test(d)) return "visa";
    if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return "mastercard";
    if (/^3[47]/.test(d)) return "amex";
    if (/^(6011|65|64[4-9])/.test(d)) return "discover";
    return null;
  }
  /* ABA routing checksum: 3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) ≡ 0 mod 10 */
  function abaRouting(r) {
    const d = digits(r);
    if (d.length !== 9 || String(r).trim() !== d) return false;
    const n = d.split("").map(Number);
    return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0;
  }
  /* "MM/YY" → still valid this month or later? */
  function expiryOk(exp, today) {
    const m = /^\s*(\d{2})\s*\/\s*(\d{2})\s*$/.exec(exp || "");
    if (!m) return false;
    const month = +m[1],
      year = 2000 + +m[2];
    if (month < 1 || month > 12) return false;
    const [ty, tm] = today.split("-").map(Number);
    return year > ty || (year === ty && month >= tm);
  }
  const normName = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

  function paymentRequired(snapshot, schedule) {
    // Premium installments still need a payment method unless the
    // mortgagee pays the premium; so do devices, even on a referral,
    // where they are charged on approval.
    const dc = snapshot.deviceCharge || {};
    return schedule.billedTo !== "mortgagee" || (dc.amount > 0 && dc.financing !== "powerpay");
  }

  /* Raw fields, checked in the browser before tokenizing. */
  function validatePaymentFields(p, today, errors) {
    if (!p || !["card", "ach"].includes(p.method)) {
      errors["payment.method"] = "Choose card or bank account (ACH)";
      return;
    }
    if (p.method === "card") {
      const c = p.card || {};
      if (!String(c.name || "").trim()) errors["payment.card.name"] = "Enter the name on the card";
      const brand = cardBrand(c.number);
      const len = digits(c.number).length;
      if (!len) errors["payment.card.number"] = "Enter the card number";
      else if (!brand || len < 13 || len > 19 || !luhn(c.number)) errors["payment.card.number"] = "That card number isn't valid";
      if (!c.exp) errors["payment.card.exp"] = "Enter the expiry as MM/YY";
      else if (!expiryOk(c.exp, today)) errors["payment.card.exp"] = "Use MM/YY, not in the past";
      const cvcLen = brand === "amex" ? 4 : 3;
      if (digits(c.cvc).length !== cvcLen || String(c.cvc).trim().length !== cvcLen)
        errors["payment.card.cvc"] = `Enter the ${cvcLen}-digit security code`;
      if (!/^\d{5}$/.test(String(c.zip || "").trim())) errors["payment.card.zip"] = "Enter the 5-digit billing ZIP";
    } else {
      const a = p.ach || {};
      if (!String(a.name || "").trim()) errors["payment.ach.name"] = "Enter the account holder's name";
      if (!abaRouting(a.routing)) errors["payment.ach.routing"] = "Enter a valid 9-digit routing number";
      const acct = String(a.account || "").trim();
      if (!/^\d{4,17}$/.test(acct)) errors["payment.ach.account"] = "Enter the account number (4–17 digits)";
      if (acct && String(a.accountConfirm || "").trim() !== acct) errors["payment.ach.accountConfirm"] = "Account numbers don't match";
      if (!["checking", "savings"].includes(a.type)) errors["payment.ach.type"] = "Choose checking or savings";
      if (!a.authorized) errors["payment.ach.authorized"] = "Authorize the bank debit to continue";
    }
  }

  /* Tokenized payment, as the server receives it. */
  function validatePaymentToken(p, errors) {
    if (!p || !["card", "ach"].includes(p.method)) errors["payment.method"] = "Choose card or bank account (ACH)";
    else if (!p.token || !/^\d{4}$/.test(String(p.last4 || ""))) errors["payment.token"] = "Payment details are missing; enter them again";
    else if (p.method === "ach" && !p.authorized) errors["payment.ach.authorized"] = "Authorize the bank debit to continue";
  }

  /**
   * Field-level validation of the Bind page. Returns { field: message }
   * for every problem; empty means the Bind button can enable.
   * @param app { effectiveDate, mortgagee: { has, name, loanNumber },
   *              plan, payment, acks: { id: true }, signature }
   * @param ctx { snapshot, today, paymentMode: "raw" | "token" }
   */
  function validateApplication(app, ctx) {
    const errors = {};
    const today = ctx.today;
    const s = ctx.snapshot;
    app = app || {};

    const win = effectiveWindow(today);
    if (!app.effectiveDate) errors.effectiveDate = "Choose an effective date";
    else if (!isIsoDate(app.effectiveDate)) errors.effectiveDate = "Use a valid date";
    else if (app.effectiveDate < win.min) errors.effectiveDate = "The effective date can't be in the past";
    else if (app.effectiveDate > win.max) errors.effectiveDate = `Choose a date within ${BIND_CONFIG.effectiveWindowDays} days (by ${win.max})`;

    const m = app.mortgagee || {};
    if (m.has !== true && m.has !== false) errors["mortgagee.has"] = "Tell us whether there's a mortgage on the home";
    if (m.has) {
      if (!String(m.name || "").trim()) errors["mortgagee.name"] = "Enter the mortgage company's name";
      if (!/^[A-Za-z0-9-]{4,30}$/.test(String(m.loanNumber || "").trim()))
        errors["mortgagee.loanNumber"] = "Enter the loan number (4–30 letters, digits or dashes)";
    }

    if (!BIND_CONFIG.plans[app.plan]) errors.plan = "Choose a premium plan";
    else if (app.plan === "mortgagee" && m.has !== true) errors.plan = "Mortgagee bill needs a mortgagee";

    if (!errors.plan && s) {
      // Whether payment is needed doesn't depend on the date, so check it
      // even while the date is still wrong.
      const schedule = premiumSchedule(s.annualPremium, app.plan, { bindDate: today, effectiveDate: errors.effectiveDate ? today : app.effectiveDate });
      if (paymentRequired(s, schedule)) {
        if (ctx.paymentMode === "token") validatePaymentToken(app.payment, errors);
        else validatePaymentFields(app.payment, today, errors);
      }
    }

    const acks = app.acks || {};
    for (const a of BIND_CONFIG.acknowledgements)
      if (acks[a.id] !== true) errors["acks." + a.id] = "Required before you sign";

    const insured = s && s.namedInsured ? `${s.namedInsured.first} ${s.namedInsured.last}` : "";
    if (!String(app.signature || "").trim()) errors.signature = "Type your full name to sign";
    else if (insured && normName(app.signature) !== normName(insured))
      errors.signature = `Type your name exactly as the named insured: ${insured}`;
    return errors;
  }

  /* ---------- MH-100 provisional endorsement ---------- */
  function mh100Endorsement(s, effectiveDate) {
    const c = s.credits;
    if (!c || !c.pct) return null;
    return {
      code: c.endorsement || "MH-100",
      status: "provisional",
      pct: c.pct,
      applied: c.applied.map((x) => ({ name: x.name, pct: x.pct })),
      capPct: c.capPct,
      annualCredit: c.amount,
      appliedBefore: "policy fee",
      // Counted from the effective date, so the deadline can't fall
      // before coverage starts.
      verifyBy: addDays(effectiveDate, (MHRating && MHRating.RATING_CONFIG.credits.verifyWithinDays) || 60),
      verifiedBy: ["install_visit", "devices_online"],
      ifUnverified: "remove by endorsement with pro-rata additional premium",
      continuesWhile: "devices keep a heartbeat",
    };
  }

  /* ---------- sandbox processors ----------
       Stand-ins until the real premium processor / trust account
       (Daniel) and the Shopify port. They never move money. */
  function sandboxId(prefix) {
    return prefix + "_sbx_" + Math.random().toString(36).slice(2, 10);
  }
  /* Browser-side stand-in for the processor's hosted fields: turns raw
     details into a token + last 4 so the numbers never leave the page. */
  function sandboxTokenize(p) {
    const src = p.method === "card" ? p.card : p.ach;
    const num = digits(p.method === "card" ? src.number : src.account);
    return {
      method: p.method,
      token: sandboxId(p.method === "card" ? "tok" : "btok"),
      last4: num.slice(-4),
      brand: p.method === "card" ? cardBrand(src.number) : null,
      accountType: p.method === "ach" ? src.type : null,
      holder: String(src.name || "").trim(),
      authorized: p.method === "ach" ? !!src.authorized : undefined,
      sandbox: true,
    };
  }
  const SANDBOX_PROCESSORS = {
    premium: {
      name: "sandbox",
      async capture({ amount, payment }) {
        return { ref: sandboxId("pi"), status: "captured", amount, sandbox: true, method: payment && payment.method };
      },
      async void(ref) {
        return { ref, status: "voided", sandbox: true };
      },
    },
    device: {
      name: "sandbox",
      async capture({ amount, payment }) {
        return { ref: sandboxId("ch"), status: "captured", amount, sandbox: true, method: payment && payment.method };
      },
      async void(ref) {
        return { ref, status: "voided", sandbox: true };
      },
      async createOrder({ hold }) {
        return { orderRef: sandboxId("ord"), status: hold ? "on_hold" : "pending_release", holdUntil: hold || null, sandbox: true };
      },
    },
  };

  /* ---------- the bind ---------- */
  /**
   * Runs the bind (accept) or the underwriter submission (refer).
   * @param input { snapshot, application (tokenized payment), meta: { ip, userAgent } }
   * @param opts  { now: Date, processors }
   * @returns { ok, status: "bound" | "referred", bindId, events, ... }
   *          or { ok: false, errors } (field-level) / { ok: false, problems } (quote)
   */
  async function runBind(input, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    const proc = opts.processors || SANDBOX_PROCESSORS;
    const sandbox = proc === SANDBOX_PROCESSORS || !!opts.sandbox;
    const s = input.snapshot;
    const app = input.application || {};
    const today = todayIn(BIND_CONFIG.timeZone, now);

    const problems = reconcileQuote(s);
    if (problems.length) return { ok: false, problems };
    const errors = validateApplication(app, { snapshot: s, today, paymentMode: "token" });
    if (Object.keys(errors).length) return { ok: false, errors };

    const referral = s.uw.decision === "refer";
    const schedule = premiumSchedule(s.annualPremium, app.plan, { bindDate: today, effectiveDate: app.effectiveDate });
    const due = dueToday(s, schedule);
    const bindId = "BND-" + s.quoteRef.replace(/^HQ-/, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    let seq = 0;
    const at = () => new Date(now.getTime() + seq++).toISOString(); // keeps events strictly ordered
    const base = (type) => ({ type, quoteRef: s.quoteRef, bindId, occurredAt: at(), bindVersion: BIND_VERSION, ...(sandbox ? { sandbox: true } : {}) });
    const payment = app.payment
      ? { method: app.payment.method, last4: app.payment.last4, brand: app.payment.brand || null, accountType: app.payment.accountType || null }
      : null;
    const mortgagee = app.mortgagee && app.mortgagee.has ? { name: app.mortgagee.name.trim(), loanNumber: app.mortgagee.loanNumber.trim() } : null;
    const hasDevices = (s.deviceCharge && s.deviceCharge.amount > 0) || Object.values(s.devices || {}).some((q) => q > 0);
    const holdUntil = referral ? addDays(today, s.uw.referral.orderHoldDays || 7) : null;
    const events = [];

    events.push({
      ...base("application.signed"),
      namedInsured: s.namedInsured,
      propertyAddress: s.propertyAddress || null,
      effectiveDate: app.effectiveDate,
      mortgagee,
      premiumPlan: app.plan,
      acknowledgements: BIND_CONFIG.acknowledgements.map((a) => ({ id: a.id, version: a.version, accepted: true })),
      aif: { ...BIND_CONFIG.aif },
      signature: { typedName: String(app.signature).trim(), method: "typed", signedAt: now.toISOString(), ...(input.meta || {}) },
      uwDecision: s.uw.decision,
    });

    /* Two separate charges, never merged. Premium first; if the device
       charge fails, the premium is voided so nothing is half-done. */
    const charges = [];
    let premiumCharge = null;
    if (!referral && due.premium.amount > 0) {
      premiumCharge = await proc.premium.capture({ amount: due.premium.amount, payment: app.payment, bindId });
      charges.push({ kind: "premium", amount: due.premium.amount, payee: due.premium.payee, account: due.premium.account, method: payment, processorRef: premiumCharge.ref, status: premiumCharge.status });
    } else {
      charges.push({ kind: "premium", amount: 0, payee: due.premium.payee, account: due.premium.account, status: referral ? "not_captured_referral" : "billed_to_mortgagee" });
    }
    if (due.device.amount > 0) {
      let deviceCharge;
      try {
        deviceCharge = await proc.device.capture({ amount: due.device.amount, payment: app.payment, bindId });
      } catch (e) {
        if (premiumCharge) await proc.premium.void(premiumCharge.ref);
        return { ok: false, errors: { payment: "The device charge failed, so nothing was charged. " + e.message } };
      }
      charges.push({ kind: "device", amount: due.device.amount, payee: due.device.payee, account: due.device.account, method: payment, processorRef: deviceCharge.ref, status: deviceCharge.status });
    } else if (hasDevices) {
      const financed = s.deviceCharge && s.deviceCharge.financing === "powerpay";
      charges.push({ kind: "device", amount: 0, payee: due.device.payee, status: financed ? "financed_powerpay" : referral ? "not_captured_referral" : "none" });
    }
    if (charges.some((c) => c.processorRef)) events.push({ ...base("payment.captured"), charges });

    const order = hasDevices ? await proc.device.createOrder({ bindId, quoteRef: s.quoteRef, devices: s.devices, hold: holdUntil }) : null;
    const installHeld = !!(s.proInstall && (s.devices || {}).shutoff >= 1);
    const install = installHeld ? { window: s.installWindow || null, status: referral ? "held" : "booked", holdUntil } : null;

    if (referral) {
      events.push({
        ...base("application.referred"),
        reasons: s.uw.reasons,
        bindAction: s.uw.referral.bindAction || "Submit to underwriter",
        premium: { captured: false, schedule: schedule.plan, dueOnApproval: schedule.dueToday },
        devices: { captured: false, dueOnApproval: s.deviceCharge && s.deviceCharge.financing !== "powerpay" ? s.deviceCharge.amount || 0 : 0 },
        deviceOrder: order && { orderRef: order.orderRef, status: "on_hold", holdUntil },
        installWindow: install && { ...install, status: "held" },
        fulfillmentReleased: false,
      });
      return { ok: true, status: "referred", bindId, today, schedule, dueToday: due, charges, order, install, holdUntil, events };
    }

    const expirationDate = addMonths(app.effectiveDate, BIND_CONFIG.termMonths);
    const endorsement = mh100Endorsement(s, app.effectiveDate);
    events.push({
      ...base("policy.bound"),
      policyNumber: null, // assigned by Issue policy
      form: BIND_CONFIG.form,
      carrier: BIND_CONFIG.carrier,
      effectiveDate: app.effectiveDate,
      expirationDate,
      namedInsured: s.namedInsured,
      propertyAddress: s.propertyAddress || null,
      mortgagee,
      premium: {
        annual: s.annualPremium,
        annualWithoutCredits: s.annualPremiumWithoutCredits,
        policyFee: s.policyFee,
        plan: schedule.plan,
        billedTo: schedule.billedTo,
        installments: schedule.installments,
        fees: schedule.fees,
        totalPayable: schedule.totalPayable,
      },
      limits: s.limits,
      quote: { engineVersion: s.engineVersion, ratedAt: s.ratedAt, uwDecision: s.uw.decision, uwVersion: s.uw.uwVersion },
      endorsements: endorsement ? [endorsement.code] : [],
    });
    if (endorsement) events.push({ ...base("endorsement.attached"), endorsement });
    events.push({
      ...base("subscriber.enrolled"),
      exchange: BIND_CONFIG.carrier,
      subscriber: s.namedInsured,
      aif: { ...BIND_CONFIG.aif },
      subscriberAgreementVersion: BIND_CONFIG.acknowledgements.find((a) => a.id === "subscriber_aif").version,
    });
    if (order) events.push({ ...base("fulfillment.released"), orderRef: order.orderRef, devices: s.devices, proInstall: !!s.proInstall });
    if (install) events.push({ ...base("install.booked"), ...install, orderRef: order && order.orderRef });
    if (mortgagee)
      events.push({ ...base("evidence.sent"), to: mortgagee, document: "evidence_of_insurance", effectiveDate: app.effectiveDate, channel: sandbox ? "sandbox" : "pending" });

    return { ok: true, status: "bound", bindId, today, effectiveDate: app.effectiveDate, expirationDate, schedule, dueToday: due, charges, order, install, endorsement, events };
  }

  return {
    BIND_VERSION,
    BIND_CONFIG,
    SANDBOX_PROCESSORS,
    todayIn,
    addDays,
    addMonths,
    effectiveWindow,
    premiumSchedule,
    dueToday,
    snapshotFromQuote,
    reconcileQuote,
    validateApplication,
    paymentRequired,
    mh100Endorsement,
    sandboxTokenize,
    runBind,
    luhn,
    cardBrand,
    abaRouting,
  };
});
