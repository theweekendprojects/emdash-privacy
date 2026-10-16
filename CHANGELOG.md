# Changelog

## 0.1.0

First usable release. Verified end to end on a live EmDash site (Cloudflare Workers + D1).

- Consent banner (German + English) driven by c15t: strict opt-in for every visitor, Accept and Reject with
  equal weight, preference dialog, floating reopen button, non-blocking card (bottom sheet on phones).
- Follows the host site: colors, font and radius from the site's CSS variables, light/dark from the page
  and updated live when the theme is toggled.
- Gated scripts, Google Consent Mode v2 (basic variant: `default` denied, then `update`), GPC.
- Consent proof in plugin storage (D1) with no personal data; failed saves are queued by c15t and retried.
- Admin: "Privacy" sidebar page (Block Kit) and a settings form, including banner language, policy version
  (bump = re-ask), re-ask period and retention.
- Public `/save` is strictly validated and rejects a client-supplied `siteId`. No in-code rate limiting
  (it slowed every save); use a Cloudflare rate-limiting rule instead.
- Retention purge runs lazily from `/save` (the host did not reliably run the daily cron hook).
- The ~380 KB bundle is served from an immutable, content-hashed route and cached in `localStorage`; after
  the first fetch per browser, later page views import it from `localStorage` with zero network. Pages
  carry only a ~1 KB loader.
- Self-check resolves the policy rule through c15t's real engine for several countries, so a rule the
  runtime would reject fails in CI instead of silently hiding the banner.

Known limits: cron hook unreliable on the tested host; strict CSP needs `script-src blob:`; tenant
isolation depends on the platform's plugin-storage isolation and was not exercised on a multi-site host.
