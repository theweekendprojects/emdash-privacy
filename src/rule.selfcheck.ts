/**
 * Self-check for rule.ts - the one piece of non-trivial logic. It asks c15t's
 * REAL offline policy engine to resolve our rule, so a rule the runtime
 * validator rejects (the exact bug that hid the banner) fails here, not in prod.
 * Run via `bash scripts/selfcheck.sh`. No test framework: plain asserts.
 */
import assert from "node:assert/strict";
import { offline } from "@c15t/browser";
import { retentionCutoff, purgeDue, DAY_MS } from "./purge.js";
import { resolveLanguage } from "./shared.js";
import { buildPolicyRule, monthsToDays, OPTIONAL_C15T_CATEGORIES } from "./rule.js";

async function resolve(rule: unknown, country?: string) {
	const factory = offline({ policyRules: [rule as never] });
	const transport = factory({
		consentCategories: ["necessary", "measurement", "marketing"],
		prefetch: {},
		translations: {},
	} as never);
	const res = await transport.init!({ overrides: country ? { country } : {}, user: null } as never);
	return (res as { policyResolution: any }).policyResolution;
}

const rule = buildPolicyRule({ policyVersion: "1", cookieMaxAgeMonths: 12 });

// --- static shape ---
assert.equal(rule.model, "opt-in", "must be opt-in (deny-by-default)");
assert.equal(rule.match.isDefault, true, "must match every visitor");
assert.ok(rule.actions.includes("accept") && rule.actions.includes("reject"), "accept+reject required");
assert.deepEqual(rule.preselectedCategories, [], "nothing pre-ticked");
assert.deepEqual(rule.privacySignals.gpc.denyCategories, [...OPTIONAL_C15T_CATEGORIES], "GPC denies all optional");
assert.equal(rule.proof.storeIp, false, "must not store IP");
assert.equal(rule.proof.storeUserAgent, false, "must not store user-agent");
assert.equal(rule.validity.choiceDays, 360, "12 months -> 360 days");
assert.equal(monthsToDays(0), 360, "0 months falls back to 12");
assert.equal(monthsToDays(Number.NaN), 360, "NaN months falls back to 12");
assert.equal(monthsToDays(-5), 360, "negative months falls back to 12");
assert.notEqual(
	buildPolicyRule({ policyVersion: "1", cookieMaxAgeMonths: 12 }).copyRevision,
	buildPolicyRule({ policyVersion: "2", cookieMaxAgeMonths: 12 }).copyRevision,
	"version bump must change copyRevision",
);

// --- the real engine accepts it, for EVERY visitor (the regression that hid the banner) ---
for (const country of [undefined, "DE", "US", "JP", "GB"]) {
	const p = await resolve(rule, country);
	assert.equal(p.status, "matched", `engine must match country=${country ?? "none"}, got ${p.status}/${p.reason}`);
	assert.equal(p.policy.model, "opt-in", "resolved model opt-in");
	assert.equal(p.policy.prompt, "choice", "resolved prompt choice");
}

// version bump changes the resolved fingerprint (returning visitors re-asked)
const f1 = (await resolve(buildPolicyRule({ policyVersion: "1", cookieMaxAgeMonths: 12 }), "DE")).fingerprints.choice;
const f2 = (await resolve(buildPolicyRule({ policyVersion: "2", cookieMaxAgeMonths: 12 }), "DE")).fingerprints.choice;
assert.notEqual(f1, f2, "policyVersion bump must change the choice fingerprint");

// --- retention cutoff (purge.ts) ---
const NOW = 1_800_000_000_000;
assert.equal(retentionCutoff(NOW, 36), NOW - 36 * 30 * DAY_MS, "36 months -> 1080 days back");
assert.equal(retentionCutoff(NOW, 1), NOW - 30 * DAY_MS, "1 month -> 30 days back");
for (const bad of [0, -3, Number.NaN, undefined, null, "12"]) {
	assert.equal(retentionCutoff(NOW, bad), NOW - 36 * 30 * DAY_MS, `bad retention ${String(bad)} falls back to 36 (never 'delete everything')`);
}

// --- lazy purge scheduling ---
assert.equal(purgeDue(null, NOW), true, "never ran -> due");
assert.equal(purgeDue(undefined, NOW), true, "no state -> due");
assert.equal(purgeDue({ at: NOW - 1000 }, NOW), false, "ran a second ago -> not due");
assert.equal(purgeDue({ at: NOW - DAY_MS }, NOW), true, "ran a day ago -> due");
assert.equal(purgeDue({ at: "x" }, NOW), true, "garbage state -> due (fail toward purging)");

// --- banner language ---
assert.equal(resolveLanguage("en", "de"), "en", "operator setting wins");
assert.equal(resolveLanguage("de", "en-GB"), "de", "operator setting wins (de)");
assert.equal(resolveLanguage("auto", "en-GB"), "en", "page locale en");
assert.equal(resolveLanguage("auto", null), "de", "no page locale -> German-market default");
assert.equal(resolveLanguage("auto", "fr"), "de", "non-English page locale -> German");
assert.equal(resolveLanguage(undefined, "EN"), "en", "case-insensitive");

console.log("rule.selfcheck: OK");
