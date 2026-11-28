// StoryStore 的领域仓储：故事、媒体、代码插件安装、故事设置与上下文模板（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import { randomUUID } from "node:crypto";
import {
	type HistoryBlockPolicy,
	assertHistoryBlockPolicy,
} from "../../blocks/history.js";
import { assertBlueprintSpoilerMode } from "../../blueprint/spoilers.js";
import { isTurnMode } from "../../chat/mode.js";
import {
	DEFAULT_CONTEXT_TEMPLATE_ID,
	assertContextLayout,
} from "../../context/template.js";
import { assertDirectorOrganizationKind } from "../../director/organization.js";
import { assertDirectorConfig } from "../../director/types.js";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type DirectorConfig,
} from "../../director/types.js";
import {
	DEFAULT_IMAGE_CONFIG,
	type ImageConfig,
	assertImageConfig,
} from "../../images/types.js";
import { type JsonValue, rejectUnknownKeys } from "../../json.js";
import { isLlmReasoningLevel } from "../../llm/types.js";
import {
	diffCodePluginPermissions,
	parseCodePluginManifest,
	parseCodePluginPermissions,
} from "../../plugins/code-plugins.js";
import {
	type CodePluginInstallationRecord,
	assertCodePluginInstallSource,
} from "../../plugins/installation.js";
import {
	EMPTY_FEATURE_SWITCH_OVERRIDES,
	assertFeatureSwitchOverrides,
	assertFeatureTier,
} from "../../settings/features.js";
import { isStructuredOutputMode } from "../../structured/types.js";
import type { Story } from "../../timeline.js";
import { assertWorldModelKind } from "../../world-model/types.js";
import { serializeJsonValue } from "../json-value.js";
import {
	CONTEXT_TEMPLATE_UPDATE_KEYS,
	type ContextTemplateRecord,
	type CreateContextTemplateInput,
	DEFAULT_STORY_SETTINGS_VALUES,
	DIRECTOR_CONFIG_KEYS,
	STORY_SETTINGS_UPDATE_KEYS,
	type StorySettings,
	type StorySettingsUpdate,
	type UpdateContextTemplateInput,
	assertImportMode,
	assertStoredContextTemplate,
	assertStorySettingsUpdate,
	parseStoryPluginOverrides,
} from "../settings.js";
import {
	type NewStoryMediaInput,
	type StoryMediaRecord,
	type StoryMediaSlot,
	assertNewStoryMediaInput,
	isStoryMediaSlot,
} from "../story-media.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString, readBooleanColumn } from "./shared.js";

interface StoryRow {
	readonly id: string;
	readonly title: string;
	readonly created_at: string;
}

interface StoryMediaRow {
	readonly story_id: string;
	readonly slot: string;
	readonly name: string;
	readonly file_name: string;
	readonly media_type: string;
	readonly byte_size: number;
	readonly created_at: string;
}

interface StorySettingsRow {
	readonly story_id: string;
	readonly card_name: string | null;
	readonly character_prompt: string | null;
	readonly persona: string | null;
	readonly template_id: string | null;
	readonly model: string | null;
	readonly budget_tokens: number;
	readonly structured_output: string;
	readonly temperature: number;
	readonly max_tokens: number;
	readonly reasoning: string;
	readonly turn_mode: string;
	readonly max_read_rounds: number;
	readonly deep_max_tool_calls: number;
	readonly deep_timeout_ms: number;
	readonly deep_context_token_limit: number;
	readonly deep_recent_tool_steps: number;
	readonly viewpoint: string | null;
	readonly director_config: string;
	readonly director_organization: string;
	readonly history_block_policy: string;
	readonly context_layout: string;
	readonly scene_log_enabled: number;
	readonly gap_pass_enabled: number;
	readonly gap_plan_seconds: number;
	readonly image_config: string | null;
	readonly plugin_overrides: string;
	readonly world_model: string;
	readonly import_mode: string;
	readonly blueprint_spoilers: string;
	readonly feature_tier: string;
	readonly feature_switches: string;
	readonly updated_at: string;
}

interface ContextTemplateRow {
	readonly id: string;
	readonly name: string;
	readonly template: string;
	readonly created_at: string;
	readonly updated_at: string;
}

interface PluginInstallationRow {
	readonly name: string;
	readonly version: string;
	readonly manifest: string;
	readonly granted_permissions: string;
	readonly source_kind: string;
	readonly source_spec: string;
	readonly installed_at: string;
}

export interface CreateStoryInput {
	readonly id?: string;
	readonly title: string;
	readonly createdAt?: string;
}

