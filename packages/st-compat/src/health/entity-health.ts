import { parseCharacterCardFile } from "../character-card.js";
import type { StCardSpec, StCharacterCard } from "../character-card.js";
import { isJsonObject } from "../json.js";
import type { StWorldInfo } from "../world-info.js";
import { parseWorldInfoFile } from "../world-info.js";

export interface FieldSize {
	readonly field: string;
	readonly bytes: number;
}

export interface CardHealth {
	readonly name: string;
	readonly spec: StCardSpec;
	readonly fieldBytes: readonly FieldSize[];
	readonly alternateGreetingCount: number;
	readonly groupOnlyGreetingCount: number;
	readonly tagCount: number;
	readonly embeddedBookEntryCount: number;
}

export interface WorldHealth {
	readonly name: string | null;
	readonly entryCount: number;
	readonly enabledEntryCount: number;
	readonly constantEntryCount: number;
	readonly primaryKeywordCount: number;
	readonly secondaryKeywordCount: number;
	readonly distinctPrimaryKeywordCount: number;
	readonly contentBytes: number;
}

export interface EntityTotals {
	readonly cardCount: number;
	readonly worldCount: number;
	readonly worldEntryCount: number;
	readonly enabledWorldEntryCount: number;
	readonly constantWorldEntryCount: number;
	readonly distinctPrimaryKeywordCount: number;
	readonly embeddedBookEntryCount: number;
}

export interface EntityHealth {
	readonly cards: readonly CardHealth[];
	readonly worlds: readonly WorldHealth[];
	readonly totals: EntityTotals;
}

const CARD_TEXT_FIELDS = [
	"description",
	"personality",
	"scenario",
	"firstMessage",
	"messageExample",
	"creatorNotes",
	"systemPrompt",
	"postHistoryInstructions",
] as const;

export function summarizeCard(card: StCharacterCard): CardHealth {
	const fieldBytes = CARD_TEXT_FIELDS.map((field) => ({
		field,
		bytes: Buffer.byteLength(card[field], "utf8"),
	}));
	return {
		name: card.name,
		spec: card.spec,
		fieldBytes,
		alternateGreetingCount: card.alternateGreetings.length,
		groupOnlyGreetingCount: card.groupOnlyGreetings.length,
		tagCount: card.tags.length,
		embeddedBookEntryCount: countEmbeddedBookEntries(card.characterBook),
	};
}

export function summarizeWorld(world: StWorldInfo): WorldHealth {
	const keywords = new Set<string>();
	let primaryKeywordCount = 0;
	let secondaryKeywordCount = 0;
	let enabledEntryCount = 0;
	let constantEntryCount = 0;
	let contentBytes = 0;
	for (const entry of world.entries) {
		primaryKeywordCount += entry.keys.length;
		secondaryKeywordCount += entry.secondaryKeys.length;
		contentBytes += Buffer.byteLength(entry.content, "utf8");
		if (!entry.disabled) {
			enabledEntryCount += 1;
			if (entry.constant) constantEntryCount += 1;
		}
		for (const key of entry.keys) {
			const normalized = key.trim().toLocaleLowerCase();
			if (normalized.length > 0) keywords.add(normalized);
		}
	}
	return {
		name: world.name,
		entryCount: world.entries.length,
		enabledEntryCount,
		constantEntryCount,
		primaryKeywordCount,
		secondaryKeywordCount,
		distinctPrimaryKeywordCount: keywords.size,
		contentBytes,
	};
}

export function summarizeEntities(
	cards: readonly StCharacterCard[],
	worlds: readonly StWorldInfo[],
): EntityHealth {
	const cardHealth = cards.map(summarizeCard);
	const worldHealth = worlds.map(summarizeWorld);
	return {
		cards: cardHealth,
		worlds: worldHealth,
		totals: {
			cardCount: cardHealth.length,
			worldCount: worldHealth.length,
			worldEntryCount: worldHealth.reduce(
				(total, world) => total + world.entryCount,
				0,
			),
			enabledWorldEntryCount: worldHealth.reduce(
				(total, world) => total + world.enabledEntryCount,
				0,
			),
			constantWorldEntryCount: worldHealth.reduce(
				(total, world) => total + world.constantEntryCount,
				0,
			),
			distinctPrimaryKeywordCount: worldHealth.reduce(
				(total, world) => total + world.distinctPrimaryKeywordCount,
				0,
			),
			embeddedBookEntryCount: cardHealth.reduce(
				(total, card) => total + card.embeddedBookEntryCount,
				0,
			),
		},
	};
}

export async function analyzeEntityFiles(
	cardPaths: readonly string[],
	worldPaths: readonly string[],
): Promise<EntityHealth> {
	const cards: StCharacterCard[] = [];
	for (const path of cardPaths) {
		cards.push(await parseCharacterCardFile(path));
	}
	const worlds: StWorldInfo[] = [];
	for (const path of worldPaths) {
		worlds.push(await parseWorldInfoFile(path));
	}
	return summarizeEntities(cards, worlds);
}

function countEmbeddedBookEntries(
	book: Record<string, unknown> | null,
): number {
	if (book === null) return 0;
	const entries = book.entries;
	if (Array.isArray(entries)) return entries.length;
	if (isJsonObject(entries)) return Object.keys(entries).length;
	return 0;
}
