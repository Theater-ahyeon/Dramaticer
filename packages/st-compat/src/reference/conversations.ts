import { parseChatJsonlFile } from "../chat-jsonl.js";
import type { DuplicationCurve, ReplyText } from "../health/duplication.js";
import { analyzeDuplication } from "../health/duplication.js";
import { isLegacyCorpus, openSnapshot } from "../health/manifest.js";
import type {
	DialogueStats,
	SentenceLengthStats,
	SimilarityPercentiles,
	VocabularyStats,
} from "./text-stats.js";
import { analyzeReferenceText, similarityPercentiles } from "./text-stats.js";

/**
 * 评测对话的助手回复统计，口径与参照小说一致。
 *
 * 对话本身是互动文本，只用于和参照分布对照；Director 阈值不从这组数字推导。
 */
export interface ConversationProseStats {
	/** 固定编号，例如“对话 1”；不出现角色名或文件名。 */
	readonly label: string;
	readonly replyCount: number;
	readonly charCount: number;
	readonly duplication: DuplicationCurve;
	readonly meanAdjacentSimilarity: number;
	readonly similarityPercentiles: SimilarityPercentiles;
	readonly sentence: SentenceLengthStats;
	readonly dialogue: DialogueStats;
	readonly vocabulary: VocabularyStats;
}

/**
 * 读取快照里的旧语料对话，按目标路径排序后依次统计助手回复。
 *
 * 重复度按相邻回复计算（与体检报告一致）；句长、对话占比与词汇丰富度按
 * 全部助手回复拼成的文本计算。多段回复在句长统计里按换行参与分句。
 */
export async function collectConversationProse(
	rawRoot: string,
): Promise<readonly ConversationProseStats[]> {
	const snapshot = await openSnapshot(rawRoot);
	const files = snapshot
		.filesByRole("chat")
		.filter(isLegacyCorpus)
		.sort((left, right) => {
			if (left.target < right.target) return -1;
			if (left.target > right.target) return 1;
			return 0;
		});
	const conversations: ConversationProseStats[] = [];
	for (const [index, file] of files.entries()) {
		const filePath = await snapshot.resolveFile(file);
		const replies: ReplyText[] = [];
		for await (const entry of parseChatJsonlFile(filePath)) {
			if (entry.kind !== "message") continue;
			const message = entry.message;
			if (message.isUser || message.isSystem) continue;
			if (message.text.trim().length === 0) continue;
			replies.push({ floor: message.index + 1, text: message.text });
		}
		const textStats = analyzeReferenceText(
			replies.map((reply) => reply.text).join("\n"),
		);
		const duplication = analyzeDuplication(replies);
		const similarityTotal = duplication.pairs.reduce(
			(sum, pair) => sum + pair.similarity,
			0,
		);
		conversations.push({
			label: `对话 ${index + 1}`,
			replyCount: replies.length,
			charCount: textStats.charCount,
			duplication,
			meanAdjacentSimilarity:
				duplication.pairs.length === 0
					? 0
					: similarityTotal / duplication.pairs.length,
			similarityPercentiles: similarityPercentiles(
				duplication.pairs.map((pair) => pair.similarity),
			),
			sentence: textStats.sentence,
			dialogue: textStats.dialogue,
			vocabulary: textStats.vocabulary,
		});
	}
	return conversations;
}