function requireTemplateName(value: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("上下文模板名称必须是非空字符串");
	}
	return value.trim();
}

function rowToStory(row: StoryRow): Story {
	return {
		id: row.id,
		title: row.title,
		createdAt: row.created_at,
	};
}

function rowToStoryMedia(row: StoryMediaRow): StoryMediaRecord {
	if (!isStoryMediaSlot(row.slot)) {
		throw new Error(`故事 ${row.story_id} 的媒体位置不合法：${row.slot}`);
	}
	return {
		storyId: row.story_id,
		slot: row.slot,
		name: row.name,
		fileName: row.file_name,
		mediaType: row.media_type,
		byteSize: row.byte_size,
		createdAt: row.created_at,
	};
}

function rowToStorySettings(row: StorySettingsRow): StorySettings {
	if (!isStructuredOutputMode(row.structured_output)) {
		throw new Error(
			`故事 ${row.story_id} 的 structured_output 不合法：${row.structured_output}`,
		);
	}
	if (!isLlmReasoningLevel(row.reasoning)) {
		throw new Error(
			`故事 ${row.story_id} 的 reasoning 不合法：${row.reasoning}`,
		);
	}
	if (!isTurnMode(row.turn_mode)) {
		throw new Error(
			`故事 ${row.story_id} 的 turn_mode 不合法：${row.turn_mode}`,
		);
	}
	// 旧版本保存的配置没有后来新增的字段，读取时用默认值补齐；
	// 更早的版本用 enabled 布尔值表示开关，读取时换成 mode 并丢掉 enabled。
	const parsedDirectorConfig = readStoredDirectorConfig(
		JSON.parse(row.director_config) as unknown,
	);
	const parsedHistoryBlockPolicy: unknown = JSON.parse(
		row.history_block_policy,
	);
	assertHistoryBlockPolicy(parsedHistoryBlockPolicy);
	return {
		storyId: row.story_id,
		cardName: row.card_name,
		characterPrompt: row.character_prompt,
		persona: row.persona,
		templateId: row.template_id,
		model: row.model,
		budgetTokens: row.budget_tokens,
		structuredOutput: row.structured_output,
		temperature: row.temperature,
		maxTokens: row.max_tokens,
		reasoning: row.reasoning,
		turnMode: row.turn_mode,
		maxReadRounds: row.max_read_rounds,
		deepMaxToolCalls: row.deep_max_tool_calls,
		deepTimeoutMs: row.deep_timeout_ms,
		deepContextTokenLimit: row.deep_context_token_limit,
		deepRecentToolSteps: row.deep_recent_tool_steps,
		viewpoint: row.viewpoint,
		directorConfig: parsedDirectorConfig,
		directorOrganization: assertDirectorOrganizationKind(
			row.director_organization,
			`故事 ${row.story_id} 的 directorOrganization`,
		),
		historyBlockPolicy: parsedHistoryBlockPolicy,
		contextLayout: assertContextLayout(
			row.context_layout,
			`故事 ${row.story_id} 的 contextLayout`,
		),
		sceneLogEnabled: readBooleanColumn(
			row.scene_log_enabled,
			`故事 ${row.story_id} 的 scene_log_enabled`,
		),
		gapPassEnabled: readBooleanColumn(
			row.gap_pass_enabled,
			`故事 ${row.story_id} 的 gap_pass_enabled`,
		),
		gapPlanSeconds: row.gap_plan_seconds,
		imageConfig: readStoredImageConfig(row.image_config),
		pluginOverrides: parseStoryPluginOverrides(
			JSON.parse(row.plugin_overrides) as unknown,
		),
		worldModel: assertWorldModelKind(
			row.world_model,
			`故事 ${row.story_id} 的 worldModel`,
		),
		importMode: assertImportMode(
			row.import_mode,
			`故事 ${row.story_id} 的 importMode`,
		),
		blueprintSpoilers: assertBlueprintSpoilerMode(
			row.blueprint_spoilers,
			`故事 ${row.story_id} 的 blueprintSpoilers`,
		),
		featureTier: assertFeatureTier(
			row.feature_tier,
			`故事 ${row.story_id} 的 featureTier`,
		),
		featureSwitches: assertFeatureSwitchOverrides(
			JSON.parse(row.feature_switches) as unknown,
			`故事 ${row.story_id} 的 featureSwitches`,
		),
		updatedAt: row.updated_at,
	};
}

