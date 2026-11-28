import type { ImportEntryKind, ImportMode } from "@dramaticer/core";
import type { StorySandboxView } from "@dramaticer/protocol";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ImageSettings } from "./ImageSettings";
import { ImportInto } from "./ImportInto";
import {
	Cover,
	Seg,
	Sw,
	errorText,
	formatTokens,
	sp,
	useAct,
	useLoad,
	useToast,
} from "./ui";

interface Entry {
	readonly id: string;
	readonly source: string;
	readonly name: string;
	readonly content: string;
	readonly constant: boolean;
	readonly keywords: readonly string[];
	readonly kind: ImportEntryKind;
	readonly tokens: number;
	readonly edited: boolean;
	readonly disabled: boolean;
	readonly locked: boolean;
	readonly memory: boolean;
}

interface LoreView {
	readonly cardName: string | null;
	readonly importMode: ImportMode;
	readonly entries: readonly Entry[];
	readonly kinds: readonly { kind: ImportEntryKind; count: number }[];
	readonly fixedTokens: { before: number; after: number };
}

interface EditRecord {
	readonly id: number;
	readonly value: { readonly content?: string } | null;
	readonly disabled: boolean;
	readonly source: "player" | "restore" | "ai" | "rejected";
	readonly note: string | null;
	readonly createdAt: string;
}

const EDIT_SOURCE: Record<EditRecord["source"], string> = {
	player: "你改的",
	restore: "恢复原卡",
	ai: "卡升级",
	rejected: "被挡下的写入",
};

const BRIDGE_LABEL: Readonly<Record<string, string>> = {
	sendMessage: "发送消息",
	fillInput: "填入输入框",
	readState: "读状态",
	writeState: "写状态",
	openImage: "看图片",
};

const KIND: Record<string, { label: string; color: string; when: string }> = {
	common: { label: "常识", color: "--ink", when: "每一轮都带" },
	entity: { label: "人物地点", color: "--teal", when: "在场或被提到时" },
	rule: { label: "规则", color: "--gold-ink", when: "涉及这条规则时" },
	state: { label: "数值", color: "--gold", when: "由程序记账，不占正文" },
	conditional: { label: "有条件", color: "--ok", when: "条件满足之后" },
	event: { label: "事件", color: "--bad", when: "交给导演，成为剧情线" },
	writing: { label: "文风", color: "--muted", when: "整体开关" },
	presentation: { label: "素材", color: "--line", when: "显示用，不进正文" },
	options: { label: "选项", color: "--teal", when: "作者留下的选项" },
	"plugin-residue": { label: "插件残留", color: "--soft", when: "不使用" },
	unknown: { label: "未分类", color: "--soft", when: "按关键词命中时" },
};

