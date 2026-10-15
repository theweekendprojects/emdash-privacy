/**
 * Dependency-free self-check for rule.ts — the one piece of non-trivial logic.
 * Run via `bash scripts/selfcheck.sh` (compiles with tsc, runs with node).
 * No test framework: plain asserts, fails loud if the policy logic breaks.
 */
import assert from "node:assert/strict";
import { buildPolicyRule, monthsToDays, OPTIONAL_C15T_CATEGORIES } from "./rule.js";

// strict opt-in, deny-by-default, for every visitor
const r = buildPolicyRule({ policyVersion: "1", cookieMaxAgeMonths: 12 });
assert.equal(r.model, "opt-in", "must be opt-in (deny-by-default)");
assert.equal(r.match.isDefault, true, "must match every visitor (no country keying)");
assert.equal(r.prompt, "choice", "first layer is a choice banner");

// accept AND reject both offered (no dark pattern)
assert.ok(r.actions.includes("accept") && r.actions.includes("reject"), "accept+reject required");
assert.deepEqual(r.preselectedCategories, [], "nothing pre-ticked under opt-in");

// GPC denies every optional category
assert.deepEqual(r.privacySignals.gpc.denyCategories, [...OPTIONAL_C15T_CATEGORIES], "GPC denies all optional");

// never store PII in the proof
assert.equal(r.proof.storeIp, false, "must not store IP");
assert.equal(r.proof.storeUserAgent, false, "must not store user-agent");

// validity follows the operator setting
assert.equal(r.validity.choiceDays, 360, "12 months -> 360 days");
assert.equal(buildPolicyRule({ policyVersion: "1", cookieMaxAgeMonths: 6 }).validity.choiceDays, 180, "6 months -> 180 days");

// bad/absent max-age must fail safe to 12 months, never 0 (which would never re-ask)
assert.equal(monthsToDays(0), 360, "0 months falls back to 12");
assert.equal(monthsToDays(Number.NaN), 360, "NaN months falls back to 12");
assert.equal(monthsToDays(-5), 360, "negative months falls back to 12");

// a policyVersion bump changes copyRevision -> returning visitors re-asked
const a = buildPolicyRule({ policyVersion: "1", cookieMaxAgeMonths: 12 });
const b = buildPolicyRule({ policyVersion: "2", cookieMaxAgeMonths: 12 });
assert.notEqual(a.copyRevision, b.copyRevision, "version bump must change copyRevision");

console.log("rule.selfcheck: OK");
