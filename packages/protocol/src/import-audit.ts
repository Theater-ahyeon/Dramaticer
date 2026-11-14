import type {
	ImportAuditEntry,
	ImportAuditReport,
	ImportEntryKind,
	ImportMode,
} from "@dramaticer/core";

/**
 * `GET /api/stories/:id/import-audit` 的载荷：导入分型的体检数据，
 * 包含当前生效的导入模式。
 */
export interface ImportAuditReportView extends ImportAuditReport {
	readonly importMode: ImportMode;
}

/** 玩家可以写入的类型来源；模型建议不进这个接口。 */
export const IMPORT_AUDIT_PLAYER_SOURCES = ["player", "rule"] as const;
export type ImportAuditPlayerSource =
	(typeof IMPORT_AUDIT_PLAYER_SOURCES)[number];

export function isImportAuditPlayerSource(
	value: unknown,
): value is ImportAuditPlayerSource {
	return (
		typeof value === "string" &&
		(IMPORT_AUDIT_PLAYER_SOURCES as readonly string[]).includes(value)
	);
}

/** `PATCH /api/stories/:id/import-audit/entries/:source` 的请求体。 */
export interface ImportAuditEntryKindUpdateRequest {
	readonly kind: ImportEntryKind;
	/** 省略时按玩家修改处理；`rule` 表示撤销改动、回到规则判定。 */
	readonly kindSource?: ImportAuditPlayerSource;
}

/** 调整一条条目后返回更新后的条目与整份体检数据。 */
export interface ImportAuditEntryKindUpdateResult {
	readonly entry: ImportAuditEntry;
	readonly report: ImportAuditReportView;
}

/** `PUT /api/stories/:id/import-audit/entries/:source/memory` 的请求体。 */
export interface ImportAuditEntryMemoryUpdateRequest {
	/** 转换后条目不再进入每轮常驻集合，只在命中时按记忆注入 */
	readonly memory: boolean;
}

/** 转换或撤销后返回更新后的条目与整份体检数据。 */
export interface ImportAuditEntryMemoryUpdateResult {
	readonly entry: ImportAuditEntry;
	readonly report: ImportAuditReportView;
}

/** `POST /api/stories/:id/import-audit/memory` 的结果：本次转换的条数与整份体检数据。 */
export interface ImportAuditMemoryConvertResult {
	readonly converted: number;
	readonly report: ImportAuditReportView;
}

/** `POST /api/stories/:id/import-audit/suggestions` 的结果；建议在间隙生成。 */
export interface ImportAuditSuggestionResult {
	readonly storyId: string;
	readonly jobId: number;
	readonly kind: string;
}
