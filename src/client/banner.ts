/**
 * Browser entry, bundled at build time into `dist/banner.<ver>.js` and served
 * by the plugin's own public asset route (no CDN). This is the only ~file of
 * real client code: it composes c15t's local (offline) policy engine with our
 * own `save` that posts a PII-free proof to the plugin's `/save` route.
 *
 * Why compose offline + custom save, instead of a server `init`:
 *   c15t's init fold requires a `policyResolution` in the init response; a
 *   hand-written `init` returning only geo would make resolution fail and the
 *   banner would never show. The offline transport synthesizes a valid
 *   policyResolution locally from our policy rule — strict opt-in, no network,
 *   nothing visitor-specific that could leak through cached HTML.
 *
 * Config is inlined by the `page:fragments` hook as `window.__emdashPrivacy`.
 */
import { init, offline } from "@c15t/browser";
import type { SavePayload, SaveResult } from "@c15t/core";
import "@c15t/browser/styles.css"; // esbuild emits this as dist/banner.css
import { strings } from "../strings.js";

interface PrivacyConfig {
	locale: "de" | "en";
	colorScheme: "system" | "light" | "dark";
	accentColor?: string;
	rule: unknown; // PolicyRuleOut from rule.ts, serialized server-side
	scripts: unknown[]; // c15t Script[] built from the services list
	legalLinks?: { privacy?: string; cookies?: string; terms?: string };
	policyVersion: string;
	bannerVersion: string;
	nonce?: string;
}

const cfg = (window as unknown as { __emdashPrivacy?: PrivacyConfig }).__emdashPrivacy;

/**
 * "system" means "match the PAGE". Sites theme via a CSS `color-scheme` on
 * <html> (the landing page does), a `dark` class, or the OS preference. c15t's
 * own "system" only reads the OS, so it showed a white banner on a dark page
 * (seen live). Order: page color-scheme, then `dark`/`c15t-dark` class, then OS.
 * ponytail: resolved once at load; a live theme toggle needs a MutationObserver.
 */
function resolveScheme(setting: PrivacyConfig["colorScheme"]): "light" | "dark" {
	if (setting === "light" || setting === "dark") return setting;
	const root = document.documentElement;
	const declared = getComputedStyle(root).colorScheme || "";
	if (/\bdark\b/.test(declared) && !/\blight\b/.test(declared)) return "dark";
	if (/\blight\b/.test(declared) && !/\bdark\b/.test(declared)) return "light";
	if (root.classList.contains("dark") || root.classList.contains("c15t-dark")) return "dark";
	return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function routeBase(): string {
	return "/_emdash/api/plugins/emdash-privacy";
}

/**
 * Our save handler. Posts the choice to the plugin route; on any non-2xx we
 * return `ok:false` so c15t keeps the choice locally and replays from its
 * outbox on a later load. We never send a site id — the server derives it
 * from the request host.
 */
async function save(payload: SavePayload): Promise<SaveResult> {
	try {
		const res = await fetch(`${routeBase()}/save`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				subjectId: payload.subjectId,
				action: payload.consentAction, // 'all' | 'necessary' | 'custom'
				grants: payload.consents,
				givenAt: payload.givenAt ?? Date.now(),
				policyVersion: cfg?.policyVersion ?? "1",
				bannerVersion: cfg?.bannerVersion ?? "1",
			}),
			keepalive: true, // survive a page unload right after the click
		});
		if (!res.ok) return { ok: false };
		return { ok: true, subjectId: payload.subjectId };
	} catch {
		return { ok: false }; // queued + replayed by the kernel outbox
	}
}

function start(config: PrivacyConfig): void {
	// Compose: offline transport (local policyResolution) + our save.
	// `kind: "custom"` tells c15t this transport is already resolved and ships
	// in the bundle (no backend fetch).
	const offlineFactory = offline({ policyRules: [config.rule as never] });
	const mode = Object.assign(
		(ctx: Parameters<typeof offlineFactory>[0]) => ({
			...offlineFactory(ctx),
			save,
		}),
		{ kind: "custom" as const },
	);

	const client = init({
		mode,
		nonce: config.nonce,
		ui: {
			colorScheme: resolveScheme(config.colorScheme),
			// Non-modal: no dim overlay, no scroll lock, so Impressum/Datenschutz
			// stay readable before a choice is made (FR1).
			banner: { hideBranding: true, scrollLock: false },
			dialog: { hideBranding: true },
			// Floating reopen button = the "Cookie-Einstellungen" control (FR7).
			trigger: { position: "bottom-left", showWhen: "after-consent" },
		},
		// Follow the PAGE locale (set server-side), never the browser language.
		i18n: { locale: config.locale, messages: strings as never, detectBrowserLanguage: false },
		// our two optional categories map to c15t measurement + marketing
		consentCategories: ["necessary", "measurement", "marketing"],
		scripts: config.scripts as never,
		legalLinks: config.legalLinks as never,
		reloadOnConsentRevoked: true,
	});
	// init() already mounts the UI with the `ui` options above. A second
	// mountConsentUI(client) call mounts a duplicate default UI (white, branded)
	// on top of it - seen live.
	// footer "Cookie-Einstellungen" control reopens preferences
	(window as unknown as { emdashPrivacy?: unknown }).emdashPrivacy = client;
}

if (cfg) {
	start(cfg);
} else if (typeof console !== "undefined") {
	console.warn("[emdash-privacy] no window.__emdashPrivacy config; banner not started");
}
