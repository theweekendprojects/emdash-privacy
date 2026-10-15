/**
 * Builds the single c15t policy rule the browser resolves locally (no
 * backend). One rule, matched as the default for every visitor: strict
 * opt-in, deny-by-default. We do NOT key the policy on country — for a
 * German-market operator the safe baseline is opt-in for everyone, and an
 * unknown/VPN country must fail safe. Relaxing by region is deliberately out
 * of scope for v1.
 *
 * c15t's optional categories are `functionality | experience | measurement |
 * marketing`. This plugin exposes two to the operator: "analytics" (mapped to
 * c15t `measurement`) and "marketing". `necessary` is always on and never a
 * choice.
 *
 * Field names verified against @c15t/schema PolicyRule (3.0.0):
 *   model 'opt-in', prompt 'choice', match.isDefault, categories,
 *   actions, validity.choiceDays, privacySignals.gpc.denyCategories,
 *   copyRevision (hashed into the fingerprint — a bump re-asks returning
 *   visitors), proof.storeIp/storeUserAgent (we force both false, no PII).
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

/** A minimal c15t PolicyRule (only the fields we set; c15t fills the rest). */
export interface PolicyRuleOut {
	id: string;
	match: { isDefault: true };
	model: "opt-in";
	prompt: "choice";
	categories: string[];
	actions: Array<"accept" | "reject" | "customize">;
	preselectedCategories: string[];
	validity: { choiceDays: number };
	privacySignals: { gpc: { denyCategories: string[] } };
	copyRevision: string;
	proof: { storeIp: false; storeUserAgent: false };
}

/** Months → days. One place, so the self-check pins it. */
export function monthsToDays(months: number): number {
	// Guard the trust boundary: a bad/absent setting must not disable re-asking.
	const m = Number.isFinite(months) && months > 0 ? months : 12;
	return Math.round(m * 30);
}

export function buildPolicyRule(input: BuildPolicyInput): PolicyRuleOut {
	const categories = [...OPTIONAL_C15T_CATEGORIES];
	return {
		id: "emdash-privacy-strict",
		match: { isDefault: true }, // every visitor, no country keying
		model: "opt-in", // deny-by-default
		prompt: "choice", // first layer is a choice banner, not a bare notice
		categories,
		actions: ["accept", "reject", "customize"], // accept + reject equally offered
		preselectedCategories: [], // nothing pre-ticked under opt-in
		validity: { choiceDays: monthsToDays(input.cookieMaxAgeMonths) },
		privacySignals: { gpc: { denyCategories: categories } }, // GPC denies all optional
		copyRevision: input.policyVersion, // bump re-asks returning visitors
		proof: { storeIp: false, storeUserAgent: false }, // never store PII
	};
}
