/**
 * Runtime behaviour: the `page:fragments` hook that injects the banner, the
 * public `save`/`services`/`assets` routes, and the daily retention purge.
 *
 * Security posture (public routes):
 *   - site id is derived SERVER-SIDE from the configured site URL, never the payload
 *   - the save body is strictly validated (strict schema; a client `siteId` is rejected)
 *   - abuse control is a Cloudflare rate-limiting rule on the route path (go-live
 *     checklist); we do not rate-limit in code
 *   - the visitor IP is never read or stored by this plugin
 */
import { z } from "zod";
import type { PageFragmentContribution } from "emdash";
import { adminRoute } from "./admin-page.js";
import { purgeDue, purgeExpired } from "./purge.js";
import { buildPolicyRule } from "./rule.js";
import { BANNER_HASH, BANNER_JS } from "./assets.generated.js";
import { BANNER_VERSION, PLUGIN_ID, SETTINGS_DEFAULTS, resolveLanguage } from "./shared.js";

/** Route that serves the bundle. The hash is in the name, so it is immutable. */
const BUNDLE_ROUTE = `assets/banner-${BANNER_HASH}`;
const BUNDLE_URL = `/_emdash/api/plugins/${PLUGIN_ID}/${BUNDLE_ROUTE}`;

/**
 * Tiny inline loader. The ~370 KB bundle is NOT inlined per page. It is cached
 * in `localStorage` under a hash-keyed name, so after a visitor has it once we
 * `import()` straight from localStorage with no network at all (not even the
 * Worker fetch the `/_emdash/api/` edge-bypass would otherwise force on the
 * first page of each session). On a miss we fetch once (EmDash JSON-wraps the
 * route, so unwrap `.data`), import, then store for next time. The hash in the
 * key auto-busts on a new bundle; a quota/parse failure just falls back to
 * fetch, so cache trouble can never break the banner.
 */
function makeLoader(url: string, hash: string): string {
	const KEY = `emdash-privacy-js:${hash}`;
	// This source string runs in the browser; keep it dependency-free and small.
	const fn = `(function(){
	var K=${JSON.stringify(KEY)},U=${JSON.stringify(url)};
	function run(src){return import(URL.createObjectURL(new Blob([src],{type:"text/javascript"})))}
	var hit;try{hit=localStorage.getItem(K)}catch(e){}
	if(hit)return run(hit).catch(function(e){console.warn("[emdash-privacy] banner failed",e)});
	return fetch(U,{credentials:"omit"}).then(function(r){return r.json()}).then(function(j){
		try{localStorage.setItem(K,j.data)}catch(e){}
		return run(j.data);
	}).catch(function(e){console.warn("[emdash-privacy] banner failed to load",e)});
})();`;
	return fn.replace(/\n\t*/g, "");
}
const LOADER = makeLoader(BUNDLE_URL, BANNER_HASH);

// ── settings ────────────────────────────────────────────────────────────────

interface ResolvedSettings {
	enabled: boolean;
	services: unknown[];
	colorScheme: "system" | "light" | "dark";
	language: string;
	requireChoice: boolean;
	accentColor?: string;
	privacyUrl?: string;
	imprintUrl?: string;
	cookieUrl?: string;
	policyVersion: string;
	cookieMaxAgeMonths: number;
	retentionMonths: number;
}

async function readSetting<T>(ctx: any, key: string): Promise<T | undefined> {
	// Prefer the newer SettingsAccess; fall back to the KV convention.
	if (ctx.settings?.get) return (await ctx.settings.get(key)) ?? undefined;
	return (await ctx.kv.get(`settings:${key}`)) ?? undefined;
}

