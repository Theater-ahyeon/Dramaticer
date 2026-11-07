// F0-T02：从 ST 对话里抽取「被拒绝 / 被接受」的回复对，抽样并校验归因输出。
import { createHash } from "node:crypto";

export const FAILURE_CATEGORIES = Object.freeze([
	"遗忘或前后矛盾",
	"OOC",
	"重复或原地打转",
	"不推进剧情",
	"没听用户的指示",
	"文笔或文风",
	"拒答或说教",
	"截断",
	"格式或状态栏",
	"其他",
]);

const CATEGORY_SET = new Set(FAILURE_CATEGORIES);

/** 抽样分层：按被拒绝回复所在的楼层深度分三层。楼层按非 system 楼层从 1 开始计。 */
export const PAIR_DEPTH_BUCKETS = Object.freeze([
	{ label: "1–10 楼", min: 1, max: 10 },
	{ label: "11–50 楼", min: 11, max: 50 },
	{ label: "51 楼以上", min: 51, max: Number.POSITIVE_INFINITY },
]);

export function pairDepthBucketOf(depthFloor) {
	if (!Number.isInteger(depthFloor) || depthFloor < 1) {
		throw new Error("楼层深度必须是正整数");
	}
	for (const bucket of PAIR_DEPTH_BUCKETS) {
		if (depthFloor >= bucket.min && depthFloor <= bucket.max) return bucket.label;
	}
	throw new Error(`楼层深度超出分桶范围：${depthFloor}`);
}

export const DEFAULT_PAIR_OPTIONS = Object.freeze({
	contextMessages: 8,
	contextChars: 1_200,
	replyChars: 4_000,
});

