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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PageFragmentContribution } from "emdash";
import { buildPolicyRule } from "./rule.js";
import { BANNER_VERSION, PLUGIN_ID, SETTINGS_DEFAULTS } from "./shared.js";

const ROUTE_BASE = `/_emdash/api/plugins/${PLUGIN_ID}`;
const MAX_SAVES_PER_MIN = 30; // soft cap; hard cap is the CF rate-limit rule

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

async function serveAsset(name: string, contentType: string): Promise<Response> {
	// dist/ ships beside src/ in the published package; resolve relative to this module.
	const path = fileURLToPath(new URL(`../dist/${name}`, import.meta.url));
	const body = readFileSync(path);
	return new Response(body, {
		headers: {
			"content-type": contentType,
			// versioned filename -> safe to cache forever
			"cache-control": "public, max-age=31536000, immutable",
		},
	});
}

export const consentRoutes = {
	[`assets/banner.${BANNER_VERSION}.js`]: {
		public: true,
		handler: async () => serveAsset("banner.js", "text/javascript; charset=utf-8"),
	},
	[`assets/banner.${BANNER_VERSION}.css`]: {
		public: true,
		handler: async () => serveAsset("banner.css", "text/css; charset=utf-8"),
	},

	// single source of truth for the banner AND the (future) Datenschutz text
	services: {
		public: true,
		handler: async (ctx: any) => (await loadSettings(ctx)).services,
	},

	save: {
		public: true,
		input: saveSchema,
		handler: async (ctx: any) => {
			// whitelist grant keys (schema allows any boolean record; constrain here)
			for (const k of Object.keys(ctx.input.grants)) {
				if (!ALLOWED_GRANT_KEYS.has(k)) {
					throw new Response(JSON.stringify({ error: "bad_category" }), { status: 400 });
				}
			}
			const siteId = siteIdFromCtx(ctx);
			// soft per-site flood cap (no IP). Ceiling: KV is eventually consistent
			// across colos; the hard cap is a Cloudflare rate-limit rule (go-live).
			const bucket = `rl:save:${siteId}:${Math.floor(Date.now() / 60000)}`;
			const n = ((await ctx.kv.get(bucket)) as number | null) ?? 0;
			if (n >= MAX_SAVES_PER_MIN) {
				throw new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 });
			}
			await ctx.kv.set(bucket, n + 1);

			await ctx.storage.consents.put(crypto.randomUUID(), {
				siteId, // host-attested, authoritative
				subjectId: ctx.input.subjectId, // c15t random client id, not person-derived
				ts: ctx.input.givenAt ?? Date.now(),
				action: ctx.input.action,
				grants: ctx.input.grants,
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
					html: `<link rel="stylesheet" href="${ROUTE_BASE}/assets/banner.${BANNER_VERSION}.css">`,
					key: "emdash-privacy-css",
				},
				{
					kind: "external-script",
					placement: "body:end",
					src: `${ROUTE_BASE}/assets/banner.${BANNER_VERSION}.js`,
					defer: true,
					attributes: nonceAttr,
					key: "emdash-privacy-js",
				},
			];
			return fragments;
		},
	},
};
