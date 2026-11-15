import {
	type BlueprintEntry,
	type JsonObject,
	type JsonValue,
	assertBlueprintEntries,
	assertJsonValue,
	isJsonObject,
	parseDramaticerCardExtension,
} from "@dramaticer/core";
import type { StCardSpec, StCharacterCard } from "./character-card.js";

/** 卡里存扩展的位置：V1 在根节点，V2 与 V3 在 `data` 节点。 */
function cardContainer(raw: JsonObject, spec: StCardSpec): JsonObject {
	if (spec === "chara_card_v1") return raw;
	const data = raw.data;
	if (!isJsonObject(data)) {
		throw new Error(`角色卡缺少 "data" 节点：${spec}`);
	}
	return data;
}

/**
 * 把蓝图写进卡的 `extensions.dramaticer.blueprint`，返回新的卡对象。
 * 原卡不动，除这个字段之外的内容逐字保留；没有条目时删掉这个字段。
 * 酒馆读卡时忽略不认识的扩展字段，导入方用 `parseDramaticerCardExtension` 读回。
 */
export function attachBlueprintExtension(
	card: StCharacterCard,
	entries: readonly BlueprintEntry[],
): JsonObject {
	const blueprint = assertBlueprintEntries(entries, "导出的蓝图");
	const raw: JsonObject = structuredClone(card.raw);
	const container = cardContainer(raw, card.spec);
	const existingExtensions = container.extensions;
	if (blueprint.length === 0) {
		if (isJsonObject(existingExtensions)) {
			const existingExtension = existingExtensions.dramaticer;
			if (isJsonObject(existingExtension)) {
				Reflect.deleteProperty(existingExtension, "blueprint");
			}
		}
		return raw;
	}
	let extensions: JsonObject;
	if (isJsonObject(existingExtensions)) {
		extensions = existingExtensions;
	} else {
		extensions = {};
		container.extensions = extensions;
	}
	const existingDramaticer = extensions.dramaticer;
	let extension: JsonObject;
	if (isJsonObject(existingDramaticer)) {
		extension = existingDramaticer;
	} else {
		extension = {};
		extensions.dramaticer = extension;
	}
	assertJsonValue(blueprint, "导出的蓝图");
	extension.blueprint = blueprint as unknown as JsonValue;
	return raw;
}

/** 读回卡里的默认蓝图；没有这个字段时是空蓝图。 */
export function readCardBlueprint(card: StCharacterCard): BlueprintEntry[] {
	return [
		...parseDramaticerCardExtension(card.extensions.dramaticer).blueprint,
	];
}