function readStoredImageConfig(value: string | null): ImageConfig {
	if (value === null || value.trim().length === 0) return DEFAULT_IMAGE_CONFIG;
	return assertImageConfig(JSON.parse(value) as unknown);
}

function rowToContextTemplate(row: ContextTemplateRow): ContextTemplateRecord {
	const parsed: unknown = JSON.parse(row.template);
	assertStoredContextTemplate(parsed as ContextTemplateRecord["template"]);
	return {
		id: row.id,
		name: row.name,
		template: parsed as ContextTemplateRecord["template"],
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function readStoredDirectorConfig(value: unknown): DirectorConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("故事设置的 director_config 必须是对象");
	}
	const { enabled, ...stored } = value as Record<string, unknown>;
	if (stored.mode === undefined && enabled !== undefined) {
		if (typeof enabled !== "boolean") {
			throw new Error("旧导演配置的 enabled 必须是布尔值");
		}
		stored.mode = enabled ? "transparent" : "off";
	}
	const config: DirectorConfig = {
		...DEFAULT_DIRECTOR_CONFIG,
		...(stored as Partial<DirectorConfig>),
	};
	assertDirectorConfig(config);
	return config;
}

function serializeDirectorConfig(config: DirectorConfig): string {
	rejectUnknownKeys(
		config as unknown as Record<string, unknown>,
		DIRECTOR_CONFIG_KEYS,
		"故事设置的 directorConfig",
	);
	const defined: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(config)) {
		if (value !== undefined) defined[key] = value;
	}
	return serializeJsonValue(defined, "故事设置的 directorConfig");
}

function serializeHistoryBlockPolicy(policy: HistoryBlockPolicy): string {
	assertHistoryBlockPolicy(policy, "故事设置的 historyBlockPolicy");
	return JSON.stringify(policy);
}

function rowToPluginInstallation(
	row: PluginInstallationRow,
): CodePluginInstallationRecord {
	const manifest = parseCodePluginManifest(
		JSON.parse(row.manifest) as unknown,
		`插件 ${row.name} 的安装记录`,
	);
	if (manifest.name !== row.name || manifest.version !== row.version) {
		throw new Error(`插件 ${row.name} 的安装记录与清单的名称或版本不一致`);
	}
	return {
		name: row.name,
		version: row.version,
		manifest,
		grantedPermissions: parseCodePluginPermissions(
			JSON.parse(row.granted_permissions) as unknown,
			`插件 ${row.name} 的已授予权限`,
		),
		source: assertCodePluginInstallSource(
			{ kind: row.source_kind, spec: row.source_spec },
			`插件 ${row.name} 的安装来源`,
		),
		installedAt: row.installed_at,
	};
}

