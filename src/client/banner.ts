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
 * "system" means "match the PAGE", live. Sites theme via a CSS `color-scheme`
 * on <html> (the landing page does), a `dark` class, or the OS preference.
 * c15t's own "system" only reads the OS, so it showed a white banner on a dark
 * page (seen live). Order: page color-scheme, then a `dark` class, then the OS.
 * We deliberately ignore our own `c15t-dark` class here (we write it).
 */
function resolveScheme(): "light" | "dark" {
	const root = document.documentElement;
	const declared = getComputedStyle(root).colorScheme || "";
	if (/\bdark\b/.test(declared) && !/\blight\b/.test(declared)) return "dark";
	if (/\blight\b/.test(declared) && !/\bdark\b/.test(declared)) return "light";
	if (root.classList.contains("dark")) return "dark";
	return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Live light/dark sync. With `colorScheme: null` c15t follows the `c15t-dark`
 * class on <html> as it changes, so we only have to keep that class correct:
 * re-check when the page toggles its theme (class / style / data-theme on
 * <html> or <body>) or the OS preference changes. One rAF-debounced observer.
 */
function followPageScheme(): void {
	const root = document.documentElement;
	let queued = false;
	const apply = () => {
		queued = false;
		const dark = resolveScheme() === "dark";
		if (root.classList.contains("c15t-dark") !== dark) root.classList.toggle("c15t-dark", dark);
	};
	const schedule = () => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(apply);
	};
	apply();
	const opts = { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-mode", "data-color-scheme"] };
	new MutationObserver(schedule).observe(root, opts);
	if (document.body) new MutationObserver(schedule).observe(document.body, opts);
	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", schedule);
}

/**
 * Look: map c15t's theme tokens onto the host site's own CSS variables
 * (`--color-brand`, `--color-bg`, `--color-text`, ...), with neutral fallbacks,
 * so the banner follows whatever theme pack / design system the site uses and
 * its light/dark. The operator's `accentColor` setting wins over `--color-brand`.
 * Accept and Reject get the SAME treatment (equal prominence, no dark pattern).
 */
function buildTheme(accentColor?: string) {
	const accent = accentColor || "var(--color-brand, #2563eb)";
	const colors = {
		primary: accent,
		primaryHover: `color-mix(in srgb, ${accent} 86%, black)`,
		surface: "var(--color-bg, #ffffff)",
		surfaceHover: "color-mix(in srgb, var(--color-bg, #ffffff) 94%, gray)",
		border: "var(--color-border, rgba(128,128,128,0.28))",
		borderHover: "color-mix(in srgb, var(--color-border, rgba(128,128,128,0.28)) 60%, currentColor)",
		text: "var(--color-text, #111827)",
		textMuted: "var(--color-text-secondary, #6b7280)",
		textOnPrimary: "var(--color-on-brand, #ffffff)",
	};
	return {
		colors,
		dark: colors, // the page variables already switch with the page's scheme
		typography: { fontFamily: "var(--font-body, system-ui, sans-serif)" },
		radius: { sm: "8px", md: "12px", lg: "16px" },
		shadows: { lg: "0 12px 40px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.16)" },
		consentActions: {
			primary: { variant: "primary", mode: "filled" },
			accept: { variant: "primary", mode: "filled" },
			reject: { variant: "primary", mode: "filled" }, // same as accept on purpose
			customize: { variant: "neutral", mode: "ghost" },
		},
	};
}

/** Extra CSS inside the banner's shadow root: card geometry + mobile bottom sheet. */
const SHADOW_CSS = `
[data-testid="consent-banner-root"]{left:16px;right:auto;bottom:16px;max-width:min(440px,calc(100vw - 32px))}
[data-testid="consent-banner-card"]{border:1px solid var(--c15t-border);backdrop-filter:saturate(1.2)}
[data-testid="consent-banner-title"]{font-weight:650;letter-spacing:-0.01em}
@media (max-width:640px){
  [data-testid="consent-banner-root"]{left:0;right:0;bottom:0;max-width:none}
  [data-testid="consent-banner-card"]{border-radius:16px 16px 0 0;border-width:1px 0 0 0;width:100%}
  [data-testid="consent-banner-footer"]{flex-wrap:wrap}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

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

/**
 * Google Consent Mode v2 bridge. Only active when a configured service is a
 * Google tag. Order matters: `default` (all denied) is queued BEFORE the tag can
 * load, then `update` follows the real permissions on ready + every change.
 * The tag itself stays gated (BASIC mode): it does not load before consent, so
 * no ping leaves the browser. Mapping: analytics_storage <- measurement;
 * ad_storage / ad_user_data / ad_personalization <- marketing.
 */
const GOOGLE_SRC = /googletagmanager\.com|google-analytics\.com|googleadservices\.com|doubleclick\.net/;
function consentModeBridge(
	client: { on: (e: "ready" | "consent", l: (s: any) => void) => unknown; getSnapshot: () => any },
	scripts: unknown[],
): void {
	if (!scripts.some((x) => GOOGLE_SRC.test(String((x as { src?: string }).src ?? "")))) return;
	const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };
	w.dataLayer = w.dataLayer || [];
	// gtag must push the `arguments` object (not an array); Google's tag reads it that way
	w.gtag =
		w.gtag ||
		function () {
			// eslint-disable-next-line prefer-rest-params
			(w.dataLayer as unknown[]).push(arguments);
		};
	const g = w.gtag!;
	g("consent", "default", {
		ad_storage: "denied",
		ad_user_data: "denied",
		ad_personalization: "denied",
		analytics_storage: "denied",
		wait_for_update: 500,
	});
	const push = (snap: any) => {
		const p = snap?.effectivePermissions ?? {};
		const a = p.measurement ? "granted" : "denied";
		const m = p.marketing ? "granted" : "denied";
		g("consent", "update", { analytics_storage: a, ad_storage: m, ad_user_data: m, ad_personalization: m });
	};
	push(client.getSnapshot());
	client.on("ready", push);
	client.on("consent", push);
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

	// set the scheme class BEFORE c15t mounts, so there is no wrong-scheme flash
	if (config.colorScheme === "system") followPageScheme();

	const client = init({
		mode,
		nonce: config.nonce,
		ui: {
			// null = follow the <html> `c15t-dark` class live (kept in sync by
			// followPageScheme). An explicit operator choice is fixed.
			colorScheme: config.colorScheme === "system" ? null : config.colorScheme,
			theme: buildTheme(config.accentColor) as never,
			css: SHADOW_CSS,
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
		// Accept and Reject are BOTH primary: equal prominence, no dark pattern.
		// Settings is the quiet third action. Non-blocking floating card.
		presentation: {
			prompt: {
				variant: "floating",
				position: "bottom-left",
				primaryActions: ["accept", "reject"],
				layout: [["reject", "accept"], ["customize"]],
				blocking: false,
			},
		},
	});
	// init() already mounts the UI with the `ui` options above. A second
	// mountConsentUI(client) call mounts a duplicate default UI (white, branded)
	// on top of it - seen live.
	// footer "Cookie-Einstellungen" control reopens preferences
	consentModeBridge(client as never, config.scripts);
	(window as unknown as { emdashPrivacy?: unknown }).emdashPrivacy = client;
}

if (cfg) {
	start(cfg);
} else if (typeof console !== "undefined") {
	console.warn("[emdash-privacy] no window.__emdashPrivacy config; banner not started");
}
