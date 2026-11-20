import type { StoryStore } from "../store/story-store.js";
import type { BackgroundJob } from "./types.js";

// 后台失败可见（refactor/03）：从任务表直接算，不新增存储。最近连续几条任务都因为
// 模型渠道失败而出错，就认为记忆与导演暂停了；只要有一条成功就恢复。

export const BACKGROUND_PAUSE_THRESHOLD = 3;
const RECENT_JOBS = 30;
const SUMMARY_CHARS = 120;
const CHANNEL_FAILURE = /模型 (\S+) 的所有渠道都失败了：(.+)$/s;

export interface BackgroundHealth {
	readonly paused: boolean;
	/** 最近连续失败的任务条数。 */
	readonly failures: number;
	/** 最近一次失败的任务类型；没有失败时为 null。 */
	readonly kind: string | null;
	/** 出错的模型 id 与第一个出错的渠道；从错误信息里读，读不到时为 null。 */
	readonly model: string | null;
	readonly channel: string | null;
	/** 错误摘要：截短，并把像密钥的长串换成省略号。 */
	readonly error: string | null;
	readonly at: string | null;
}

const HEALTHY: BackgroundHealth = {
	paused: false,
	failures: 0,
	kind: null,
	model: null,
	channel: null,
	error: null,
	at: null,
};

/** 截短并去掉像密钥、令牌的长串；错误信息里不该出现，但保险起见。 */
export function summarizeBackgroundError(message: string): string {
	const redacted = message
		.replace(/\b(?:sk|pk|rk|ak)-[A-Za-z0-9_-]{8,}/g, "…")
		.replace(/[A-Za-z0-9_-]{32,}/g, "…")
		.replace(/\s+/g, " ")
		.trim();
	return redacted.length > SUMMARY_CHARS
		? `${redacted.slice(0, SUMMARY_CHARS)}…`
		: redacted;
}

function startedOrder(job: BackgroundJob): string {
	return job.startedAt ?? job.finishedAt ?? job.createdAt;
}

export function readBackgroundHealth(
	store: StoryStore,
	storyId: string,
	threshold = BACKGROUND_PAUSE_THRESHOLD,
): BackgroundHealth {
	const recent = store
		.listBackgroundJobs({ storyId })
		.filter((job) => job.attempts > 0 && job.status !== "discarded")
		.sort((left, right) =>
			startedOrder(right).localeCompare(startedOrder(left)),
		)
		.slice(0, RECENT_JOBS);
	let failures = 0;
	let latest: { job: BackgroundJob; match: RegExpExecArray } | null = null;
	for (const job of recent) {
		if (job.status === "done") break;
		const match =
			job.lastError === null ? null : CHANNEL_FAILURE.exec(job.lastError);
		// 不是渠道失败（例如解析出错）不算暂停，也不打断计数之外的判断。
		if (match === null) {
			if (job.status === "running" || job.status === "pending") continue;
			break;
		}
		failures += 1;
		latest ??= { job, match };
	}
	if (latest === null) return HEALTHY;
	const detail = latest.match[2] ?? "";
	const channelMatch = /^([^：；]+)：/.exec(detail);
	return {
		paused: failures >= threshold,
		failures,
		kind: latest.job.kind,
		model: latest.match[1] ?? null,
		channel: channelMatch?.[1]?.trim() ?? null,
		error: summarizeBackgroundError(
			channelMatch === null ? detail : detail.slice(channelMatch[0].length),
		),
		at: latest.job.finishedAt ?? latest.job.startedAt,
	};
}
