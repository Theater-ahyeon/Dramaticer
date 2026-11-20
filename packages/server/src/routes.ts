import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type AssistantDocsIndex,
	type AssistantSearchClient,
	type ImagesConfig,
	type LlmChannel,
	type LlmChannelConfig,
	type StoryStore,
	readStoryFeatureView,
} from "@dramaticer/core";
import { isProposalDecisionAction } from "@dramaticer/protocol";
import type { AssistantRuntimeManager } from "./assistant-runtime.js";
import {
	type AssistantCompactionCoordinator,
	type AssistantRunCoordinator,
	handleAssistantRequest,
} from "./assistant.js";
import type { BackgroundScheduler } from "./background.js";
import { HttpError, sendJson } from "./http.js";
import {
	applyChannelsActionPayload,
	handleChannelProbe,
	handleChannels,
	readAssistantChannelsSnapshot,
} from "./routes-channels.js";
import { pathSegments, requireMethod, requireStory } from "./routes-common.js";
import {
	handleImageFile,
	handleImageProviders,
	handleImageRetry,
	handleImageWorkflowDelete,
	handleImageWorkflowDetect,
	handleImageWorkflowImport,
	handleImageWorkflows,
	handleNodeImageList,
	handleNodeImages,
	handleStoryCover,
	handleStoryPortrait,
} from "./routes-media.js";
import { handleNextStoryRoute } from "./routes-next.js";
import {
	handleCreateProposal,
	handleNodeActions,
	handleNodeChoice,
	handleNodeCompressions,
	handleNodeDirector,
	handleNodeEvents,
	handleNodeLedger,
	handleNodeRun,
	handleNodeText,
	handleNodeTrace,
	handleProposalDecision,
	handleProposals,
} from "./routes-nodes.js";
import {
	handleBlueprintDeviation,
	handleBlueprintSuggestionDecision,
	handleBlueprintSuggestions,
	handleDirectorPlan,
	handleStoryBlueprint,
	handleStoryBlueprintEdit,
	handleStoryBlueprintVersions,
} from "./routes-outline.js";
import {
	handleImportAudit,
	handleImportAuditEntryMemory,
	handleImportAuditEntryUpdate,
	handleImportAuditMemoryConvert,
	handleImportAuditSuggestions,
	handleOpeningGenerate,
	handleOpeningPick,
	handleOpenings,
	handleSettings,
	handleStoryTemplate,
	handleStoryVisualProfiles,
	handleStoryVisualProfilesGenerate,
	handleTemplate,
	handleTemplates,
} from "./routes-setup.js";
import {
	handleClueFulfill,
	handleEntities,
	handleHead,
	handleImport,
	handleJobs,
	handleLore,
	handlePath,
	handleStories,
	handleStory,
	handleStoryClues,
	handleStorySerial,
	handleStorySerialExport,
	handleTree,
} from "./routes-stories.js";
import {
	handleNodeCorrect,
	handleRegenerate,
	handleRetry,
	handleSceneControl,
	handleTurnSteering,
	handleTurns,
} from "./routes-turns.js";
import type { StoryRuntimeManager } from "./runtime.js";
import type { TurnCoordinator, TurnRunRegistry } from "./turns.js";

export interface ApiRouteOptions {
	readonly store: StoryStore;
	readonly maxJsonBodyBytes: number;
	readonly runtime: StoryRuntimeManager | null;
	/** 助手运行时；没有配置渠道时为 null。 */
	readonly assistantRuntime: AssistantRuntimeManager | null;
	readonly assistantRuns: AssistantRunCoordinator;
	readonly assistantCompactions: AssistantCompactionCoordinator;
	readonly docsIndex: AssistantDocsIndex;
	readonly assistantSearch: AssistantSearchClient | null;
	readonly turns: TurnCoordinator;
	readonly runs: TurnRunRegistry;
	readonly scheduler?: BackgroundScheduler | null;
	readonly log: (line: string) => void;
	readonly heartbeatMs: number;
	readonly now?: () => number;
	/** 渠道配置文件的路径；没有配置时管理接口返回 404。 */
	readonly channelsPath: string | null;
	readonly channelsEnv: Readonly<Record<string, string | undefined>>;
	/** 生图配置文件的路径；没有配置时 provider 列表为空。 */
	readonly imagesPath: string | null;
	readonly imagesEnv: Readonly<Record<string, string | undefined>>;
	readonly imagesConfig: ImagesConfig;
	/** 生成文件目录；媒体接口只在这里读取。 */
	readonly imagesMediaDir: string;
	/** 渠道体检用；测试注入假通道。 */
	readonly createChannel: (config: LlmChannelConfig) => LlmChannel;
}

