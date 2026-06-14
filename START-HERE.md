# DEPLOY THIS — read first

Manual drag-and-drop into Netlify does NOT bundle the functions, which is why
/scan returns nothing. Use the CLI instead. Five minutes.

## CLI deploy (do this)

From inside this folder, in Terminal:

```
npm install
npx netlify-cli deploy --prod
```

- First run asks you to authorize in the browser, then to link a site.
- Choose "Link this directory to an existing site" and pick your
  sparkling-sherbet site, OR let it create a new one.
- It reads netlify.toml, installs deps, bundles netlify/functions, wires the
  /scan and /checkout redirects, and prints the live URL.

## Confirm it worked

Visit  https://YOUR-SITE.netlify.app/scan  directly in the browser.
You should see:  {"error":"POST only"}
That means the function is live. Now the scanner on the homepage will work.

In the Netlify dashboard > Functions tab you should see: scan, checkout.
If it says "No functions deployed," the deploy didn't pick them up — message me.

## Turn on payments (after the scan works)

Stripe: make two one-time prices, $79 and $149, copy the price_ ids.
Netlify > Site settings > Environment variables:

```
STRIPE_SECRET_KEY = sk_live_xxx   (sk_test_xxx to test first)
PRICE_STANDARD    = price_xxx
PRICE_AGENCY      = price_xxx
SITE_URL          = https://YOUR-SITE.netlify.app
```

Redeploy (npx netlify-cli deploy --prod) so the env vars load.

## Agency PDF delivery

Run a scan, copy LAST_RESULT from the browser console, open report.html, paste
into the toolbar, Load data, Save as PDF. Add an "agency" block to the JSON for
white-label (name, accent, prepared_for, analyst). Full details in README.md.