async function loadSettings(ctx: any): Promise<ResolvedSettings> {
	const d = SETTINGS_DEFAULTS;
	let services: unknown[] = [];
	const rawServices = (await readSetting<string>(ctx, "services")) ?? d.services;
	try {
		const parsed = typeof rawServices === "string" ? JSON.parse(rawServices) : rawServices;
		if (Array.isArray(parsed)) services = parsed;
	} catch {
		services = []; // bad JSON -> no services -> no banner, logged below
		ctx.log?.warn?.("[emdash-privacy] services setting is not valid JSON; treating as empty");
	}
	return {
		enabled: (await readSetting<boolean>(ctx, "enabled")) ?? d.enabled,
		services,
		colorScheme: (await readSetting<ResolvedSettings["colorScheme"]>(ctx, "colorScheme")) ?? d.colorScheme,
		language: (await readSetting<string>(ctx, "language")) ?? d.language,
		requireChoice: (await readSetting<boolean>(ctx, "requireChoice")) ?? d.requireChoice,
		accentColor: await readSetting<string>(ctx, "accentColor"),
		privacyUrl: await readSetting<string>(ctx, "privacyUrl"),
		imprintUrl: await readSetting<string>(ctx, "imprintUrl"),
		cookieUrl: await readSetting<string>(ctx, "cookieUrl"),
		policyVersion: (await readSetting<string>(ctx, "policyVersion")) ?? d.policyVersion,
		cookieMaxAgeMonths: (await readSetting<number>(ctx, "cookieMaxAgeMonths")) ?? d.cookieMaxAgeMonths,
		retentionMonths: (await readSetting<number>(ctx, "retentionMonths")) ?? d.retentionMonths,
	};
}

/** c15t Script[] built from the operator's services list. "analytics" => measurement. */
function buildScripts(services: any[]): unknown[] {
	return services
		.filter((s) => s && typeof s.src === "string")
		.map((s) => ({
			id: String(s.id ?? s.name ?? s.src),
			src: String(s.src),
			category: s.category === "analytics" ? "measurement" : "marketing",
		}));
}

// ── host-derived site id (never trust the payload) ────────────────────────────

function siteIdFromCtx(ctx: any): string {
	// Prefer the host-attested site URL; fall back to the request host.
	const raw = ctx.site?.url ?? ctx.request?.url;
	try {
		return new URL(raw).hostname;
	} catch {
		return "unknown";
	}
}

// ── routes ────────────────────────────────────────────────────────────────────

const saveSchema = z
	.object({
		subjectId: z.string().max(64),
		action: z.enum(["all", "necessary", "custom"]),
		grants: z.record(z.string(), z.boolean()), // keys validated below (c15t category set)
		givenAt: z.number().optional(),
		policyVersion: z.string().max(32),
		bannerVersion: z.string().max(32),
	})
	.strict(); // reject unknown keys, including a spoofed siteId

const ALLOWED_GRANT_KEYS = new Set(["necessary", "measurement", "marketing"]);

// Delivery: EmDash JSON-wraps route return values, so the bundle route returns
// the source as a string and the loader unwraps `.data`. The response is
// `immutable`, so after the first visit the browser serves it from its own
// cache with no network (verified). Cloudflare's edge does NOT cache the
// `/_emdash/api/` path, so the FIRST visit per browser still runs the Worker;
// the head `preload` starts that fetch early.

export const consentRoutes = {
	// the banner bundle: public, GET, immutable-cached (name carries the content hash)
	[BUNDLE_ROUTE]: {
		public: true,
		cacheControl: "public, max-age=31536000, immutable",
		handler: async () => BANNER_JS,
	},

	// Block Kit settings page behind the sidebar link (admin-session gated)
	admin: adminRoute,

	// single source of truth for the banner AND the (future) Datenschutz text
	services: {
		public: true,
		handler: async (ctx: any) => (await loadSettings(ctx)).services,
	},

	save: {
		public: true,
		input: saveSchema,
		handler: async (ctx: any) => {
			// c15t reports all five of its categories; we offer three. Keep only the
			// known keys (never widen the stored row) instead of rejecting - a
			// reject would drop a legitimate consent proof. Unknown keys are ignored.
			const grants: Record<string, boolean> = {};
			for (const k of ALLOWED_GRANT_KEYS) grants[k] = ctx.input.grants[k] === true;
			grants.necessary = true; // always on
			const siteId = siteIdFromCtx(ctx);
			// Abuse control for this PUBLIC route is a Cloudflare rate-limiting rule on
			// `/_emdash/api/plugins/emdash-privacy/save` (go-live checklist, documented
			// in the README). We do NOT rate-limit in code: it added a kv read+write to
			// every legitimate save, and a soft kv counter is not a real limit anyway.
			await ctx.storage.consents.put(crypto.randomUUID(), {
				siteId, // host-attested, authoritative
				subjectId: ctx.input.subjectId, // c15t random client id, not person-derived
				ts: ctx.input.givenAt ?? Date.now(),
				action: ctx.input.action,
				grants,
				policyVersion: ctx.input.policyVersion,
				bannerVersion: ctx.input.bannerVersion,
			}); // NO ip, user-agent, email, name, country
			// Lazy retention: the daily cron hook proved unreliable (the host swallows
			// hook errors), so also purge from here - at most once a day, one bounded
			// batch - using only code paths this route already relies on. Never let a
			// purge problem fail a consent save.
			try {
				if (purgeDue(await ctx.kv.get("state:lastPurge"), Date.now())) {
					await ctx.kv.set("state:lastPurge", { at: Date.now(), via: "save" });
					await purgeExpired(ctx, 1);
				}
			} catch (err) {
				ctx.log?.error?.(`[emdash-privacy] lazy purge failed: ${err instanceof Error ? err.message : String(err)}`);
			}
			return { ok: true };
		},
	},
};