/** 处理 `/api` 下的故事、导入、设置与模板接口；不认识的路径返回 404。 */
export async function handleApiRequest(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
	method: string,
	options: ApiRouteOptions,
): Promise<void> {
	if (!url.pathname.startsWith("/api/")) {
		throw new HttpError(404, "not_found", "没有这个接口");
	}
	if (
		url.pathname === "/api/assistant" ||
		url.pathname.startsWith("/api/assistant/")
	) {
		await handleAssistantRequest(req, res, url, method, {
			store: options.store,
			maxJsonBodyBytes: options.maxJsonBodyBytes,
			runtime: options.assistantRuntime,
			runs: options.assistantRuns,
			compactions: options.assistantCompactions,
			docsIndex: options.docsIndex,
			searchClient: options.assistantSearch,
			readChannelsView:
				options.channelsPath === null
					? undefined
					: async () => await readAssistantChannelsSnapshot(options),
			heartbeatMs: options.heartbeatMs,
			applyChannelsAction:
				options.channelsPath === null
					? undefined
					: async (payload) => {
							await applyChannelsActionPayload(payload, options);
						},
			now: options.now,
			log: options.log,
		});
		return;
	}
	const parts = pathSegments(url.pathname);
	const [first, second, third] = parts;
	if (first === "stories") {
		if (second === undefined) {
			await handleStories(req, res, method, options);
			return;
		}
		const storyId = second;
		if (third === undefined) {
			await handleStory(req, res, method, options, storyId);
			return;
		}
		if (third === "turns" && parts.length === 5 && parts[4] === "steering") {
			const runId = parts[3];
			if (runId === undefined) {
				throw new HttpError(404, "not_found", "没有这个接口");
			}
			requireMethod(method, ["POST"]);
			await handleTurnSteering(req, res, options, storyId, runId);
			return;
		}
		if (third === "media" && parts.length === 4 && parts[3] === "cover") {
			requireMethod(method, ["GET"]);
			await handleStoryCover(res, options, storyId);
			return;
		}
		if (
			third === "media" &&
			parts.length === 5 &&
			parts[3] === "portrait" &&
			parts[4] !== undefined
		) {
			requireMethod(method, ["GET"]);
			await handleStoryPortrait(res, options, storyId, parts[4]);
			return;
		}
		if (parts.length === 3) {
			switch (third) {
				case "import":
					await handleImport(req, res, method, options, storyId);
					return;
				case "turns":
					requireMethod(method, ["POST"]);
					await handleTurns(req, res, options, storyId);
					return;
				case "settings":
					await handleSettings(req, res, method, options, storyId);
					return;
				case "template":
					requireMethod(method, ["GET"]);
					handleStoryTemplate(res, options, storyId);
					return;
				case "features":
					requireMethod(method, ["GET"]);
					requireStory(options.store, storyId);
					sendJson(res, 200, readStoryFeatureView(options.store, storyId));
					return;
				case "jobs":
					requireMethod(method, ["GET"]);
					handleJobs(res, options, storyId);
					return;
				case "tree":
					requireMethod(method, ["GET"]);
					handleTree(res, options, storyId);
					return;
				case "path":
					requireMethod(method, ["GET"]);
					handlePath(res, options, url, storyId);
					return;
				case "head":
					requireMethod(method, ["POST"]);
					await handleHead(req, res, options, storyId);
					return;
				case "clues":
					requireMethod(method, ["GET"]);
					handleStoryClues(res, options, storyId);
					return;
				case "serial":
					requireMethod(method, ["GET"]);
					handleStorySerial(res, options, storyId, url);
					return;
				case "blueprint":
					requireMethod(method, ["GET"]);
					handleStoryBlueprint(res, options, storyId, url);
					return;
				case "entities":
					requireMethod(method, ["GET"]);
					handleEntities(res, options, storyId);
					return;
				case "lore":
					requireMethod(method, ["GET"]);
					handleLore(res, options, storyId);
					return;
				case "proposals":
					if (method === "POST") {
						await handleCreateProposal(req, res, options, storyId);
						return;
					}
					requireMethod(method, ["GET"]);
					handleProposals(res, options, url, storyId);
					return;
				case "openings":
					requireMethod(method, ["GET"]);
					handleOpenings(res, options, url, storyId);
					return;
				case "visual-profiles":
					requireMethod(method, ["GET"]);
					handleStoryVisualProfiles(res, options, storyId);
					return;
				default:
					break;
			}
		}
		if (third === "openings" && parts.length === 4 && parts[3] === "generate") {
			requireMethod(method, ["POST"]);
			handleOpeningGenerate(res, options, storyId);
			return;
		}
		if (third === "serial" && parts.length === 4 && parts[3] === "export") {
			requireMethod(method, ["GET"]);
			handleStorySerialExport(res, options, storyId, url);
			return;
		}
		if (third === "blueprint" && parts.length === 4 && parts[3] === "edit") {
			requireMethod(method, ["POST"]);
			await handleStoryBlueprintEdit(req, res, options, storyId);
			return;
		}
		if (
			third === "blueprint" &&
			parts.length === 4 &&
			parts[3] === "versions"
		) {
			requireMethod(method, ["GET"]);
			handleStoryBlueprintVersions(res, options, storyId, url);
			return;
		}
		if (
			third === "blueprint" &&
			parts.length === 4 &&
			parts[3] === "suggestions"
		) {
			await handleBlueprintSuggestions(req, res, method, options, url, storyId);
			return;
		}
		if (
			third === "blueprint" &&
			parts.length === 4 &&
			parts[3] === "deviation"
		) {
			requireMethod(method, ["GET"]);
			handleBlueprintDeviation(res, options, storyId);
			return;
		}
		if (
			third === "openings" &&
			parts.length === 5 &&
			parts[4] === "pick" &&
			parts[3] !== undefined
		) {
			requireMethod(method, ["POST"]);
			handleOpeningPick(res, options, storyId, parts[3]);
			return;
		}
		if (
			third === "visual-profiles" &&
			parts.length === 4 &&
			parts[3] === "generate"
		) {
			requireMethod(method, ["POST"]);
			handleStoryVisualProfilesGenerate(res, options, storyId);
			return;
		}
		if (
			await handleNextStoryRoute(req, res, method, options, storyId, parts, url)
		) {
			return;
		}
		if (third === "director" && parts.length === 4 && parts[3] === "plan") {
			await handleDirectorPlan(req, res, method, options, storyId);
			return;
		}
		if (third === "import-audit") {
			if (parts.length === 3) {
				requireMethod(method, ["GET"]);
				handleImportAudit(res, options, storyId);
				return;
			}
			if (parts.length === 4 && parts[3] === "suggestions") {
				requireMethod(method, ["POST"]);
				handleImportAuditSuggestions(res, options, storyId);
				return;
			}
			if (parts.length === 4 && parts[3] === "memory") {
				requireMethod(method, ["POST"]);
				handleImportAuditMemoryConvert(res, options, storyId);
				return;
			}
			if (
				parts.length === 6 &&
				parts[3] === "entries" &&
				parts[4] !== undefined &&
				parts[5] === "memory"
			) {
				requireMethod(method, ["PUT"]);
				await handleImportAuditEntryMemory(
					req,
					res,
					options,
					storyId,
					parts[4],
				);
				return;
			}
			if (
				parts.length === 5 &&
				parts[3] === "entries" &&
				parts[4] !== undefined
			) {
				requireMethod(method, ["PATCH"]);
				await handleImportAuditEntryUpdate(
					req,
					res,
					options,
					storyId,
					parts[4],
				);
				return;
			}
		}
	}
	if (first === "channels") {
		if (second === undefined && parts.length === 1) {
			await handleChannels(req, res, method, options);
			return;
		}
		if (second === "probe" && parts.length === 2) {
			requireMethod(method, ["POST"]);
			await handleChannelProbe(req, res, options);
			return;
		}
	}
	if (first === "images") {
		if (second === "providers" && parts.length === 2) {
			requireMethod(method, ["GET"]);
			await handleImageProviders(res, options);
			return;
		}
		if (second === "workflows") {
			if (parts.length === 2) {
				requireMethod(method, ["GET"]);
				handleImageWorkflows(res, options);
				return;
			}
			if (parts.length === 3 && third === "detect") {
				requireMethod(method, ["POST"]);
				await handleImageWorkflowDetect(req, res, options);
				return;
			}
			if (parts.length === 3 && third === "import") {
				requireMethod(method, ["POST"]);
				await handleImageWorkflowImport(req, res, options);
				return;
			}
			if (parts.length === 3) {
				requireMethod(method, ["DELETE"]);
				handleImageWorkflowDelete(res, options, third);
				return;
			}
		}
		if (parts.length === 3 && third === "retry") {
			requireMethod(method, ["POST"]);
			handleImageRetry(res, options, second);
			return;
		}
		if (parts.length === 3 && third === "file") {
			requireMethod(method, ["GET"]);
			await handleImageFile(res, options, second);
			return;
		}
	}
	if (first === "proposals" && second !== undefined && parts.length === 3) {
		const action = third;
		if (isProposalDecisionAction(action)) {
			requireMethod(method, ["POST"]);
			await handleProposalDecision(res, options, second, action);
			return;
		}
	}
	if (
		first === "blueprint-suggestions" &&
		second !== undefined &&
		parts.length === 3 &&
		(third === "accept" || third === "reject")
	) {
		requireMethod(method, ["POST"]);
		await handleBlueprintSuggestionDecision(req, res, options, second, third);
		return;
	}
	if (first === "nodes" && second !== undefined && parts.length === 3) {
		const nodeId = second;
		switch (third) {
			case "swipe":
				requireMethod(method, ["POST"]);
				await handleNodeText(req, res, options, nodeId, "swipe");
				return;
			case "edit":
				requireMethod(method, ["POST"]);
				await handleNodeText(req, res, options, nodeId, "edit");
				return;
			case "choice":
				requireMethod(method, ["POST"]);
				await handleNodeChoice(req, res, options, nodeId);
				return;
			case "correct":
				requireMethod(method, ["POST"]);
				await handleNodeCorrect(req, res, options, nodeId);
				return;
			case "scene-control":
				requireMethod(method, ["POST"]);
				await handleSceneControl(req, res, options, nodeId);
				return;
			case "regenerate":
				requireMethod(method, ["POST"]);
				await handleRegenerate(req, res, options, nodeId);
				return;
			case "retry":
				requireMethod(method, ["POST"]);
				await handleRetry(req, res, options, nodeId);
				return;
			case "trace":
				requireMethod(method, ["GET"]);
				handleNodeTrace(res, options, nodeId);
				return;
			case "run":
				requireMethod(method, ["GET"]);
				handleNodeRun(res, options, nodeId);
				return;
			case "ledger":
				requireMethod(method, ["GET"]);
				handleNodeLedger(res, options, nodeId);
				return;
			case "events":
				requireMethod(method, ["GET"]);
				handleNodeEvents(res, options, url, nodeId);
				return;
			case "compressions":
				requireMethod(method, ["GET"]);
				handleNodeCompressions(res, options, nodeId);
				return;
			case "director":
				requireMethod(method, ["GET"]);
				handleNodeDirector(res, options, nodeId);
				return;
			case "actions":
				requireMethod(method, ["GET"]);
				handleNodeActions(res, options, nodeId);
				return;
			case "images":
				requireMethod(method, ["GET", "POST"]);
				if (method === "GET") {
					handleNodeImageList(res, options, nodeId);
					return;
				}
				await handleNodeImages(req, res, options, nodeId);
				return;
			default:
				break;
		}
	}
	if (first === "clues" && second !== undefined && parts.length === 3) {
		if (third === "fulfill") {
			requireMethod(method, ["POST"]);
			await handleClueFulfill(req, res, options, second);
			return;
		}
	}
	if (first === "templates") {
		if (second === undefined) {
			await handleTemplates(req, res, method, options);
			return;
		}
		if (third === undefined) {
			await handleTemplate(req, res, method, options, second);
			return;
		}
	}
	throw new HttpError(404, "not_found", "没有这个接口");
}
