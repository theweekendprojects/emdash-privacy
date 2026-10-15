# emdash-privacy

Per-site cookie consent for [EmDash CMS](https://emdashcms.com), built to meet GDPR / TDDDG requirements.
A themed banner (German + English) that follows your site's design and light/dark mode, with Google
Consent Mode v2 and Global Privacy Control, powered by [c15t](https://c15t.com). The consent proof is
stored in your own Cloudflare D1. No third-party consent backend, no CDN, no paid service.

> **Not legal advice.** This plugin provides a configurable consent *mechanism*. It is built to meet
> GDPR/TDDDG requirements and does not guarantee compliance. Have your setup and your privacy policy
> reviewed by a lawyer. It does not generate an Impressum or a Datenschutzerklärung.

## What you get

- **Opt-in for every visitor.** Optional categories (Analytics, Marketing) are denied until the visitor
  chooses. No country detection: country is not the legal test, and an unknown or VPN country must fail safe.
- **Accept and Reject have equal weight** (same style, same size). A third "Settings" action opens the
  preference dialog. A floating button lets visitors change or withdraw consent later.
- **Gated scripts.** Your analytics/marketing scripts load only after the matching category is granted.
  Withdrawing consent reloads the page so the script is gone.
- **Google Consent Mode v2** (when a Google tag is configured): `default` is `denied` before any choice,
  `update` follows the real choice. The tag itself does not load before consent (the "basic" variant).
- **GPC** (`Sec-GPC` / `navigator.globalPrivacyControl`): optional categories stay denied and no banner
  is shown.
- **Looks like your site.** Colors, font and radius come from your own CSS variables (`--color-brand`,
  `--color-bg`, `--color-text`, `--color-border`, `--font-body`, ...) with neutral fallbacks, and light/dark
  follows your page live, including a theme toggle. Set an accent color in settings to override the brand color.
- **Non-blocking.** No dimmed overlay and no scroll lock, so your Impressum and Datenschutz pages stay
  readable before a choice is made. On phones the banner is a bottom sheet.
- **Consent proof without personal data.** One record per choice: a random id, the visitor's random c15t
  client id, timestamp, choice, per-category grants, policy and banner version, and the site. No IP,
  user agent, e-mail, name or country.
- **Resilient.** If saving fails, the choice still applies and c15t queues the save in the browser and
  retries on a later page load.

## Install

```bash
npm install emdash-privacy
```

```ts
// astro.config.mjs
import { privacyPlugin } from "emdash-privacy";

emdash({
  plugins: [privacyPlugin()],
});
```

It is a trusted, standard-format EmDash plugin (it needs the privileged `page:fragments` hook). Your
layout must render EmDash's page-contribution components (`<EmDashHead>`, `<EmDashBodyEnd>`), as the
EmDash templates do.

## Configure

Admin → Plugins → **Privacy**.

| Setting | Meaning |
| --- | --- |
| Enable consent banner | Master switch. Off = nothing is injected. |
| Tracked services (JSON) | Your analytics/marketing scripts. **The banner only appears when this list is non-empty.** |
| Banner language | Auto (follows the page locale; anything that is not English gets German), Deutsch, or English. |
| Color scheme | Follow the page (default), Light, or Dark. |
| Accent color | Optional CSS color; defaults to your `--color-brand`. |
| Privacy / Imprint / Cookie URLs | Linked from the banner. |
| Policy version | **Bump it to ask every visitor again**, for example after adding a service. |
| Re-ask after N months | Default 12. |
| Delete records older than N months | Default 36. Pick the period with legal advice. |

Services example:

```json
[
  {
    "id": "ga4",
    "name": "Google Analytics",
    "category": "analytics",
    "provider": "Google LLC",
    "purpose": "Reichweitenmessung",
    "src": "https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXX"
  }
]
```

`category` is `analytics` or `marketing`. Cookieless analytics that need no consent (for example Cloudflare
Web Analytics) should simply not be listed; with no services there is no banner. Please confirm that
assumption for your own setup with a lawyer.

A public, read-only `GET /_emdash/api/plugins/emdash-privacy/services` returns the services list, so a
privacy-policy page or generator can read the same source of truth as the banner.

## Privacy: what to disclose

Your Datenschutzerklärung must list what this mechanism stores. It is generally treated as necessary for
the consent mechanism itself; have a lawyer confirm.

- a first-party `c15t` cookie and localStorage entries (the consent state, and a queue of unsent saves),
- the consent proof record described above, with its retention period (default 36 months).

## Operating notes

- **Rate limiting.** `/save` is public and does no rate limiting in code (that only slowed every real
  save). **Add a Cloudflare rate-limiting rule** for `/_emdash/api/plugins/emdash-privacy/save`.
- **Retention.** Expired records are purged from inside `/save`, at most once a day per site. The plugin
  also schedules a daily cron task, but in testing the host did not reliably run plugin cron hooks, so do
  not depend on it.
- **Content Security Policy.** The banner bundle is loaded with `fetch` and imported from a `blob:` URL.
  A strict CSP needs `script-src blob:` (and `'unsafe-inline'` or a nonce for the tiny inline loader).
- **Weight.** About 1 KB of inline script is added to each page. The ~380 KB bundle (≈107 KB over the
  wire) is named by its content hash and marked `immutable`; a `<link rel=preload>` starts the fetch
  early, and after the first visit the browser serves it from its own cache with no network. Note:
  Cloudflare's edge does not cache the `/_emdash/api/` path, so the first visit per browser runs the
  Worker to fetch it.
- **Multi-tenant.** The site key comes from the server-side site URL, never from the request body, and a
  body containing a `siteId` is rejected. The admin record counter is per site. Records live in EmDash
  plugin storage, so they follow whatever isolation your platform gives plugin storage.

## Development

```bash
npm install
npm run selfcheck      # policy rule resolved by c15t's real engine, retention, language, scheduling
npm run build:client   # bundles the banner into src/assets.generated.ts (also runs on npm pack)
npx tsc --noEmit
```

## License

MIT © The Weekend Projects
