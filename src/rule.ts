/**
 * Builds the single c15t policy rule the browser resolves locally (no
 * backend). One rule, matched as the DEFAULT for every visitor: strict
 * opt-in, deny-by-default. We do NOT key the policy on country - for a
 * German-market operator the safe baseline is opt-in for everyone, and an
 * unknown/VPN country must fail safe. Relaxing by region is out of scope for v1.
 *
 * A plain literal rule is valid; the earlier hand-written rule was rejected by
 * the runtime validator (`invalid-configuration`, verified live) only because
 * it limited `categories` without `scopeMode`. We deliberately do NOT derive it
 * from c15t's `europeOptIn` preset: that would pull `@c15t/schema` into the
 * server bundle and carry the preset's stale v2 `legacyMaterial` (which pins
 * `proof.storeIp: true`). Facts verified empirically against
 * @c15t/browser 3.0.0 `offline()`:
 *   - `match: { isDefault: true }` matches EVERY country, including none/unknown.
 *     (`match.fallback` alone only matches an UNKNOWN country, so a known
 *     visitor, e.g. US, got `no-match` and no banner.)
 *   - limiting `categories` requires `scopeMode: 'permissive'`; without it the
 *     validator fails with `invalid-configuration`.
 *   - `copyRevision` is hashed into the fingerprint: a bump re-asks returning
 *     visitors.
 *   - `proof.store*` flags describe what c15t's HOSTED backend would store.
 *     We write our own proof in `/save` (no IP / UA), and force them off anyway.
 *
 * c15t optional categories: functionality | experience | measurement | marketing.
 * This plugin exposes two: "analytics" (= c15t `measurement`) and "marketing".
 * `necessary` is always on and never a choice.
 *
 * This is the one piece of non-trivial logic in the plugin, so it carries the
 * self-check in `rule.selfcheck.ts`.
 */
/** c15t optional categories this plugin drives. "analytics" is c15t `measurement`. */
export const OPTIONAL_C15T_CATEGORIES = ["measurement", "marketing"] as const;

export interface BuildPolicyInput {
	/** Operator policy version. Bump = re-ask. Becomes `copyRevision`. */
	policyVersion: string;
	/** Re-ask after this many months (operator setting). Becomes validity days. */
	cookieMaxAgeMonths: number;
}

/** Months -> days. One place, so the self-check pins it. */
export function monthsToDays(months: number): number {
	// Guard the trust boundary: a bad/absent setting must not disable re-asking.
	const m = Number.isFinite(months) && months > 0 ? months : 12;
	return Math.round(m * 30);
}

export function buildPolicyRule(input: BuildPolicyInput) {
	const categories = [...OPTIONAL_C15T_CATEGORIES];
	return {
		id: "emdash-privacy-strict",
		match: { isDefault: true as const }, // every visitor, no country keying
		model: "opt-in" as const, // deny-by-default
		prompt: "choice" as const, // first layer is a choice banner, not a bare notice
		categories, // only the two we offer
		scopeMode: "permissive" as const, // required when categories is a subset
		actions: ["accept", "reject", "customize"] as ("accept" | "reject" | "customize")[],
		preselectedCategories: [] as string[], // nothing pre-ticked under opt-in
		validity: { choiceDays: monthsToDays(input.cookieMaxAgeMonths) },
		privacySignals: { gpc: { denyCategories: categories } }, // GPC denies all optional
		copyRevision: input.policyVersion, // bump re-asks returning visitors
		proof: { storeIp: false, storeUserAgent: false, storeLanguage: false },
	};
}