/** 设定页：这个故事自己的设定副本，改它不影响卡库里的原卡。 */
export function Lore() {
	const { storyId = "" } = useParams();
	const act = useAct();
	const toast = useToast();
	const story = useLoad(() => api.getStory(storyId), [storyId]);
	const lore = useLoad<LoreView>(
		() => api.get(sp(storyId, "/lore-copy")),
		[storyId],
	);
	const sandbox = useLoad<StorySandboxView>(
		() => api.getStorySandbox(storyId),
		[storyId],
	);
	const [filter, setFilter] = useState<string>("all");
	const [importing, setImporting] = useState(false);
	const [open, setOpen] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [preview, setPreview] = useState<{
		id: string;
		kind: string;
		condition: string;
		hit: boolean;
		reason: string;
	} | null>(null);
	const [history, setHistory] = useState<{
		id: string;
		edits: readonly EditRecord[];
	} | null>(null);
	const [search] = useSearchParams();
	const entryParam = search.get("entry");
	// 从上下文跳过来时，打开这一条并翻到它。
	useEffect(() => {
		if (entryParam === null || lore.data === null) return;
		const entry = lore.data.entries.find((item) => item.id === entryParam);
		if (entry === undefined) return;
		setOpen(entry.id);
		setDraft(entry.content);
		document
			.getElementById(`entry-${entry.id}`)
			?.scrollIntoView({ block: "center" });
	}, [entryParam, lore.data]);

	if (lore.error !== null) return <div className="v4err">{lore.error}</div>;
	if (lore.data === null) return <p className="v4empty">正在读取设定…</p>;
	const data = lore.data;
	const sandboxData = sandbox.data;
	const title = story.data?.title ?? "";
	const shown = data.entries.filter(
		(entry) => filter === "all" || entry.kind === filter,
	);
	const options = data.entries.filter((entry) => entry.kind === "options");
	const edited = data.entries.filter(
		(entry) => entry.edited || entry.disabled,
	).length;

	const save = (entry: Entry, body: Record<string, unknown>, message: string) =>
		act(
			() =>
				api.call(
					"POST",
					sp(storyId, `/lore-copy/${encodeURIComponent(entry.id)}`),
					body,
				),
			() => {
				lore.reload();
				toast(message);
			},
		);

	const loadHistory = (entry: Entry) =>
		api
			.get<{ edits: readonly EditRecord[] }>(
				sp(
					storyId,
					`/memory/history?kind=lore&target=${encodeURIComponent(entry.id)}`,
				),
			)
			.then((result) => setHistory({ id: entry.id, edits: result.edits }))
			.catch((error: unknown) => {
				setHistory(null);
				toast(errorText(error));
			});

	const rollback = (entry: Entry, editId: number) =>
		act(
			() => api.call("POST", sp(storyId, "/memory/rollback"), { editId }),
			() => {
				lore.reload();
				void loadHistory(entry);
				toast("已回到那一版");
			},
		);

	const toggleDomain = (domain: string, allowed: boolean) =>
		act(
			() => api.updateSandboxDomain(storyId, domain, allowed),
			() => {
				sandbox.reload();
				toast(allowed ? `已允许 ${domain}` : `已取消允许 ${domain}`);
			},
		);

	const toggleRenderer = (id: string, name: string, enabled: boolean) =>
		act(
			() => api.setFloorRendererEnabled(storyId, id, enabled),
			() => {
				sandbox.reload();
				toast(enabled ? `已开启 ${name}` : `已关闭 ${name}，正文按原文显示`);
			},
		);

	return (
		<section data-view="lore">
			<div className="vh">
				<div className="ttl" style={{ alignItems: "flex-start" }}>
					<Cover storyId={storyId} title={title} style={{ width: 64 }} />
					<div>
						<h1>设定 · {data.cardName ?? title}</h1>
						<p>
							共 {data.entries.length} 条，改的是这个故事自己的副本。
							{edited > 0 ? `你改过 ${edited} 条。` : ""}
						</p>
					</div>
				</div>
				<div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
					<Seg<ImportMode>
						label="导入方式"
						value={data.importMode}
						options={[
							{ v: "upgrade", label: "优化" },
							{ v: "raw", label: "原样" },
						]}
						onChange={(value) =>
							act(
								() => api.updateSettings(storyId, { importMode: value }),
								() => {
									lore.reload();
									toast(value === "raw" ? "已切到原样" : "已切到优化");
								},
							)
						}
					/>
					<button
						type="button"
						className="btn"
						onClick={() =>
							act(
								() => api.call("POST", sp(storyId, "/lore-copy/restore")),
								() => {
									lore.reload();
									toast("已恢复成卡的原样");
								},
							)
						}
					>
						恢复原卡
					</button>
					<button
						type="button"
						className="btn"
						aria-expanded={importing}
						onClick={() => setImporting((value) => !value)}
					>
						导入
					</button>
				</div>
			</div>
			{importing ? (
				<ImportInto
					storyId={storyId}
					onDone={() => {
						lore.reload();
						story.reload();
					}}
				/>
			) : null}
			<div className="audit">
				<div>
					<div
						className="bar"
						role="img"
						aria-label={`${data.entries.length} 条的类型分布`}
					>
						{data.kinds.map((item) => (
							<i
								key={item.kind}
								style={{
									flex: item.count,
									background: `var(${KIND[item.kind]?.color ?? "--soft"})`,
								}}
								title={`${KIND[item.kind]?.label ?? item.kind} ${item.count}`}
							/>
						))}
					</div>
					<div className="audit-legend" aria-label="类型图例">
						{data.kinds.map((item) => (
							<span key={item.kind} className="legenditem">
								<i
									style={{
										background: `var(${KIND[item.kind]?.color ?? "--soft"})`,
									}}
								/>
								<span>{KIND[item.kind]?.label ?? item.kind}</span>
								<span className="num">{item.count}</span>
							</span>
						))}
					</div>
				</div>
				<div className="cost">
					<span className="label">每轮固定带入</span>
					<span className="big was num">
						{formatTokens(data.fixedTokens.before)}
					</span>
					<span className="arrow">→</span>
					<span className="big num">
						{formatTokens(data.fixedTokens.after)}
					</span>
				</div>
			</div>
			<section className="sandbox-perms" aria-label="卡片脚本与联网">
				<h2>卡片脚本与联网</h2>
				<p>卡里的脚本要用某个域名时，先在这里允许。允许名单只属于这个故事。</p>
				{sandbox.error !== null ? (
					<p className="v4err">{sandbox.error}</p>
				) : sandboxData === null ? (
					<p className="muted">正在读取…</p>
				) : (
					<>
						<div className="sandbox-block">
							<h3>楼层渲染器</h3>
							{sandboxData.renderers.length === 0 ? (
								<p className="muted">这张卡没有声明楼层渲染插件。</p>
							) : (
								<ul>
									{sandboxData.renderers.map((renderer) => (
										<li key={renderer.id}>
											<div className="sandbox-renderer-info">
												<b>{renderer.name}</b>
												<span className="muted">
													{" · "}
													{renderer.permissions.length === 0
														? "只显示，不调用界面"
														: renderer.permissions
																.map((item) => BRIDGE_LABEL[item] ?? item)
																.join("、")}
												</span>
											</div>
											<Sw
												checked={renderer.enabled}
												label={`启用 ${renderer.name}`}
												onChange={(value) =>
													toggleRenderer(renderer.id, renderer.name, value)
												}
											/>
										</li>
									))}
								</ul>
							)}
						</div>
						<div className="sandbox-block">
							<h3>脚本里出现的域名</h3>
							{sandboxData.detectedDomains.length === 0 ? (
								<p className="muted">没有检测到外部域名。</p>
							) : (
								<ul className="domainlist">
									{sandboxData.detectedDomains.map((domain) => (
										<li key={domain}>
											<span>{domain}</span>
											<Sw
												checked={sandboxData.allowedDomains.includes(domain)}
												label={`允许 ${domain}`}
												onChange={(value) => toggleDomain(domain, value)}
											/>
										</li>
									))}
								</ul>
							)}
						</div>
					</>
				)}
			</section>
			<div className="filters">
				<button
					type="button"
					className="chip"
					aria-pressed={filter === "all"}
					onClick={() => setFilter("all")}
				>
					全部
				</button>
				{data.kinds.map((item) => (
					<button
						type="button"
						className="chip"
						key={item.kind}
						aria-pressed={filter === item.kind}
						onClick={() => setFilter(item.kind)}
					>
						{KIND[item.kind]?.label ?? item.kind} {item.count}
					</button>
				))}
			</div>
			<div id="entries">
				{shown.length === 0 ? (
					<p style={{ color: "var(--muted)", padding: "14px 0" }}>
						{data.entries.length === 0
							? "这个故事还没有设定。导入一张卡或世界书。"
							: "这一类里没有条目。"}
					</p>
				) : null}
				{shown.slice(0, 300).map((entry) => (
					<div className="entry" key={entry.id} id={`entry-${entry.id}`}>
						{/* biome-ignore lint/a11y/useKeyWithClickEvents: 展开入口，里面的控件都能用键盘 */}
						<div
							className="head"
							onClick={(event) => {
								if ((event.target as HTMLElement).closest(".sw")) return;
								setOpen(open === entry.id ? null : entry.id);
								setDraft(entry.content);
								setPreview(null);
								setHistory(null);
							}}
						>
							<div>
								<h3>
									{entry.name}{" "}
									<span className="pill mute">
										{KIND[entry.kind]?.label ?? entry.kind}
									</span>{" "}
									{entry.edited ? (
										<span className="pill gold">你改的</span>
									) : null}
									{entry.memory ? (
										<span className="pill mute">初始记忆</span>
									) : null}
								</h3>
								<div className="when">
									什么时候带上：
									{entry.constant
										? "每一轮都带"
										: entry.keywords.length > 0
											? `提到「${entry.keywords.slice(0, 4).join("、")}」时`
											: (KIND[entry.kind]?.when ?? "命中时")}
								</div>
							</div>
							<Sw
								checked={!entry.disabled}
								label={`启用 ${entry.name}`}
								onChange={(enabled) =>
									save(
										entry,
										{ disabled: !enabled },
										enabled ? "已启用" : "已停用，只影响这个故事",
									)
								}
							/>
						</div>
						{open === entry.id ? (
							<div className="edit">
								<textarea
									value={draft}
									onChange={(event) => setDraft(event.target.value)}
								/>
								<div className="row">
									<span className="label">类型</span>
									<select
										value={entry.kind}
										onChange={(event) =>
											act(
												() =>
													api.updateImportAuditEntry(storyId, entry.source, {
														kind: event.target.value as ImportEntryKind,
													}),
												() => {
													lore.reload();
													toast("类型已改，下一轮生效");
												},
											)
										}
									>
										{Object.entries(KIND).map(([kind, info]) => (
											<option key={kind} value={kind}>
												{info.label}
											</option>
										))}
									</select>
									<label className="fine">
										<input
											type="checkbox"
											checked={entry.constant}
											onChange={(event) =>
												save(
													entry,
													{ constant: event.target.checked },
													"生效条件已改",
												)
											}
										/>{" "}
										每一轮都带
									</label>
									<input
										className="v4in"
										style={{ width: 220 }}
										defaultValue={entry.keywords.join("、")}
										placeholder="关键词，用顿号隔开"
										onBlur={(event) => {
											const keywords = event.target.value
												.split(/[、,，]/)
												.map((word) => word.trim())
												.filter((word) => word !== "");
											if (keywords.join("、") !== entry.keywords.join("、")) {
												void save(entry, { keywords }, "生效条件已改");
											}
										}}
									/>
									<button
										type="button"
										className="btn sm gold"
										onClick={() =>
											save(
												entry,
												{ content: draft },
												"已保存，下一轮生效。只改了这个故事的副本",
											)
										}
									>
										保存
									</button>
									<button
										type="button"
										className="btn sm"
										onClick={() =>
											api
												.get<{
													kind: string;
													condition: string;
													hit: boolean;
													reason: string;
												}>(
													sp(
														storyId,
														`/lore-copy/${encodeURIComponent(entry.id)}/preview`,
													),
												)
												.then((result) =>
													setPreview({
														id: entry.id,
														kind: result.kind,
														condition: result.condition,
														hit: result.hit,
														reason: result.reason,
													}),
												)
												.catch((error: unknown) => toast(errorText(error)))
										}
									>
										现在会带上吗
									</button>
									<button
										type="button"
										className="btn sm"
										onClick={() =>
											history?.id === entry.id
												? setHistory(null)
												: void loadHistory(entry)
										}
									>
										修改历史
									</button>
									{entry.kind === "plugin-residue" ? (
										<button
											type="button"
											className="btn sm"
											aria-pressed={entry.memory}
											onClick={() =>
												act(
													() =>
														api.updateImportAuditEntryMemory(
															storyId,
															entry.source,
															{ memory: !entry.memory },
														),
													() => {
														lore.reload();
														toast(entry.memory ? "已撤销" : "已转为初始记忆");
													},
												)
											}
										>
											{entry.memory ? "撤销转换" : "转为初始记忆"}
										</button>
									) : null}
									{entry.edited || entry.disabled ? (
										<button
											type="button"
											className="btn sm"
											onClick={() =>
												save(
													entry,
													{ restore: true },
													"这一条已恢复成原卡的样子",
												)
											}
										>
											恢复这一条
										</button>
									) : null}
								</div>
								{preview?.id === entry.id ? (
									<div className="when">
										类型：{KIND[preview.kind]?.label ?? preview.kind} · 条件：
										{preview.condition} ·{" "}
										{preview.hit ? "这一轮会带上" : "这一轮不会带上"}：
										{preview.reason}
									</div>
								) : null}
								{history?.id === entry.id ? (
									<div className="when">
										{history.edits.length === 0
											? "还没有修改记录。"
											: history.edits.map((edit, index) => (
													<div key={edit.id}>
														<span>
															#{edit.id} {EDIT_SOURCE[edit.source]}
														</span>{" "}
														<span>
															{edit.disabled
																? "已停用"
																: (edit.value?.content ?? "恢复原卡")}
														</span>{" "}
														{index < history.edits.length - 1 ? (
															<button
																type="button"
																className="btn sm"
																onClick={() => rollback(entry, edit.id)}
															>
																回到这一版
															</button>
														) : null}
													</div>
												))}
									</div>
								) : null}
							</div>
						) : null}
					</div>
				))}
			</div>
			{options.length > 0 ? (
				<>
					<div className="label" style={{ marginTop: 22 }}>
						作者留下的选项
					</div>
					<div className="rows">
						{options.map((entry) => (
							<div key={entry.id}>
								<span>{entry.name}</span>
								<span>
									<Sw
										checked={!entry.disabled}
										label={entry.name}
										onChange={(enabled) =>
											save(
												entry,
												{ disabled: !enabled },
												enabled ? "已打开" : "已关掉",
											)
										}
									/>
								</span>
							</div>
						))}
					</div>
				</>
			) : null}
			<ImageSettings storyId={storyId} />
		</section>
	);
}
