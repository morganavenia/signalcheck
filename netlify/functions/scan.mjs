// netlify/functions/scan.mjs
// Server-side scanner. Fetches the target page itself (no public proxy,
// no rate limits, no leaking the URL to a third party) and returns
// structured findings as JSON.
//
// POST { url: "https://site.com" } -> { ok, score, grade, free:[], locked:[], meta:{} }

const SIGNATURES = [
  { key: "gtm",    label: "Google Tag Manager",          rx: /GTM-[A-Z0-9]{4,9}/g },
  { key: "ga4",    label: "GA4 (gtag)",                  rx: /G-[A-Z0-9]{8,12}/g },
  { key: "ua",     label: "Universal Analytics (dead)",  rx: /UA-\d{4,10}-\d{1,4}/g },
  { key: "gads",   label: "Google Ads conversion",       rx: /AW-\d{9,12}/g },
  { key: "meta",   label: "Meta Pixel base",             rx: /connect\.facebook\.net\/[^"']*\/fbevents/g },
  { key: "metaid", label: "Meta Pixel ID",               rx: /fbq\(['"]init['"],\s*['"](\d{15,16})['"]/g },
  { key: "tiktok", label: "TikTok Pixel",                rx: /analytics\.tiktok\.com|ttq\.load/g },
  { key: "dlayer", label: "dataLayer",                   rx: /dataLayer\s*=|dataLayer\.push/g },
  { key: "klaviyo",label: "Klaviyo",                     rx: /static\.klaviyo\.com|klaviyo\.js/gi },
  { key: "hotjar", label: "Hotjar",                      rx: /static\.hotjar\.com/gi },
  { key: "consent",label: "Consent banner",              rx: /onetrust|cookiebot|cookieconsent|usercentrics/gi },
];

const uniq = a => [...new Set(a)];

export default async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
  }

  try {

  let url;
  try {
    ({ url } = await req.json());
  } catch {
    return json({ ok: false, error: "bad body" }, 400);
  }
  if (!url) return json({ ok: false, error: "no url" }, 400);
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  // crude SSRF guard: block internal hosts
  try {
    const h = new URL(url).hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(h)) {
      return json({ ok: false, error: "blocked host" }, 400);
    }
  } catch {
    return json({ ok: false, error: "bad url" }, 400);
  }

  let html = "";
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SignalCheck/1.0; +https://signalcheck.app)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    html = await r.text();
  } catch (e) {
    return json({ ok: false, error: "fetch failed: " + (e.message || "unreachable") }, 502);
  }

  const found = {};
  for (const sig of SIGNATURES) {
    const m = html.match(sig.rx);
    if (m) found[sig.key] = { label: sig.label, hits: uniq(m).slice(0, 6) };
  }

  const ga4count = (html.match(/G-[A-Z0-9]{8,12}/g) || []).length;
  const metaInit = (html.match(/fbq\(['"]init['"]/g) || []).length;
  const gtmIds   = uniq(html.match(/GTM-[A-Z0-9]{4,9}/g) || []);

  const free = [];
  const locked = [];

  // ---- free teaser ----
  if (!found.gtm && !found.ga4)
    free.push(["crit", "No analytics detected", "No GTM container and no GA4 tag is loading client-side on this page. Tracking is either missing or server-side only, which means a hole in client-side attribution."]);
  if (found.ua)
    free.push(["crit", "Universal Analytics still firing", "UA stopped processing in July 2023. A live UA tag is dead weight and a strong signal nobody has audited this stack recently."]);
  if (found.gtm)
    free.push(["ok", "Tag Manager present", `GTM detected (${found.gtm.hits.join(", ")}). Whether it is configured correctly is the next question.`]);
  if (found.ga4)
    free.push(["ok", "GA4 detected", `GA4 is loading (${found.ga4.hits.join(", ")}).`]);
  if (found.meta && !found.metaid)
    free.push(["warn", "Meta base code present, ID not inline", "The Meta Pixel script loads but no init ID is visible in source. Often injected via GTM, but confirm it actually fires."]);
  if (!found.consent && (found.ga4 || found.meta))
    free.push(["warn", "No consent banner detected", "Trackers load but no recognized consent tool was found. Depending on jurisdiction and audience this is a compliance exposure."]);

  // ---- locked / deep ----
  if (ga4count > 1)
    locked.push(["crit", "GA4 loads more than once", `Found ${ga4count} GA4 references. Duplicate gtag loads double-count sessions and pageviews, silently inflating every downstream rate.`]);
  if (metaInit > 1)
    locked.push(["crit", `Meta Pixel initialized ${metaInit} times`, "Multiple fbq init calls fire events twice. CAPI dedup and reported ROAS are both wrong until resolved."]);
  if (gtmIds.length > 1)
    locked.push(["warn", "Multiple GTM containers", `Detected ${gtmIds.length} containers (${gtmIds.join(", ")}). Stacked containers commonly double-fire and fight over the dataLayer.`]);
  if (found.gads && !found.gtm)
    locked.push(["warn", "Hardcoded Google Ads conversion", `Conversion tag ${found.gads.hits.join(", ")} sits on the page directly. Hardcoded conversions are fragile and usually miss dynamic values.`]);
  if (found.dlayer)
    locked.push(["warn", "dataLayer present, schema unverified", "A dataLayer exists. Deep audit confirms whether ecommerce events push correct schema or empty objects."]);

  // structural checks that always apply
  locked.push(["crit", "Conversion-to-revenue binding unverified", "Tags fire, but external scanning cannot confirm purchase values bind to the right transaction. This is the most common cause of inflated ROAS and needs granted access to confirm."]);
  locked.push(["warn", "Cross-domain / iframe checkout coverage", "If checkout happens on a subdomain or embedded cart (common with hosted carts and Dutchie-style iframes), client-side events frequently break at the handoff. Deep audit traces the full path."]);

  const critN = [...free, ...locked].filter(f => f[0] === "crit").length;
  const warnN = [...free, ...locked].filter(f => f[0] === "warn").length;
  const okN   = free.filter(f => f[0] === "ok").length;

  let score = 100 - critN * 18 - warnN * 7;
  score = Math.max(12, Math.min(98, score));
  const grade = score >= 80 ? "Healthy-ish" : score >= 55 ? "Leaking" : "Bleeding";

  return json({
    ok: true,
    url,
    score, grade,
    counts: { critical: critN, warnings: warnN, passing: okN },
    free, locked,
    meta: { ga4count, metaInit, gtmIds, scannedAt: new Date().toISOString() },
  });

  } catch (err) {
    return json({ ok: false, error: "scanner error: " + (err.message || String(err)) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