export function clipText(text, limit) {
	if (typeof text !== "string") {
		throw new Error("clipText 需要字符串");
	}
	if (!Number.isInteger(limit) || limit <= 0) {
		throw new Error("clipText 的 limit 必须是正整数");
	}
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}……（后续内容已截断）`;
}

function isNonNegativeInteger(value) {
	return Number.isInteger(value) && value >= 0;
}

/**
 * 增量收集一个对话里可比较的回复对。
 * swipe_id 指向的回复算被接受；被接受的是最后一条时取前一条，否则取后一条作为被拒绝的尝试。
 */
export function createPairCollector(
	chatLabel,
	options = DEFAULT_PAIR_OPTIONS,
) {
	const { contextMessages, contextChars, replyChars } = {
		...DEFAULT_PAIR_OPTIONS,
		...options,
	};
	const candidates = [];
	const skipped = [];
	const window = [];
	let rerolledFloors = 0;
	let depthFloor = 0;

	return {
		push(message) {
			if (message.isSystem) return;
			depthFloor += 1;
			if (!message.isUser) {
				const swipes = Array.isArray(message.swipes) ? message.swipes : [];
				if (swipes.length >= 2) {
					rerolledFloors += 1;
					const swipeList = swipes;
					const swipeId = message.swipeId;
					const floor = message.index;
					if (swipeId === null || !isNonNegativeInteger(swipeId)) {
						skipped.push({ floor, reason: "缺少有效的 swipe_id" });
					} else if (swipeId >= swipeList.length) {
						skipped.push({ floor, reason: "swipe_id 越界" });
					} else {
						const acceptedIndex = swipeId;
						const rejectedIndex =
							acceptedIndex === swipeList.length - 1
								? acceptedIndex - 1
								: acceptedIndex + 1;
						const acceptedRaw = swipeList[acceptedIndex]?.text;
						const accepted =
							typeof acceptedRaw === "string" && acceptedRaw.trim() !== ""
								? acceptedRaw
								: message.text;
						const rejected = swipeList[rejectedIndex]?.text;
						if (
							typeof accepted !== "string" ||
							accepted.trim() === "" ||
							typeof rejected !== "string" ||
							rejected.trim() === ""
						) {
							skipped.push({ floor, reason: "尝试的正文为空" });
						} else if (accepted === rejected) {
							skipped.push({ floor, reason: "两次回复文本相同" });
						} else {
							candidates.push({
								id: `${chatLabel}:${floor}`,
								chatLabel,
								floor,
								depthFloor,
								swipeCount: swipeList.length,
								acceptedIndex,
								rejectedIndex,
								acceptedNotLast: acceptedIndex < swipeList.length - 1,
								acceptedText: clipText(accepted, replyChars),
								rejectedText: clipText(rejected, replyChars),
								context: window.map((entry) => ({ ...entry })),
							});
						}
					}
				}
			}
			window.push({
				role: message.isUser ? "user" : "assistant",
				text: clipText(typeof message.text === "string" ? message.text : "", contextChars),
			});
			while (window.length > contextMessages) window.shift();
		},
		result() {
			return {
				candidates: candidates.map((candidate) => ({
					...candidate,
					isLastFloor: candidate.depthFloor === depthFloor,
				})),
				skipped,
				rerolledFloors,
			};
		},
	};
}

export function stableHash(text) {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

function chatOrder(label) {
	const match = /(\d+)$/.exec(label);
	if (match === null) throw new Error(`对话标签里没有编号：${label}`);
	return Number(match[1]);
}

/**
 * 以对话为单位分层：每个对话内部按固定种子打乱，然后逐轮从各对话各取一对，
 * 保证目标数不超过可用配对时，先用完每个对话的第一对。
 */
export function sampleCandidates(candidatesByChat, target, seed = "f0-t02-v1") {
	if (!Number.isInteger(target) || target <= 0) {
		throw new Error("抽样目标必须是正整数");
	}
	const labels = [...candidatesByChat.keys()].sort((a, b) => chatOrder(a) - chatOrder(b));
	const ordered = new Map();
	for (const label of labels) {
		const items = [...candidatesByChat.get(label)];
		items.sort((a, b) =>
			stableHash(`${seed}|${a.id}`).localeCompare(stableHash(`${seed}|${b.id}`)),
		);
		ordered.set(label, items);
	}
	const picked = [];
	let round = 0;
	while (picked.length < target) {
		let added = false;
		for (const label of labels) {
			const items = ordered.get(label);
			if (round >= items.length) continue;
			picked.push(items[round]);
			added = true;
			if (picked.length >= target) break;
		}
		if (!added) break;
		round += 1;
	}
	return picked;
}

function groupCandidatesByChat(candidates) {
	const grouped = new Map();
	for (const candidate of candidates) {
		const list = grouped.get(candidate.chatLabel);
		if (list === undefined) grouped.set(candidate.chatLabel, [candidate]);
		else list.push(candidate);
	}
	return grouped;
}

/**
 * 按楼层深度分层抽样：每个桶内部沿用按对话分层的规则，目标数按桶给定。
 * 返回每个桶的目标数、可用配对与实取数量，供报告写明某层不足的情况。
 */
export function sampleStratified(candidates, targets, seed = "f0-t02b-v1") {
	const resolved = new Map();
	for (const bucket of PAIR_DEPTH_BUCKETS) {
		const raw = targets instanceof Map ? targets.get(bucket.label) : targets[bucket.label];
		const target = raw ?? 0;
		if (!Number.isInteger(target) || target < 0) {
			throw new Error(`楼层 ${bucket.label} 的抽样目标必须是非负整数`);
		}
		resolved.set(bucket.label, target);
	}
	const pools = new Map(PAIR_DEPTH_BUCKETS.map((bucket) => [bucket.label, []]));
	for (const candidate of candidates) {
		if (!Number.isInteger(candidate?.depthFloor)) {
			throw new Error(`配对 ${String(candidate?.id)} 缺少楼层深度`);
		}
		pools.get(pairDepthBucketOf(candidate.depthFloor)).push(candidate);
	}
	const picked = [];
	const stats = [];
	for (const bucket of PAIR_DEPTH_BUCKETS) {
		const target = resolved.get(bucket.label);
		const pool = pools.get(bucket.label);
		const chosen =
			target === 0
				? []
				: sampleCandidates(groupCandidatesByChat(pool), target, `${seed}|${bucket.label}`);
		picked.push(...chosen);
		stats.push({
			label: bucket.label,
			target,
			available: pool.length,
			picked: chosen.length,
		});
	}
	return { picked, stats };
}

function contextBlock(context) {
	if (context.length === 0) return "（没有更早的对话）";
	return context
		.map((entry) => `${entry.role === "user" ? "用户" : "助手"}：${entry.text}`)
		.join("\n\n");
}

export function buildJudgeMessages(candidate) {
	const system = [
		"你是故事编辑，正在分析用户为什么对同一处助手回复按了重新生成。",
		"用户放弃了其中一次尝试，保留了另一次。请只根据给出的最近对话、被放弃的回复和被保留的回复做判断。",
		`主因必须从下面的类别里选一个：${FAILURE_CATEGORIES.join("、")}。`,
		"次因最多两个，不能与主因相同，也不要重复；没有次因就给空数组。",
		"如果被放弃的回复只是另一种同样可行的写法（用户可能只是想看别的版本），把 alternative_only 设为 true，仍然给出最接近的主因。",
		"confidence 是 0 到 1 的小数，表示你对主因判断的把握。",
		'只输出一个 JSON 对象，不要 Markdown，不要解释：{"primary": "类别", "secondary": [], "alternative_only": false, "confidence": 0.0}',
	].join("\n");
	const user = [
		`最近的对话：\n${contextBlock(candidate.context)}`,
		`用户放弃的回复：\n${candidate.rejectedText}`,
		`用户保留的回复：\n${candidate.acceptedText}`,
		"请输出对这个回复对的判断。",
	].join("\n\n");
	return [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];
}

function stripCodeFence(text) {
	const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return match?.[1] ?? text;
}

function tryParseJson(text) {
	if (text === null || text.length === 0) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function extractJsonObject(text) {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start >= 0 && end > start) return text.slice(start, end + 1);
	return null;
}

function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJudgement(text) {
	const body = stripCodeFence(String(text ?? "").trim());
	const parsed = tryParseJson(body) ?? tryParseJson(extractJsonObject(body));
	if (!isPlainObject(parsed)) {
		throw new Error("归因输出里找不到 JSON 对象");
	}
	const { primary, secondary, alternative_only: alternativeOnly, confidence } = parsed;
	if (typeof primary !== "string" || !CATEGORY_SET.has(primary)) {
		throw new Error(`主因不合法：${String(primary)}`);
	}
	if (!Array.isArray(secondary)) {
		throw new Error("secondary 必须是数组");
	}
	if (secondary.length > 2) {
		throw new Error("次因最多两个");
	}
	const seen = new Set();
	for (const item of secondary) {
		if (typeof item !== "string" || !CATEGORY_SET.has(item)) {
			throw new Error(`次因不合法：${String(item)}`);
		}
		if (item === primary) throw new Error("次因不能与主因相同");
		if (seen.has(item)) throw new Error(`次因重复：${item}`);
		seen.add(item);
	}
	if (typeof alternativeOnly !== "boolean") {
		throw new Error("alternative_only 必须是布尔值");
	}
	if (
		typeof confidence !== "number" ||
		!Number.isFinite(confidence) ||
		confidence < 0 ||
		confidence > 1
	) {
		throw new Error(`confidence 必须是 0 到 1 的小数：${String(confidence)}`);
	}
	return {
		primary,
		secondary: [...secondary],
		alternativeOnly,
		confidence,
	};
}

export function replaceMarkedSection(existing, section, marker) {
	const begin = `<!-- ${marker}:begin -->`;
	const end = `<!-- ${marker}:end -->`;
	const startIndex = existing.indexOf(begin);
	const endIndex = existing.indexOf(end);
	if (startIndex >= 0 && endIndex > startIndex) {
		return `${existing.slice(0, startIndex)}${section}${existing.slice(endIndex + end.length)}`;
	}
	if (existing.trim() === "") return `${section}\n`;
	const trimmed = existing.endsWith("\n") ? existing : `${existing}\n`;
	return `${trimmed}\n${section}\n`;
}
