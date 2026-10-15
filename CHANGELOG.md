# Changelog

## Unreleased (0.0.0)

Initial scaffold.

- Trusted standard-format EmDash plugin: `privacyPlugin()` descriptor + `createPlugin()` runtime.
- c15t consent banner driven by a composed transport: c15t's offline (local) policy engine for a
  valid in-browser `policyResolution`, plus our own `save` that posts a PII-free proof to the
  plugin's `/save` route. No third-party consent backend, no CDN.
- Strict opt-in (deny-by-default) policy for every visitor (`src/rule.ts`), with a self-check.
- DE/EN strings, dark/light, Google Consent Mode (basic variant via gated scripts), GPC.
- Public routes: `save` (host-derived site id, strict validation, per-site KV flood cap, no IP),
  `services` (single source of truth), versioned immutable-cached `assets/banner.*`.
- Daily cron retention purge; `admin.settingsSchema` for per-site config.
- Consent proof stored in the site's own D1 (plugin storage), no PII.