// ── hooks ──────────────────────────────────────────────────────────────────────

export const privacyHooks = {
	"plugin:activate": {
		handler: async (_event: any, ctx: any) => {
			if (ctx.cron?.schedule) {
				await ctx.cron.schedule("retention-purge", { schedule: "0 3 * * *" });
			}
		},
	},

	cron: {
		handler: async (event: any, ctx: any) => {
			if (event.name !== "retention-purge") return;
			// Purge FIRST. Bookkeeping must never block the purge: observed live,
			// `ctx.kv.set` can fail inside the cron context, and an exception before the
			// delete silently skipped it. The host swallows hook errors, so record the
			// outcome best-effort only. (The lazy purge in /save is the backstop.)
			let outcome: Record<string, unknown>;
			try {
				outcome = { at: Date.now(), via: "cron", deleted: await purgeExpired(ctx) };
			} catch (err) {
				outcome = { at: Date.now(), via: "cron", error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
			}
			try {
				await ctx.kv.set("state:lastPurge", outcome);
			} catch {
				/* best-effort */
			}
		},
	},

	"page:fragments": {
		handler: async (event: any, ctx: any) => {
			const s = await loadSettings(ctx);
			// no banner when disabled or when there is nothing to consent to
			if (!s.enabled || s.services.length === 0) return null;

			const locale = resolveLanguage(s.language, event.page?.locale);
			const rule = buildPolicyRule({
				policyVersion: s.policyVersion,
				cookieMaxAgeMonths: s.cookieMaxAgeMonths,
			});
			const config = {
				locale,
				colorScheme: s.colorScheme,
				requireChoice: s.requireChoice,
				accentColor: s.accentColor,
				rule,
				scripts: buildScripts(s.services as any[]),
				legalLinks: { privacy: s.privacyUrl, cookies: s.cookieUrl, terms: s.imprintUrl },
				policyVersion: s.policyVersion,
				bannerVersion: BANNER_VERSION,
				nonce: event.page?.cspNonce, // threaded if the host exposes one (verify)
			};

			const nonceAttr = config.nonce ? { nonce: config.nonce } : undefined;
			const fragments: PageFragmentContribution[] = [
				{
					// Config + loader in head. The loader imports the bundle from
					// localStorage when present (no network at all), so there is NO
					// preload link: a preload would fetch the bundle on every page even
					// when it is already cached, which is exactly the waste we removed.
					kind: "inline-script",
					placement: "head",
					code: `window.__emdashPrivacy=${JSON.stringify(config)};`,
					attributes: nonceAttr,
					key: "emdash-privacy-config",
				},
				{
					// Tiny loader; the bundle itself comes from the immutable-cached route.
					// Not inlined: the HTML parser closes an inline <script> at the first
					// literal `</` (c15t has one inside a `/</gu` regex), and inlining would
					// also re-send ~370 KB with every page view.
					kind: "inline-script",
					placement: "body:end",
					code: LOADER,
					attributes: nonceAttr,
					key: "emdash-privacy-js",
				},
			];
			return fragments;
		},
	},
};
