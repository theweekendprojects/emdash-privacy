/**
 * Retention purge: delete consent records older than `retentionMonths`.
 * Used by the daily cron hook and by the admin "delete expired now" button.
 * Bounded (<= 50 batches of 200) so one run can never run away.
 */
import { SETTINGS_DEFAULTS } from "./shared.js";

export const DAY_MS = 86_400_000;

/** True when a lazy purge is due: never run, or last run over a day ago. Pure; self-checked. */
export function purgeDue(last: unknown, now: number): boolean {
	const at = last && typeof last === "object" ? (last as { at?: unknown }).at : undefined;
	return typeof at !== "number" || !Number.isFinite(at) || now - at >= DAY_MS;
}

/** Cutoff timestamp (epoch ms) for a retention period in months. Pure; self-checked. */
export function retentionCutoff(now: number, months: unknown): number {
	const m = typeof months === "number" && Number.isFinite(months) && months > 0 ? months : SETTINGS_DEFAULTS.retentionMonths;
	return now - m * 30 * DAY_MS;
}

/**
 * Returns how many records were deleted. `maxBatches` bounds the work (200 rows
 * each): the cron/admin paths use the default, the lazy path inside /save uses 1.
 */
export async function purgeExpired(ctx: any, maxBatches = 50): Promise<number> {
	const months = (await ctx.kv.get("settings:retentionMonths")) as number | null;
	const cutoff = retentionCutoff(Date.now(), months);
	let deleted = 0;
	for (let i = 0; i < maxBatches; i++) {
		const res = await ctx.storage.consents.query({
			where: { ts: { lt: cutoff } },
			orderBy: { ts: "asc" },
			limit: 200,
		});
		if (!res.items.length) break;
		await ctx.storage.consents.deleteMany(res.items.map((it: any) => it.id));
		deleted += res.items.length;
		if (!res.hasMore) break;
	}
	return deleted;
}
