import { existsSync } from "node:fs";
import { StoryStore } from "../store/story-store.js";
import {
	LEDGER_CHANGE_CARD_STATUSES,
	type LedgerChangeCard,
	type LedgerChangeCardStatus,
	approveLedgerChangeCard,
	isLedgerChangeCardStatus,
	rejectLedgerChangeCard,
	rollbackLedgerChangeCard,
} from "./cards.js";

const USAGE =
	"用法：dramaticer ledger cards <story> --db <path> [--status <status>] | dramaticer ledger --approve|--reject|--rollback <id> --db <path>";

type LedgerAction = "cards" | "approve" | "reject" | "rollback";

export interface LedgerCliDependencies {
	readonly log?: (message: string) => void;
	readonly decidedAt?: string;
}

export interface LedgerCliResult {
	readonly action: LedgerAction;
	readonly cards: readonly LedgerChangeCard[];
}

/** `dramaticer ledger`：列出待审变更卡，或者批准、拒绝、回滚其中一张。 */
export async function runLedgerCli(
	args: readonly string[],
	dependencies: LedgerCliDependencies = {},
): Promise<LedgerCliResult> {
	const parsed = parseLedgerArgs(args);
	const log = dependencies.log ?? console.log;
	if (!existsSync(parsed.dbPath)) {
		throw new Error(`数据库不存在：${parsed.dbPath}`);
	}
	const store = StoryStore.open(parsed.dbPath);
	try {
		if (parsed.action === "cards") {
			const cards = store.listLedgerChangeCards(parsed.storyId as string, {
				...(parsed.status === null ? {} : { status: parsed.status }),
			});
			logCards(cards, log);
			return { action: "cards", cards };
		}
		const cardId = parsed.cardId as string;
		const decide =
			parsed.action === "approve"
				? approveLedgerChangeCard
				: parsed.action === "reject"
					? rejectLedgerChangeCard
					: rollbackLedgerChangeCard;
		const updated = await decide(store, cardId, {
			...(dependencies.decidedAt === undefined
				? {}
				: { decidedAt: dependencies.decidedAt }),
		});
		log(
			`${actionLabel(parsed.action)}变更卡 ${updated.id}：${updated.text}（状态 ${updated.status}）`,
		);
		return { action: parsed.action, cards: [updated] };
	} finally {
		store.close();
	}
}

function logCards(
	cards: readonly LedgerChangeCard[],
	log: (message: string) => void,
): void {
	log(`变更卡 ${cards.length} 张：`);
	for (const card of cards) {
		log(
			`${card.id} [${card.status}] 来源 ${card.source} 楼层 ${card.sourceNodeId} 创建 ${card.createdAt}`,
		);
		log(`  说明：${card.text}`);
		if (card.rejectionReason !== null) {
			log(`  拒绝原因：${card.rejectionReason}`);
		}
		for (const diff of card.diffs) {
			const value = diff.op === "set" ? ` ${JSON.stringify(diff.value)}` : "";
			log(`  修改：${JSON.stringify(diff.path)} ${diff.op}${value}`);
		}
	}
}

function actionLabel(action: LedgerAction): string {
	switch (action) {
		case "approve":
			return "已批准";
		case "reject":
			return "已拒绝";
		case "rollback":
			return "已回滚";
		case "cards":
			return "列出";
	}
}

interface LedgerArgs {
	readonly action: LedgerAction;
	readonly dbPath: string;
	readonly storyId: string | null;
	readonly cardId: string | null;
	readonly status: LedgerChangeCardStatus | null;
}

function parseLedgerArgs(args: readonly string[]): LedgerArgs {
	if (args[0] !== "ledger") throw new Error(USAGE);
	const values = new Map<string, string>();
	const actions: { readonly action: LedgerAction; readonly value: string }[] =
		[];
	let cardsCommand = false;
	let storyId: string | null = null;
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			if (arg === "cards" && !cardsCommand) {
				cardsCommand = true;
				continue;
			}
			if (cardsCommand && storyId === null) {
				storyId = arg;
				continue;
			}
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (!["db", "status", "approve", "reject", "rollback"].includes(key)) {
			throw new Error(`不认识的参数 --${key}；${USAGE}`);
		}
		const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1);
		if (equals === -1) index += 1;
		if (value === undefined || value.length === 0) {
			throw new Error(`--${key} 后面必须写值；${USAGE}`);
		}
		if (key === "approve" || key === "reject" || key === "rollback") {
			actions.push({ action: key, value });
			continue;
		}
		if (values.has(key)) {
			throw new Error(`参数 --${key} 重复；${USAGE}`);
		}
		values.set(key, value);
	}
	const dbPath = values.get("db");
	if (dbPath === undefined) throw new Error(`--db 必须写数据库路径；${USAGE}`);
	const statusValue = values.get("status");
	if (statusValue !== undefined && !isLedgerChangeCardStatus(statusValue)) {
		throw new Error(
			`--status 只能是 ${LEDGER_CHANGE_CARD_STATUSES.join("、")}；${USAGE}`,
		);
	}
	if (cardsCommand) {
		if (actions.length > 0) throw new Error(`列出卡片时不能指定动作；${USAGE}`);
		if (storyId === null) throw new Error(`cards 后面必须写故事 id；${USAGE}`);
		return {
			action: "cards",
			dbPath,
			storyId,
			cardId: null,
			status: statusValue ?? null,
		};
	}
	if (actions.length !== 1) {
		throw new Error(
			`必须指定 cards、--approve、--reject、--rollback 之一；${USAGE}`,
		);
	}
	if (storyId !== null) {
		throw new Error(`指定动作时不能再写故事 id；${USAGE}`);
	}
	if (statusValue !== undefined) {
		throw new Error(`--status 只用于列出卡片；${USAGE}`);
	}
	const chosen = actions[0] as {
		readonly action: LedgerAction;
		readonly value: string;
	};
	return {
		action: chosen.action,
		dbPath,
		storyId: null,
		cardId: chosen.value,
		status: null,
	};
}
