# SignalCheck

Pay-per-audit tracking diagnostic. Scans a URL server-side, shows surface
findings free, gates the deep findings behind Stripe. Agency tier delivers a
white-label PDF.

## What's here

```
index.html                      landing page + live scanner + paywall
report.html                     white-label PDF report builder (agency deliverable)
success.html                    post-payment page
netlify.toml                    config + /scan and /checkout redirects
package.json                    stripe dependency
netlify/functions/scan.mjs      server-side page fetch + signature scan -> JSON
netlify/functions/checkout.mjs  creates Stripe Checkout session
```

## Deploy (about 15 minutes)

1. Push this folder to a GitHub repo, or drag it into Netlify > Add new site.
2. Netlify auto-detects `netlify.toml`. Build runs `npm install` for the stripe dep.
3. Site goes live. The free scanner works immediately, no keys needed.

## Turn on payments

In Stripe:
- Create two Products with one-time prices: $79 (standard), $149 (agency).
- Copy each `price_...` id.

In Netlify > Site settings > Environment variables, add:
```
STRIPE_SECRET_KEY = sk_live_xxx   (or sk_test_xxx to test)
PRICE_STANDARD    = price_xxx
PRICE_AGENCY      = price_xxx
SITE_URL          = https://your-site.netlify.app
```

In `index.html` set `STRIPE_PUBLISHABLE_KEY` (only needed if you switch to the
client-side redirect path; the hosted-checkout path uses `session.url` and
doesn't need it). Redeploy.

That's it. Buttons now open real Stripe Checkout and land on success.html.

## Delivering the agency report

1. Run the scan. Open browser console and copy `LAST_RESULT` (or rebuild the
   object from the scan response).
2. Open `report.html`, paste the JSON into the toolbar, click Load data.
3. Add the agency block to the JSON for white-label:
   ```json
   "agency": { "name":"Your Agency", "accent":"#0fae4c",
               "prepared_for":"Client Name", "analyst":"Morgan Avenia" }
   ```
4. Save as PDF (the toolbar button), email it to the buyer.

To make this one-click later: have a webhook write the scan result + email to
Supabase on `checkout.session.completed`, render report.html headless, and email
the PDF. Concierge-by-hand first, automate once volume justifies it.

## Notes / honest limits

- The free scan reads client-side resources on the public page. It cannot see
  server-side tagging, GTM container internals, or platform config without
  granted access. The deep findings flag candidates; your review confirms them.
- `scan.mjs` has a basic SSRF guard. Add rate limiting (e.g. by IP) before you
  promote it widely so it doesn't get abused as a free fetcher.
- Charge per audit, not subscription, until you have repeat demand.

## Validate before you polish

Run it against two real sites you know (a current client, a friend's store),
generate two real before/after PDFs, then send the link to three agency or
in-house people with: "ran this on a client site, found 4 things, want yours?"
One "what's it cost" = you have a business. Three shrugs = an afternoon spent,
not three months.
