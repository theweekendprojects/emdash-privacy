/**
 * emdash-privacy — per-site GDPR/TDDDG cookie consent for EmDash CMS.
 *
 * A trusted, standard-format EmDash plugin (shipped as an npm package, using
 * only the standard plugin APIs). It injects a c15t-powered consent banner on
 * public pages, gates analytics/marketing scripts until the visitor consents,
 * and records a PII-free consent proof in the site's own D1 (EmDash plugin
 * storage). No third-party consent backend, no CDN.
 *
 * This plugin provides a configurable consent MECHANISM. It is not legal
 * advice and does not guarantee compliance. All copy says "built to meet
 * GDPR/TDDDG requirements, legal review recommended".
 *
 * @example
 * ```ts
 * // astro.config.mjs (or live.config.ts)
 * import { privacyPlugin } from "emdash-privacy";
 *
 * emdash({ plugins: [privacyPlugin()] });
 * ```
 */
import type { PluginDescriptor } from "emdash";
import { definePlugin } from "emdash";
import { version } from "../package.json" with { type: "json" };
import { PLUGIN_ID, SETTINGS_SCHEMA, STORAGE_CONFIG } from "./shared.js";
import { consentRoutes, privacyHooks } from "./runtime.js";

export { PLUGIN_ID, BANNER_VERSION, CATEGORIES } from "./shared.js";
export { buildPolicyRule } from "./rule.js";

/**
 * The published npm package name. EmDash resolves the descriptor `entrypoint`
 * as a module specifier at the consuming site's build time (Astro → Vite), so
 * it MUST equal this package's real name. Rename in ONE place (here +
 * package.json "name") if the package is ever forked.
 */
export const PACKAGE_NAME = "emdash-privacy";

/**
 * Build-time descriptor, registered in the site's `plugins: []`. `format:
 * "standard"` tells EmDash to load this package's DEFAULT export (the
 * `definePlugin({...})` result below) and run it in-process. The descriptor
 * carries the metadata EmDash reads before loading the runtime: storage
 * indexes and the settings schema.
 */
export function privacyPlugin(): PluginDescriptor {
	return {
		id: PLUGIN_ID,
		version,
		entrypoint: PACKAGE_NAME,
		format: "standard",
		// Descriptor storage uses flat indexes; the composite index lives in the runtime.
		storage: { consents: { indexes: ["siteId", "ts", "subjectId"] } },
		settingsSchema: SETTINGS_SCHEMA,
	};
}

/**
 * Runtime plugin (hooks + routes + storage). Loaded by EmDash via the
 * descriptor's `entrypoint` as this package's default export.
 */
export default definePlugin({
	id: PLUGIN_ID,
	version,
	storage: STORAGE_CONFIG,
	hooks: privacyHooks,
	routes: consentRoutes,
	admin: { settingsSchema: SETTINGS_SCHEMA },
});
