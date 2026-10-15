# emdash-privacy

Per-site GDPR/TDDDG cookie consent for [EmDash CMS](https://emdashcms.com). A themed, dark/light
consent banner (German + English) with Google Consent Mode v2 and GPC support, powered by
[c15t](https://c15t.com), storing a PII-free consent proof in your own Cloudflare D1 — no
third-party consent backend, no CDN.

> **Not legal advice.** This plugin provides a configurable consent *mechanism*. It is built to meet
> GDPR/TDDDG requirements; it does not guarantee compliance. Have the result reviewed by a lawyer.

## Status

Early scaffold (`0.0.0`). The banner, routes, policy logic and settings are in place; live
verification on a real EmDash site is in progress. Not yet published to npm.

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

Then open the admin, go to the plugin's settings, and:

1. Set **Enable consent banner** on.
2. Add your tracked services as JSON (the banner only shows when this is non-empty):

   ```json
   [
     { "id": "ga4", "name": "Google Analytics", "category": "analytics",
       "provider": "Google", "purpose": "Reichweitenmessung",
       "src": "https://www.googletagmanager.com/gtag/js?id=G-XXXX" }
   ]
   ```

3. Set your Privacy / Imprint / Cookie URLs and (optionally) the color scheme and accent.

## How it works

- A trusted, standard-format EmDash plugin. The `page:fragments` hook injects a small config script
  plus the bundled banner asset on public pages.
- The banner runs c15t with a **composed transport**: c15t's offline policy engine resolves a strict
  opt-in policy **in the browser** (no geo lookup, no backend call), and our own `save` handler posts
  the visitor's choice to the plugin's `/save` route.
- The choice is stored by c15t (first-party cookie + localStorage) and a PII-free proof row is written
  to the site's own D1 via plugin storage. No IP, user-agent, email or name is stored.
- Analytics/marketing scripts load only after the matching category is granted (Consent Mode basic).

## Privacy

The following must be disclosed in your Datenschutzerklärung (the plugin stores them as part of the
consent mechanism):

- a first-party consent cookie and localStorage entries (consent state + a replay queue),
- a consent proof record: a random id, a random client id, the choice, policy/banner versions and a
  timestamp — **no** IP, user-agent, email or name,
- the retention period (configurable; default 36 months), after which records are purged daily.

## Development

```bash
npm install
npm run selfcheck     # dependency-free check of the policy logic
npm run build:client  # bundle the browser banner into dist/
```

## License

MIT © The Weekend Projects