export class StoriesRepo extends StoreRepo {
	createStory(input: CreateStoryInput): Story {
		assertNonEmptyString(input.title, "故事标题");
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "故事 id");
		const createdAt = input.createdAt ?? new Date().toISOString();
		if (this.getStory(id)) {
			throw new Error(`故事已存在：${id}`);
		}
		this.db
			.prepare("INSERT INTO stories (id, title, created_at) VALUES (?, ?, ?)")
			.run(id, input.title, createdAt);
		const story = this.getStory(id);
		if (!story) {
			throw new Error(`故事写入后读取失败：${id}`);
		}
		return story;
	}

	getStory(id: string): Story | null {
		const row = this.db
			.prepare(
				"SELECT id, title, created_at FROM stories WHERE id = ? AND archived_at IS NULL",
			)
			.get(id) as StoryRow | undefined;
		return row ? rowToStory(row) : null;
	}

	updateStoryTitle(id: string, title: string): Story {
		assertNonEmptyString(title, "故事标题");
		if (!this.getStory(id)) {
			throw new Error(`故事不存在：${id}`);
		}
		this.db
			.prepare(
				"UPDATE stories SET title = ? WHERE id = ? AND archived_at IS NULL",
			)
			.run(title, id);
		const story = this.getStory(id);
		if (!story) {
			throw new Error(`故事更新后读取失败：${id}`);
		}
		return story;
	}

	archiveStory(id: string): void {
		if (!this.getStory(id)) {
			throw new Error(`故事不存在：${id}`);
		}
		this.db
			.prepare(
				"UPDATE stories SET archived_at = ? WHERE id = ? AND archived_at IS NULL",
			)
			.run(new Date().toISOString(), id);
	}

	listStories(): Story[] {
		const rows = this.db
			.prepare(
				"SELECT id, title, created_at FROM stories WHERE archived_at IS NULL ORDER BY rowid ASC",
			)
			.all() as StoryRow[];
		return rows.map(rowToStory);
	}

	/**
	 * 写入一张故事图片。同位置同名重复写入覆盖文件引用，用于重新导入同一张卡。
	 * 事务由调用方负责：一次导入的删除与写入要一起生效。
	 */
	insertStoryMedia(
		storyId: string,
		input: NewStoryMediaInput,
	): StoryMediaRecord {
		assertNonEmptyString(storyId, "故事 id");
		assertNewStoryMediaInput(input);
		if (this.getStory(storyId) === null) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO story_media
					(story_id, slot, name, file_name, media_type, byte_size, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (story_id, slot, name) DO UPDATE SET
					file_name = excluded.file_name,
					media_type = excluded.media_type,
					byte_size = excluded.byte_size,
					created_at = excluded.created_at`,
			)
			.run(
				storyId,
				input.slot,
				input.name,
				input.fileName,
				input.mediaType,
				input.byteSize,
				createdAt,
			);
		const saved = this.getStoryMedia(storyId, input.slot, input.name);
		if (saved === null) {
			throw new Error(
				`故事媒体写入后读取失败：${storyId}/${input.slot}/${input.name}`,
			);
		}
		return saved;
	}

	/** 删除一个故事的全部图片记录；返回删除的行数。 */
	clearStoryMedia(storyId: string): number {
		assertNonEmptyString(storyId, "故事 id");
		return this.db
			.prepare("DELETE FROM story_media WHERE story_id = ?")
			.run(storyId).changes;
	}

	getStoryMedia(
		storyId: string,
		slot: StoryMediaSlot,
		name: string,
	): StoryMediaRecord | null {
		assertNonEmptyString(storyId, "故事 id");
		assertNonEmptyString(name, "故事媒体名称");
		if (!isStoryMediaSlot(slot)) {
			throw new Error(`故事媒体位置不合法：${String(slot)}`);
		}
		const row = this.db
			.prepare(
				"SELECT * FROM story_media WHERE story_id = ? AND slot = ? AND name = ?",
			)
			.get(storyId, slot, name) as StoryMediaRow | undefined;
		return row === undefined ? null : rowToStoryMedia(row);
	}

	/** 故事的图片记录；不传位置时返回封面与全部立绘。 */
	listStoryMedia(storyId: string, slot?: StoryMediaSlot): StoryMediaRecord[] {
		assertNonEmptyString(storyId, "故事 id");
		if (slot !== undefined && !isStoryMediaSlot(slot)) {
			throw new Error(`故事媒体位置不合法：${String(slot)}`);
		}
		const rows =
			slot === undefined
				? (this.db
						.prepare(
							"SELECT * FROM story_media WHERE story_id = ? ORDER BY slot ASC, name ASC",
						)
						.all(storyId) as StoryMediaRow[])
				: (this.db
						.prepare(
							`SELECT * FROM story_media
							WHERE story_id = ? AND slot = ?
							ORDER BY name ASC`,
						)
						.all(storyId, slot) as StoryMediaRow[]);
		return rows.map(rowToStoryMedia);
	}

	/** 读取一个代码插件的安装记录；没有安装过时返回 null。 */
	getCodePluginInstallation(name: string): CodePluginInstallationRecord | null {
		assertNonEmptyString(name, "插件名称");
		const row = this.db
			.prepare("SELECT * FROM plugin_installations WHERE name = ?")
			.get(name) as PluginInstallationRow | undefined;
		return row === undefined ? null : rowToPluginInstallation(row);
	}

	listCodePluginInstallations(): CodePluginInstallationRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM plugin_installations ORDER BY name")
			.all() as PluginInstallationRow[];
		return rows.map(rowToPluginInstallation);
	}

	/** 写入或更新安装记录；安装与升级都覆盖同一行。 */
	saveCodePluginInstallation(
		record: CodePluginInstallationRecord,
	): CodePluginInstallationRecord {
		const manifest = parseCodePluginManifest(record.manifest, "安装记录的清单");
		if (manifest.name !== record.name || manifest.version !== record.version) {
			throw new Error(
				`安装记录的名称或版本与清单不一致：${record.name}@${record.version}`,
			);
		}
		const grantedPermissions = parseCodePluginPermissions(
			record.grantedPermissions,
			"安装记录已授予的权限",
		);
		const changes = diffCodePluginPermissions(
			grantedPermissions,
			manifest.permissions,
		);
		if (changes.added.length > 0 || changes.removed.length > 0) {
			throw new Error(
				`安装记录已授予的权限与清单声明的权限不一致：${manifest.name}`,
			);
		}
		const source = assertCodePluginInstallSource(
			record.source,
			"安装记录的来源",
		);
		assertNonEmptyString(record.installedAt, "安装记录的安装时间");
		this.db
			.prepare(
				`INSERT INTO plugin_installations
					(name, version, manifest, granted_permissions, source_kind, source_spec, installed_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (name) DO UPDATE SET
					version = excluded.version,
					manifest = excluded.manifest,
					granted_permissions = excluded.granted_permissions,
					source_kind = excluded.source_kind,
					source_spec = excluded.source_spec,
					installed_at = excluded.installed_at`,
			)
			.run(
				manifest.name,
				manifest.version,
				JSON.stringify(manifest),
				JSON.stringify(manifest.permissions),
				source.kind,
				source.spec,
				record.installedAt,
			);
		const saved = this.getCodePluginInstallation(manifest.name);
		if (saved === null) {
			throw new Error(`安装记录写入后读取失败：${manifest.name}`);
		}
		return saved;
	}

	/** 删除安装记录；插件卸载时调用，记录不存在时返回 false。 */
	deleteCodePluginInstallation(name: string): boolean {
		assertNonEmptyString(name, "插件名称");
		const result = this.db
			.prepare("DELETE FROM plugin_installations WHERE name = ?")
			.run(name);
		return result.changes > 0;
	}

	/** 故事没有保存过设置时返回默认值，不写入数据库。 */
	getStorySettings(storyId: string): StorySettings {
		assertNonEmptyString(storyId, "故事 id");
		const story = this.getStory(storyId);
		if (!story) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM story_settings WHERE story_id = ?")
			.get(storyId) as StorySettingsRow | undefined;
		if (row) return rowToStorySettings(row);
		return {
			storyId,
			cardName: null,
			characterPrompt: null,
			persona: null,
			templateId: null,
			model: null,
			budgetTokens: DEFAULT_STORY_SETTINGS_VALUES.budgetTokens,
			structuredOutput: DEFAULT_STORY_SETTINGS_VALUES.structuredOutput,
			temperature: DEFAULT_STORY_SETTINGS_VALUES.temperature,
			maxTokens: DEFAULT_STORY_SETTINGS_VALUES.maxTokens,
			reasoning: DEFAULT_STORY_SETTINGS_VALUES.reasoning,
			turnMode: DEFAULT_STORY_SETTINGS_VALUES.turnMode,
			maxReadRounds: DEFAULT_STORY_SETTINGS_VALUES.maxReadRounds,
			deepMaxToolCalls: DEFAULT_STORY_SETTINGS_VALUES.deepMaxToolCalls,
			deepTimeoutMs: DEFAULT_STORY_SETTINGS_VALUES.deepTimeoutMs,
			deepContextTokenLimit:
				DEFAULT_STORY_SETTINGS_VALUES.deepContextTokenLimit,
			deepRecentToolSteps: DEFAULT_STORY_SETTINGS_VALUES.deepRecentToolSteps,
			viewpoint: null,
			directorConfig: DEFAULT_STORY_SETTINGS_VALUES.directorConfig,
			directorOrganization: DEFAULT_STORY_SETTINGS_VALUES.directorOrganization,
			historyBlockPolicy: DEFAULT_STORY_SETTINGS_VALUES.historyBlockPolicy,
			contextLayout: DEFAULT_STORY_SETTINGS_VALUES.contextLayout,
			sceneLogEnabled: DEFAULT_STORY_SETTINGS_VALUES.sceneLogEnabled,
			gapPassEnabled: DEFAULT_STORY_SETTINGS_VALUES.gapPassEnabled,
			gapPlanSeconds: DEFAULT_STORY_SETTINGS_VALUES.gapPlanSeconds,
			imageConfig: DEFAULT_STORY_SETTINGS_VALUES.imageConfig,
			pluginOverrides: DEFAULT_STORY_SETTINGS_VALUES.pluginOverrides,
			worldModel: DEFAULT_STORY_SETTINGS_VALUES.worldModel,
			importMode: DEFAULT_STORY_SETTINGS_VALUES.importMode,
			blueprintSpoilers: DEFAULT_STORY_SETTINGS_VALUES.blueprintSpoilers,
			featureTier: DEFAULT_STORY_SETTINGS_VALUES.featureTier,
			featureSwitches: DEFAULT_STORY_SETTINGS_VALUES.featureSwitches,
			updatedAt: story.createdAt,
		};
	}

	/** 故事是否保存过设置；没有保存时 `getStorySettings` 返回默认值。 */
	hasStorySettings(storyId: string): boolean {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const row = this.db
			.prepare("SELECT 1 AS present FROM story_settings WHERE story_id = ?")
			.get(storyId) as { readonly present: number } | undefined;
		return row !== undefined;
	}

	/** 合并式更新；`null` 清空可空字段，未出现的字段保持原值。 */
	updateStorySettings(
		storyId: string,
		update: StorySettingsUpdate,
	): StorySettings {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		rejectUnknownKeys(
			update as unknown as Record<string, unknown>,
			STORY_SETTINGS_UPDATE_KEYS,
			"故事设置",
		);
		assertStorySettingsUpdate(update);
		if (
			update.templateId !== undefined &&
			update.templateId !== null &&
			update.templateId !== DEFAULT_CONTEXT_TEMPLATE_ID &&
			!this.getContextTemplate(update.templateId)
		) {
			throw new Error(`上下文模板不存在：${update.templateId}`);
		}
		const current = this.getStorySettings(storyId);
		const next = {
			cardName:
				update.cardName !== undefined ? update.cardName : current.cardName,
			characterPrompt:
				update.characterPrompt !== undefined
					? update.characterPrompt
					: current.characterPrompt,
			persona: update.persona !== undefined ? update.persona : current.persona,
			templateId:
				update.templateId !== undefined
					? update.templateId
					: current.templateId,
			model: update.model !== undefined ? update.model : current.model,
			budgetTokens:
				update.budgetTokens !== undefined
					? update.budgetTokens
					: current.budgetTokens,
			structuredOutput:
				update.structuredOutput !== undefined
					? update.structuredOutput
					: current.structuredOutput,
			temperature:
				update.temperature !== undefined
					? update.temperature
					: current.temperature,
			maxTokens:
				update.maxTokens !== undefined ? update.maxTokens : current.maxTokens,
			reasoning:
				update.reasoning !== undefined ? update.reasoning : current.reasoning,
			turnMode:
				update.turnMode !== undefined ? update.turnMode : current.turnMode,
			maxReadRounds:
				update.maxReadRounds !== undefined
					? update.maxReadRounds
					: current.maxReadRounds,
			deepMaxToolCalls:
				update.deepMaxToolCalls !== undefined
					? update.deepMaxToolCalls
					: current.deepMaxToolCalls,
			deepTimeoutMs:
				update.deepTimeoutMs !== undefined
					? update.deepTimeoutMs
					: current.deepTimeoutMs,
			deepContextTokenLimit:
				update.deepContextTokenLimit !== undefined
					? update.deepContextTokenLimit
					: current.deepContextTokenLimit,
			deepRecentToolSteps:
				update.deepRecentToolSteps !== undefined
					? update.deepRecentToolSteps
					: current.deepRecentToolSteps,
			viewpoint:
				update.viewpoint !== undefined ? update.viewpoint : current.viewpoint,
			directorConfig:
				update.directorConfig !== undefined
					? update.directorConfig
					: current.directorConfig,
			directorOrganization:
				update.directorOrganization !== undefined
					? update.directorOrganization
					: current.directorOrganization,
			historyBlockPolicy:
				update.historyBlockPolicy !== undefined
					? update.historyBlockPolicy
					: current.historyBlockPolicy,
			contextLayout:
				update.contextLayout !== undefined
					? update.contextLayout
					: current.contextLayout,
			sceneLogEnabled:
				update.sceneLogEnabled !== undefined
					? update.sceneLogEnabled
					: current.sceneLogEnabled,
			gapPassEnabled:
				update.gapPassEnabled !== undefined
					? update.gapPassEnabled
					: current.gapPassEnabled,
			gapPlanSeconds:
				update.gapPlanSeconds !== undefined
					? update.gapPlanSeconds
					: current.gapPlanSeconds,
			imageConfig:
				update.imageConfig !== undefined
					? update.imageConfig
					: current.imageConfig,
			pluginOverrides:
				update.pluginOverrides !== undefined
					? update.pluginOverrides
					: current.pluginOverrides,
			worldModel:
				update.worldModel !== undefined
					? update.worldModel
					: current.worldModel,
			importMode:
				update.importMode !== undefined
					? update.importMode
					: current.importMode,
			blueprintSpoilers:
				update.blueprintSpoilers !== undefined
					? update.blueprintSpoilers
					: current.blueprintSpoilers,
			featureTier:
				update.featureTier !== undefined
					? update.featureTier
					: current.featureTier,
			featureSwitches:
				update.featureSwitches === undefined
					? update.featureTier === undefined
						? current.featureSwitches
						: EMPTY_FEATURE_SWITCH_OVERRIDES
					: update.featureSwitches === null
						? EMPTY_FEATURE_SWITCH_OVERRIDES
						: {
								...(update.featureTier === undefined
									? current.featureSwitches
									: EMPTY_FEATURE_SWITCH_OVERRIDES),
								...update.featureSwitches,
							},
		};
		const updatedAt = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO story_settings
					(story_id, card_name, character_prompt, persona, template_id, model,
					 budget_tokens, structured_output, temperature, max_tokens, reasoning,
					 turn_mode, max_read_rounds, deep_max_tool_calls, deep_timeout_ms,
					 deep_context_token_limit, deep_recent_tool_steps, viewpoint,
					 director_config, history_block_policy, context_layout, scene_log_enabled,
					 gap_pass_enabled, gap_plan_seconds, image_config, plugin_overrides,
					 world_model, director_organization, import_mode, blueprint_spoilers,
					 feature_tier, feature_switches, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(story_id) DO UPDATE SET
					card_name = excluded.card_name,
					character_prompt = excluded.character_prompt,
					persona = excluded.persona,
					template_id = excluded.template_id,
					model = excluded.model,
					budget_tokens = excluded.budget_tokens,
					structured_output = excluded.structured_output,
					temperature = excluded.temperature,
					max_tokens = excluded.max_tokens,
					reasoning = excluded.reasoning,
					turn_mode = excluded.turn_mode,
					max_read_rounds = excluded.max_read_rounds,
					deep_max_tool_calls = excluded.deep_max_tool_calls,
					deep_timeout_ms = excluded.deep_timeout_ms,
					deep_context_token_limit = excluded.deep_context_token_limit,
					deep_recent_tool_steps = excluded.deep_recent_tool_steps,
					viewpoint = excluded.viewpoint,
					director_config = excluded.director_config,
					history_block_policy = excluded.history_block_policy,
					context_layout = excluded.context_layout,
					scene_log_enabled = excluded.scene_log_enabled,
					gap_pass_enabled = excluded.gap_pass_enabled,
					gap_plan_seconds = excluded.gap_plan_seconds,
					image_config = excluded.image_config,
					plugin_overrides = excluded.plugin_overrides,
					world_model = excluded.world_model,
					director_organization = excluded.director_organization,
					import_mode = excluded.import_mode,
					blueprint_spoilers = excluded.blueprint_spoilers,
					feature_tier = excluded.feature_tier,
					feature_switches = excluded.feature_switches,
					updated_at = excluded.updated_at`,
			)
			.run(
				storyId,
				next.cardName,
				next.characterPrompt,
				next.persona,
				next.templateId,
				next.model,
				next.budgetTokens,
				next.structuredOutput,
				next.temperature,
				next.maxTokens,
				next.reasoning,
				next.turnMode,
				next.maxReadRounds,
				next.deepMaxToolCalls,
				next.deepTimeoutMs,
				next.deepContextTokenLimit,
				next.deepRecentToolSteps,
				next.viewpoint,
				serializeDirectorConfig(next.directorConfig),
				serializeHistoryBlockPolicy(next.historyBlockPolicy),
				next.contextLayout,
				next.sceneLogEnabled ? 1 : 0,
				next.gapPassEnabled ? 1 : 0,
				next.gapPlanSeconds,
				serializeJsonValue(next.imageConfig, "故事设置的 imageConfig"),
				serializeJsonValue(
					parseStoryPluginOverrides(next.pluginOverrides),
					"故事设置的 pluginOverrides",
				),
				next.worldModel,
				next.directorOrganization,
				next.importMode,
				next.blueprintSpoilers,
				next.featureTier,
				serializeJsonValue(
					assertFeatureSwitchOverrides(
						next.featureSwitches,
						"故事设置的 featureSwitches",
					),
					"故事设置的 featureSwitches",
				),
				updatedAt,
			);
		if (next.importMode !== current.importMode) {
			this.store.clearContextPacks(storyId);
		}
		const saved = this.getStorySettings(storyId);
		if (saved.updatedAt !== updatedAt) {
			throw new Error(`故事设置写入后读取失败：${storyId}`);
		}
		return saved;
	}

	createContextTemplate(
		input: CreateContextTemplateInput,
	): ContextTemplateRecord {
		const name = requireTemplateName(input.name);
		assertStoredContextTemplate(input.template);
		if (this.#findTemplateIdByName(name) !== null) {
			throw new Error(`上下文模板名称已存在：${name}`);
		}
		const id = randomUUID();
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO context_templates (id, name, template, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				name,
				serializeJsonValue(input.template, "上下文模板"),
				now,
				now,
			);
		const saved = this.getContextTemplate(id);
		if (!saved) {
			throw new Error(`上下文模板写入后读取失败：${id}`);
		}
		return saved;
	}

	getContextTemplate(id: string): ContextTemplateRecord | null {
		assertNonEmptyString(id, "上下文模板 id");
		const row = this.db
			.prepare("SELECT * FROM context_templates WHERE id = ?")
			.get(id) as ContextTemplateRow | undefined;
		return row ? rowToContextTemplate(row) : null;
	}

	listContextTemplates(): ContextTemplateRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM context_templates ORDER BY rowid ASC")
			.all() as ContextTemplateRow[];
		return rows.map(rowToContextTemplate);
	}

	updateContextTemplate(
		id: string,
		update: UpdateContextTemplateInput,
	): ContextTemplateRecord {
		const current = this.getContextTemplate(id);
		if (!current) {
			throw new Error(`上下文模板不存在：${id}`);
		}
		rejectUnknownKeys(
			update as unknown as Record<string, unknown>,
			CONTEXT_TEMPLATE_UPDATE_KEYS,
			"上下文模板更新",
		);
		if (update.name === undefined && update.template === undefined) {
			throw new Error("上下文模板更新至少要包含 name 或 template");
		}
		const name =
			update.name === undefined
				? current.name
				: requireTemplateName(update.name);
		if (name !== current.name) {
			const existingId = this.#findTemplateIdByName(name);
			if (existingId !== null && existingId !== id) {
				throw new Error(`上下文模板名称已存在：${name}`);
			}
		}
		const template = update.template ?? current.template;
		assertStoredContextTemplate(template);
		this.db
			.prepare(
				`UPDATE context_templates
				SET name = ?, template = ?, updated_at = ?
				WHERE id = ?`,
			)
			.run(
				name,
				serializeJsonValue(template, "上下文模板"),
				new Date().toISOString(),
				id,
			);
		const saved = this.getContextTemplate(id);
		if (!saved) {
			throw new Error(`上下文模板更新后读取失败：${id}`);
		}
		return saved;
	}

	/** 仍被故事设置引用的模板不能删除，否则运行时会找不到模板。 */
	deleteContextTemplate(id: string): void {
		if (!this.getContextTemplate(id)) {
			throw new Error(`上下文模板不存在：${id}`);
		}
		const storyId = this.findStoryUsingContextTemplate(id);
		if (storyId !== null) {
			throw new Error(`上下文模板 ${id} 仍被故事 ${storyId} 引用，不能删除`);
		}
		this.db.prepare("DELETE FROM context_templates WHERE id = ?").run(id);
	}

	/** 返回引用该模板的第一个故事 id；没有引用时返回 null。 */
	findStoryUsingContextTemplate(id: string): string | null {
		const row = this.db
			.prepare(
				"SELECT story_id FROM story_settings WHERE template_id = ? LIMIT 1",
			)
			.get(id) as { readonly story_id: string } | undefined;
		return row ? row.story_id : null;
	}

	#findTemplateIdByName(name: string): string | null {
		const row = this.db
			.prepare("SELECT id FROM context_templates WHERE name = ?")
			.get(name) as { readonly id: string } | undefined;
		return row ? row.id : null;
	}

	/** 故事级的小配置：写作选项、卡的固定版本、提前备好的结果等。 */
	getStoryValue(storyId: string, key: string): JsonValue | null {
		const row = this.db
			.prepare("SELECT value FROM story_kv WHERE story_id = ? AND key = ?")
			.get(storyId, key) as { value: string } | undefined;
		return row === undefined ? null : (JSON.parse(row.value) as JsonValue);
	}

	setStoryValue(storyId: string, key: string, value: JsonValue | null): void {
		if (value === null) {
			this.db
				.prepare("DELETE FROM story_kv WHERE story_id = ? AND key = ?")
				.run(storyId, key);
			return;
		}
		this.db
			.prepare(
				`INSERT INTO story_kv (story_id, key, value, updated_at) VALUES (?, ?, ?, ?)
				ON CONFLICT (story_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			)
			.run(storyId, key, JSON.stringify(value), new Date().toISOString());
	}
}
