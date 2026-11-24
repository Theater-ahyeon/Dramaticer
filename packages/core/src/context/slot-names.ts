/** DESIGN §9 的 harness 槽位；注册表与模板共用，不依赖工具或其他模块。 */
export const CONTEXT_SLOT_NAMES = [
	"lore",
	"character",
	"persona",
	"summary",
	"state",
	"situation",
	"world_index",
	"memory",
	"history",
	"scene",
	"profile",
	"reunion",
	"scene_card",
	"blueprint",
	"director",
	"user_will",
	"protocol",
] as const;

export type ContextSlotName = (typeof CONTEXT_SLOT_NAMES)[number];

const SLOT_NAMES: ReadonlySet<string> = new Set(CONTEXT_SLOT_NAMES);

export function isContextSlotName(value: unknown): value is ContextSlotName {
	return typeof value === "string" && SLOT_NAMES.has(value);
}
