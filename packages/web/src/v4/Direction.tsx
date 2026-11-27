import type {
	BlueprintSuggestionOperation,
	BlueprintTension,
	DirectionOpenItem,
	DirectionView,
	DirectionWantItem,
} from "@dramaticer/core";
import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { usePaletteCommands } from "./Shell";
import { Editable, Seg, Tog, useAct, useLoad, useToast } from "./ui";

const OPERATIONS: readonly {
	op: BlueprintSuggestionOperation;
	label: string;
}[] = [
	{ op: "complete", label: "补全" },
	{ op: "find-flaws", label: "找漏洞" },
	{ op: "three-directions", label: "三种走向" },
	{ op: "expand-volume", label: "展开这一卷" },
];

function sourcePill(source: "player" | "ai"): [string, string] | null {
	return source === "ai" ? ["teal", "AI 写的"] : null;
}

function WantRow({
	item,
	busy,
	onEdit,
	onLock,
	onDelete,
}: {
	readonly item: DirectionWantItem;
	readonly busy: boolean;
	readonly onEdit: (text: string) => void;
	readonly onLock?: (locked: boolean) => void;
	readonly onDelete: () => void;
}) {
	const pill = sourcePill(item.source);
	return (
		<div
			className={`dirrow want kind-${item.kind}${item.done ? " done" : ""}`}
			data-id={item.id}
			data-kind={item.kind}
		>
			<div className="dirbody">
				<div className="dirtags">
					<span className="pill mute">{item.label}</span>
					{pill === null ? null : (
						<span className={`pill ${pill[0]}`}>{pill[1]}</span>
					)}
					{item.done ? <span className="pill ok">已达成</span> : null}
				</div>
				<Editable
					as="h3"
					value={item.text}
					placeholder="点这里写"
					onCommit={onEdit}
				/>
				{item.detail === null ? null : <p className="sub">{item.detail}</p>}
				{onLock === undefined && !item.deletable ? null : (
					<div className="dirctl">
						{onLock === undefined ? null : (
							<button
								type="button"
								className="lock"
								aria-pressed={item.locked}
								disabled={busy}
								onClick={() => onLock(!item.locked)}
							>
								{item.locked ? "已锁定" : "锁定"}
							</button>
						)}
						{item.deletable ? (
							<button
								type="button"
								className="btn ghost sm"
								disabled={busy}
								onClick={onDelete}
							>
								{item.kind === "line" ? "完成" : "删除"}
							</button>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
}

function OpenRow({
	item,
	busy,
	onEdit,
	onLock,
	onClose,
}: {
	readonly item: DirectionOpenItem;
	readonly busy: boolean;
	readonly onEdit: (text: string) => void;
	readonly onLock: (locked: boolean) => void;
	readonly onClose: () => void;
}) {
	const pill = sourcePill(item.source);
	return (
		<div
			className={`dirrow open kind-${item.kind}${item.muted ? " off" : ""}`}
			data-id={item.id}
			data-kind={item.kind}
		>
			<div className="dirbody">
				<div className="dirtags">
					<span className="pill mute">{item.label}</span>
					{pill === null ? null : (
						<span className={`pill ${pill[0]}`}>{pill[1]}</span>
					)}
					{item.muted ? <span className="pill mute">已静音</span> : null}
				</div>
				<Editable
					as="h3"
					value={item.text}
					placeholder="点这里写"
					onCommit={onEdit}
				/>
				{item.detail === null ? null : <p className="sub">{item.detail}</p>}
				<div className="dirctl">
					<button
						type="button"
						className="lock"
						aria-pressed={item.locked}
						disabled={busy}
						onClick={() => onLock(!item.locked)}
					>
						{item.locked ? "已锁定" : "锁定"}
					</button>
					<button
						type="button"
						className="btn ghost sm"
						disabled={busy}
						onClick={onClose}
					>
						已收
					</button>
				</div>
			</div>
		</div>
	);
}

/** 两栏：想发生的、还没收的线。大纲页与停靠栏共用。 */
export function DirectionPanel({
	storyId,
	compact = false,
	tick = 0,
	onChanged,
}: {
	readonly storyId: string;
	readonly compact?: boolean;
	readonly tick?: number;
	readonly onChanged?: () => void;
}) {
	const act = useAct();
	const view = useLoad<DirectionView>(
		() => api.getDirection(storyId),
		[storyId, tick],
	);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);

	const run = useCallback(
		(request: Parameters<typeof api.editDirection>[1]) => {
			setBusy(true);
			void act(
				() => api.editDirection(storyId, request),
				() => {
					setBusy(false);
					view.reload();
					onChanged?.();
				},
			).then((ok) => {
				if (!ok) setBusy(false);
			});
		},
		[act, onChanged, storyId, view],
	);

	if (view.error !== null) return <div className="v4err">{view.error}</div>;
	if (view.data === null) return <p className="v4empty">正在读取…</p>;
	const data = view.data;

	return (
		<>
			{compact ? null : (
				<div className="dirhead">
					<span className="label">约束</span>
					<Seg<BlueprintTension>
						label="剧情走向的约束"
						value={data.tension}
						options={[
							{ v: "loose", label: "弱" },
							{ v: "medium", label: "中" },
							{ v: "tight", label: "强" },
						]}
						onChange={(tension) => run({ op: "set-tension", tension })}
					/>
					<Tog
						pressed={data.spoilers === "hide"}
						onChange={(hide) =>
							act(
								() =>
									api.updateSettings(storyId, {
										blueprintSpoilers: hide ? "hide" : "show",
									}),
								view.reload,
							)
						}
					>
						隐藏 AI 写的
					</Tog>
				</div>
			)}
			<div className={compact ? "dirgrid compact" : "dirgrid"}>
				<section className="dircol" data-column="wants" aria-label="想发生的">
					<div className="dircolhead">
						<h2>想发生的</h2>
						{data.hidden === null ? null : (
							<p className="v4empty">AI 另有 {data.hidden.total} 条已隐藏。</p>
						)}
					</div>
					{data.wants.length === 0 ? <p className="v4empty">暂无内容</p> : null}
					{data.wants.map((item) => (
						<WantRow
							key={item.id}
							item={item}
							busy={busy}
							onEdit={(text) => run({ op: "edit-want", id: item.id, text })}
							onLock={
								item.id === "premise:tone" || item.id === "premise:red-lines"
									? undefined
									: (locked) => run({ op: "lock-want", id: item.id, locked })
							}
							onDelete={() => run({ op: "delete-want", id: item.id })}
						/>
					))}
					{data.canAdd ? (
						<div className="diradd">
							<input
								value={draft}
								placeholder="写下一件想看到的事"
								onChange={(event) => setDraft(event.target.value)}
								onKeyDown={(event) => {
									if (event.key !== "Enter" || draft.trim() === "") return;
									run({ op: "add-want", text: draft.trim() });
									setDraft("");
								}}
							/>
							<button
								type="button"
								className="btn sm"
								disabled={busy || draft.trim() === ""}
								onClick={() => {
									run({ op: "add-want", text: draft.trim() });
									setDraft("");
								}}
							>
								加上
							</button>
						</div>
					) : null}
				</section>
				<section className="dircol" data-column="opens" aria-label="还没收的线">
					<div className="dircolhead">
						<h2>还没收的线</h2>
					</div>
					{data.opens.length === 0 ? <p className="v4empty">暂无内容</p> : null}
					{data.opens.map((item) => (
						<OpenRow
							key={item.id}
							item={item}
							busy={busy}
							onEdit={(text) => run({ op: "edit-open", id: item.id, text })}
							onLock={(locked) => run({ op: "lock-open", id: item.id, locked })}
							onClose={() => run({ op: "close-open", id: item.id })}
						/>
					))}
				</section>
			</div>
		</>
	);
}

/** 剧情走向页：两栏加 AI 建议与修改历史。 */
export function DirectionPage() {
	const { storyId = "" } = useParams();
	const act = useAct();
	const toast = useToast();
	const suggestions = useLoad(
		() => api.getBlueprintSuggestions(storyId, "pending"),
		[storyId],
	);
	const versions = useLoad(() => api.getBlueprintVersions(storyId), [storyId]);
	const [idea, setIdea] = useState("");

	usePaletteCommands(
		useCallback(
			() => [
				{
					label: "让 AI 补全剧情走向",
					run: () => {
						void api
							.requestBlueprintSuggestions(storyId, { operation: "complete" })
							.then(() => toast("已经交给后台"))
							.catch(() => toast("没能交给后台"));
					},
				},
				{
					label: "让 AI 找剧情走向的漏洞",
					run: () => {
						void api
							.requestBlueprintSuggestions(storyId, {
								operation: "find-flaws",
							})
							.then(() => toast("已经交给后台"))
							.catch(() => toast("没能交给后台"));
					},
				},
			],
			[storyId, toast],
		),
	);

	const ask = (operation: BlueprintSuggestionOperation) =>
		act(
			() =>
				api.requestBlueprintSuggestions(storyId, {
					operation,
					...(idea.trim() === "" ? {} : { note: idea.trim() }),
				}),
			() => {
				toast("已经交给后台");
				setTimeout(() => suggestions.reload(), 6000);
				setTimeout(() => suggestions.reload(), 20000);
			},
		);

	return (
		<section data-view="direction">
			<div className="vh">
				<h1>剧情走向</h1>
			</div>
			<DirectionPanel storyId={storyId} />

			<div className="dirside">
				<div className="dirask">
					<input
						value={idea}
						placeholder="补充想法（可选）"
						onChange={(event) => setIdea(event.target.value)}
					/>
					{OPERATIONS.map((item) => (
						<button
							type="button"
							key={item.op}
							className="btn sm"
							onClick={() => ask(item.op)}
						>
							{item.label}
						</button>
					))}
				</div>
				<div className="label">
					<span>AI 建议</span>
					<button
						type="button"
						className="btn ghost sm"
						onClick={suggestions.reload}
					>
						刷新
					</button>
				</div>
				{(suggestions.data?.suggestions ?? []).length === 0 ? (
					<p className="v4empty">没有待处理的建议。</p>
				) : null}
				{(suggestions.data?.suggestions ?? []).map((suggestion) => (
					<div className="dirsug" key={suggestion.id}>
						<span className="pill teal">{suggestion.title}</span>
						<p>{suggestion.reason}</p>
						<div className="dirctl">
							<button
								type="button"
								className="btn sm gold"
								onClick={() =>
									act(
										() => api.acceptBlueprintSuggestion(suggestion.id),
										() => {
											suggestions.reload();
											toast("已按建议修改");
										},
									)
								}
							>
								接受
							</button>
							<button
								type="button"
								className="btn sm"
								onClick={() =>
									act(
										() => api.rejectBlueprintSuggestion(suggestion.id),
										() => {
											suggestions.reload();
											toast("已忽略");
										},
									)
								}
							>
								不要
							</button>
						</div>
					</div>
				))}
				{(versions.data?.versions.length ?? 0) > 0 ? (
					<details>
						<summary className="label">
							修改历史 · {versions.data?.versions.length} 版
						</summary>
						<div className="rows">
							{[...(versions.data?.versions ?? [])].reverse().map((version) => (
								<div key={`${version.nodeId}-${version.seq}`}>
									<span>
										{version.source === "ai" ? "AI" : "你"} · {version.changes}{" "}
										处修改 · {new Date(version.createdAt).toLocaleString()}
									</span>
									<span>
										<button
											type="button"
											className="btn ghost sm"
											onClick={() =>
												act(
													() =>
														api.editStoryBlueprint(storyId, {
															versionNodeId: version.nodeId,
															versionSeq: version.seq,
														}),
													() => {
														versions.reload();
														toast("已回到这一版");
													},
												)
											}
										>
											回到这一版
										</button>
									</span>
								</div>
							))}
						</div>
					</details>
				) : null}
			</div>
		</section>
	);
}
