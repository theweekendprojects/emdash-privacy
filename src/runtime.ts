/**
 * Runtime behaviour: the `page:fragments` hook that injects the banner, the
 * public `save`/`services`/`assets` routes, and the daily retention purge.
 *
 * Security posture (public routes):
 *   - site id is derived SERVER-SIDE from the request host, never the payload
 *   - the save body is strictly validated (category whitelist, size caps)
 *   - a per-site per-minute KV counter is a soft flood cap; the hard cap is a
 *     Cloudflare rate-limiting rule on the route path (go-live checklist)
 *   - the visitor IP is never read or stored by this plugin
 */
import { z } from "zod";
import type { PageFragmentContribution } from "emdash";
import { adminRoute } from "./admin-page.js";
import { buildPolicyRule } from "./rule.js";
import { BANNER_JS, BANNER_CSS } from "./assets.generated.js";
import { BANNER_VERSION, SETTINGS_DEFAULTS } from "./shared.js";

const MAX_SAVES_PER_MIN = 30; // soft cap; hard cap is the CF rate-limit rule

// The banner bundle as a base64 ES-module data: URL, computed once. base64 has
// no `</`, so inlining `import("data:...")` never trips the HTML parser.
let _bannerDataUrl: string | undefined;
function bannerDataUrl(): string {
	if (_bannerDataUrl) return _bannerDataUrl;
	// btoa needs latin1; encode UTF-8 bytes first.
	const bytes = new TextEncoder().encode(BANNER_JS);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	_bannerDataUrl = `data:text/javascript;base64,${btoa(bin)}`;
	return _bannerDataUrl;
}

// ── settings ────────────────────────────────────────────────────────────────

interface ResolvedSettings {
	enabled: boolean;
	services: unknown[];
	colorScheme: "system" | "light" | "dark";
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

// NOTE: EmDash plugin routes always JSON-serialize their return value (a
// returned `Response` is wrapped, not sent raw), so the banner bundle cannot
// be served from a route. Instead the `page:fragments` hook injects it inline
// (trusted hooks emit raw markup). The Worker gzips the response, so the ~366
// KB bundle is ~103 KB on the wire, and only on pages where the banner shows.

export const consentRoutes = {
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
			// soft per-site flood cap (no IP). Ceiling: KV is eventually consistent
			// across colos; the hard cap is a Cloudflare rate-limit rule (go-live).
			const bucket = `rl:save:${siteId}:${Math.floor(Date.now() / 60000)}`;
			const n = ((await ctx.kv.get(bucket)) as number | null) ?? 0;
			if (n >= MAX_SAVES_PER_MIN) {
				// ponytail: verify how EmDash maps this to an HTTP status (thrown
				// Responses surfaced as 500 above); a non-2xx is all the client needs
				// to keep the save queued, so a plain Error is enough.
				throw new Error("rate_limited");
			}
			await ctx.kv.set(bucket, n + 1);

			await ctx.storage.consents.put(crypto.randomUUID(), {
				siteId, // host-attested, authoritative
				subjectId: ctx.input.subjectId, // c15t random client id, not person-derived
				ts: ctx.input.givenAt ?? Date.now(),
				action: ctx.input.action,
				grants,
				policyVersion: ctx.input.policyVersion,
				bannerVersion: ctx.input.bannerVersion,
			}); // NO ip, user-agent, email, name, country
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
			const months = (await readSetting<number>(ctx, "retentionMonths")) ?? SETTINGS_DEFAULTS.retentionMonths;
			const cutoff = Date.now() - months * 30 * 86_400_000;
			// delete in bounded batches so one cron run can't run unbounded
			for (let i = 0; i < 50; i++) {
				const res = await ctx.storage.consents.query({
					where: { ts: { lt: cutoff } },
					orderBy: { ts: "asc" },
					limit: 200,
				});
				if (!res.items.length) break;
				await ctx.storage.consents.deleteMany(res.items.map((it: any) => it.id));
				if (!res.hasMore) break;
			}
		},
	},

	"page:fragments": {
		handler: async (event: any, ctx: any) => {
			const s = await loadSettings(ctx);
			// no banner when disabled or when there is nothing to consent to
			if (!s.enabled || s.services.length === 0) return null;

			const locale = String(event.page?.locale ?? "").toLowerCase().startsWith("en") ? "en" : "de";
			const rule = buildPolicyRule({
				policyVersion: s.policyVersion,
				cookieMaxAgeMonths: s.cookieMaxAgeMonths,
			});
			const config = {
				locale,
				colorScheme: s.colorScheme,
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
					kind: "inline-script",
					placement: "head",
					code: `window.__emdashPrivacy=${JSON.stringify(config)};`,
					attributes: nonceAttr,
					key: "emdash-privacy-config",
				},
				{
					kind: "html",
					placement: "head",
					html: `<style data-emdash-privacy>${BANNER_CSS}</style>`,
					key: "emdash-privacy-css",
				},
				{
					// esbuild builds an ESM bundle. We cannot serve it from a plugin
					// route (EmDash JSON-wraps route returns), and inlining the raw
					// source is unsafe: the HTML parser closes an inline <script> at
					// the first literal `</` (c15t has one, inside a `/</gu` regex, so
					// a blanket `</`->`<\/` escape would corrupt that regex). Instead
					// load it as an ES module from a base64 data: URL — the bundle is
					// base64 so it contains no `</`, nothing for the parser to break on.
					kind: "inline-script",
					placement: "body:end",
					code: `import(${JSON.stringify(bannerDataUrl())})`,
					attributes: { type: "module", ...(nonceAttr ?? {}) },
					key: "emdash-privacy-js",
				},
			];
			return fragments;
		},
	},
};
