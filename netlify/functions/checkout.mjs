// netlify/functions/checkout.mjs
// Creates a Stripe Checkout session. Requires env vars:
//   STRIPE_SECRET_KEY        (sk_live_... or sk_test_...)
//   PRICE_STANDARD           (price_... for the $79 deep audit)
//   PRICE_AGENCY             (price_... for the $149 white-label tier)
//   SITE_URL                 (https://signalcheck.app)  optional, falls back to request origin
//
// npm i stripe   (add to package.json)

import Stripe from "stripe";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json({ error: "Stripe not configured" }, 500);
  const stripe = new Stripe(key);

  let tier, url;
  try {
    ({ tier, url } = await req.json());
  } catch {
    return json({ error: "bad body" }, 400);
  }

  const price = tier === "agency" ? process.env.PRICE_AGENCY : process.env.PRICE_STANDARD;
  if (!price) return json({ error: "price not set for tier" }, 500);

  const origin =
    process.env.SITE_URL ||
    req.headers.get("origin") ||
    "https://" + (req.headers.get("host") || "signalcheck.app");

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price, quantity: 1 }],
      // carry the scanned URL through so the success page / webhook can
      // tie the payment to the audit that was run
      metadata: { tier: tier || "standard", scanned_url: url || "" },
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,
      // collect email so you can deliver the PDF
      customer_creation: "always",
    });
    return json({ id: session.id, url: session.url });
  } catch (e) {
    return json({ error: e.message || "stripe error" }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
