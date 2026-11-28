import type {
	CanonEventField,
	CanonPageBindingView,
	CanonPageEventView,
	CanonPageVersionView,
	CanonPageVoiceView,
	StoryCanonPageView,
} from "@dramaticer/protocol";
import {
	Fragment,
	type ReactNode,
	useCallback,
	useEffect,
	useState,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { usePaletteCommands } from "./Shell";
import {
	Editable,
	TLink,
	errorText,
	parseValue,
	showValue,
	sp,
	useLoad,
	useToast,
} from "./ui";

interface Statement {
	readonly id: string;
	readonly text: string;
	readonly floorNo: number | null;
	readonly source: "auto" | "player";
	readonly locked: boolean;
	readonly old: boolean;
	readonly validUntilFloor: number | null;
	readonly quote: string | null;
}

interface Page {
	readonly id: string;
	readonly kind: string;
	readonly name: string;
	readonly aliases: readonly string[];
	readonly uptoFloor: number;
	readonly lead: string;
	readonly leadLocked: boolean;
	readonly sections: readonly {
		readonly title: string;
		readonly statements: readonly Statement[];
	}[];
}

interface StateItem {
	readonly target: string;
	readonly path: readonly string[];
	readonly owner: string;
	readonly item: string;
	readonly value: unknown;
	readonly floorNo: number;
	readonly source: string;
	readonly locked: boolean;
	readonly history: readonly {
		readonly value: unknown;
		readonly floorNo: number;
		readonly source: string;
	}[];
}

interface Secret {
	readonly id: string;
	readonly text: string;
	readonly knowers: readonly string[];
	readonly unaware: readonly string[];
	readonly floorNo: number | null;
	readonly locked: boolean;
	readonly edited: boolean;
}

interface MemoryView {
	readonly notebook: readonly NotebookPage[];
	readonly pages: readonly Page[];
	readonly situation: { readonly text: string } | null;
	readonly state: readonly StateItem[];
	readonly secrets: readonly Secret[];
	readonly timeline: readonly {
		readonly id: string;
		readonly title: string;
		readonly floors: number;
		readonly summary: string;
		readonly present: readonly string[];
		readonly changes: readonly string[];
		readonly locked: boolean;
	}[];
	readonly prefs: readonly {
		readonly id: string;
		readonly text: string;
		readonly origin: string;
		readonly disabled: boolean;
		readonly locked: boolean;
	}[];
	readonly rejections: readonly {
		readonly id: number;
		readonly kind: string;
		readonly text: string;
		readonly reason: string;
	}[];
}

const TABS = [
	["wiki", "故事记事"],
	["canon", "原著"],
	["state", "此刻局面"],
	["secret", "秘密"],
	["line", "时间线"],
	["rule", "偏好"],
] as const;

type Tab = (typeof TABS)[number][0];

/** 把句子里出现的其他页面名字换成可以点的链接。 */
function linkify(
	text: string,
	pages: readonly Page[],
	self: string,
	open: (id: string) => void,
): ReactNode[] {
	const names = pages
		.filter((page) => page.id !== self && page.name.length > 1)
		.map((page) => ({ id: page.id, name: page.name }))
		.sort((left, right) => right.name.length - left.name.length);
	const out: ReactNode[] = [];
	let rest = text;
	let guard = 0;
	while (rest.length > 0 && guard < 200) {
		guard += 1;
		let best: { index: number; id: string; name: string } | null = null;
		for (const item of names) {
			const index = rest.indexOf(item.name);
			if (index >= 0 && (best === null || index < best.index)) {
				best = { index, ...item };
			}
		}
		if (best === null) break;
		if (best.index > 0) out.push(rest.slice(0, best.index));
		const target = best.id;
		out.push(
			<a
				key={`${guard}-${target}`}
				href={`#${target}`}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					open(target);
				}}
			>
				{best.name}
			</a>,
		);
		rest = rest.slice(best.index + best.name.length);
	}
	if (rest.length > 0) out.push(rest);
	return out;
}

/** 平时显示带链接的句子，点一下进入修改。 */
interface NotebookPage {
	readonly entityId: string;
	readonly name: string;
	readonly base: string;
	readonly now: string;
	readonly past: readonly {
		readonly text: string;
		readonly fromFloor: number | null;
		readonly toFloor: number | null;
		readonly nodeId: string | null;
	}[];
	readonly locked: readonly string[];
	readonly versionId: number;
}

interface NotebookVersionView {
	readonly id: number;
	readonly now: string;
	readonly source: string;
	readonly note: string | null;
	readonly createdAt: string;
}

const NB_SOURCE: Readonly<Record<string, string>> = {
	init: "初版",
	compile: "场末整理",
	player: "你改的",
	rollback: "回滚",
};

function anchor(from: number | null, to: number | null): string {
	if (from === null && to === null) return "";
	if (from === to || to === null) return `[F${from}]`;
	if (from === null) return `[F${to}]`;
	return `[F${from}–F${to}]`;
}

/** 记事页三节：底色、现在、经历。改过的节锁定，场末整理跳过；版本可回看与回滚。 */
function NotebookBlock({
	storyId,
	page,
	onChanged,
	duplicateBase = false,
}: {
	readonly storyId: string;
	readonly page: NotebookPage;
	readonly onChanged: () => void;
	readonly duplicateBase?: boolean;
}) {
	const toast = useToast();
	const [versions, setVersions] = useState<
		readonly NotebookVersionView[] | null
	>(null);
	const save = async (body: Record<string, unknown>) => {
		try {
			await api.call("POST", sp(storyId, "/memory/notebook"), {
				entityId: page.entityId,
				...body,
			});
			setVersions(null);
			onChanged();
			toast("已保存并锁定");
		} catch (error) {
			toast(errorText(error));
		}
	};
	const loadVersions = async () => {
		if (versions !== null) {
			setVersions(null);
			return;
		}
		try {
			const view = await api.get<{ versions: readonly NotebookVersionView[] }>(
				sp(
					storyId,
					`/memory/notebook/history?entity=${encodeURIComponent(page.entityId)}`,
				),
			);
			setVersions(view.versions);
		} catch (error) {
			toast(errorText(error));
		}
	};
	const rollback = async (versionId: number) => {
		try {
			await api.call("POST", sp(storyId, "/memory/notebook/rollback"), {
				versionId,
			});
			setVersions(null);
			onChanged();
			toast("已回到那一版");
		} catch (error) {
			toast(errorText(error));
		}
	};
	const lockButton = (section: string) => (
		<button
			type="button"
			className="lock"
			aria-pressed={page.locked.includes(section)}
			onClick={() =>
				void save({ section, locked: !page.locked.includes(section) })
			}
		>
			{page.locked.includes(section) ? "已锁定" : "锁定"}
		</button>
	);
	return (
		<section className="nb" aria-label="故事记事">
			<div className="nbsec">
				<div className="nbhead">
					<span className="label">现在</span>
					{lockButton("now")}
				</div>
				<Editable
					value={page.now}
					placeholder="现在的处境"
					onCommit={(text) => void save({ section: "now", text })}
				/>
			</div>
			<div className="nbsec">
				<div className="nbhead">
					<span className="label">底色</span>
					{lockButton("base")}
				</div>
				{duplicateBase ? (
					<Editable
						value=""
						placeholder="同上方「来自设定」，点此单独改写"
						onCommit={(text) => void save({ section: "base", text })}
					/>
				) : (
					<Editable
						value={page.base}
						placeholder="开场前的设定"
						onCommit={(text) => void save({ section: "base", text })}
					/>
				)}
			</div>
			<div className="nbsec">
				<div className="nbhead">
					<span className="label">经历</span>
					{lockButton("past")}
				</div>
				{page.past.length === 0 ? (
					<p className="muted">暂无</p>
				) : (
					<ul className="nbpast">
						{page.past.map((entry, index) => (
							<li key={`${entry.nodeId ?? ""}-${index}`}>
								<span className="num">
									{anchor(entry.fromFloor, entry.toFloor)}
								</span>{" "}
								<Editable
									as="span"
									value={entry.text}
									onCommit={(text) =>
										void save({
											section: "past",
											past: page.past.map((item, at) =>
												at === index ? { ...item, text } : item,
											),
										})
									}
								/>
							</li>
						))}
					</ul>
				)}
			</div>
			<button
				type="button"
				className="btn ghost sm"
				aria-expanded={versions !== null}
				onClick={() => void loadVersions()}
			>
				版本
			</button>
			{versions === null ? null : (
				<ol className="nbversions">
					{versions.map((version, index) => (
						<li key={version.id}>
							<span className="pill mute">
								{NB_SOURCE[version.source] ?? version.source}
							</span>{" "}
							<span>{version.now || "（现在为空）"}</span>{" "}
							{index === 0 ? null : (
								<button
									type="button"
									className="btn sm"
									onClick={() => void rollback(version.id)}
								>
									回到这一版
								</button>
							)}
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

function LinkedText({
	text,
	className,
	pages,
	self,
	open,
	onCommit,
}: {
	readonly text: string;
	readonly className?: string;
	readonly pages: readonly Page[];
	readonly self: string;
	readonly open: (id: string) => void;
	readonly onCommit: (text: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	if (!editing) {
		return (
			<p
				className={className}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: 可以聚焦后进入修改
				tabIndex={0}
				onClick={() => setEditing(true)}
				onKeyDown={(event) => {
					if (event.key === "Enter") setEditing(true);
				}}
				style={{ cursor: "text" }}
			>
				{linkify(text, pages, self, open)}
			</p>
		);
	}
	return (
		<p
			className={className}
			contentEditable
			suppressContentEditableWarning
			ref={(element) => element?.focus()}
			onBlur={(event) => {
				const next = (event.currentTarget.textContent ?? "").trim();
				setEditing(false);
				if (next !== text.trim()) onCommit(next);
			}}
			// 键盘也能完成修改：回车提交，Esc 放弃。
			onKeyDown={(event) => {
				if (event.nativeEvent.isComposing) return;
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					event.currentTarget.blur();
				}
				if (event.key === "Escape") {
					event.currentTarget.textContent = text;
					event.currentTarget.blur();
				}
			}}
		>
			{text}
		</p>
	);
}

const CANON_FIELD_LABELS: Readonly<Record<CanonEventField, string>> = {
	title: "标题",
	summary: "概要",
	digest: "缩写",
	voices: "话术",
	passage: "原文",
};

const CANON_STATE_LABELS: Readonly<
	Record<CanonPageEventView["state"], string>
> = {
	past: "已演",
	current: "当前",
	future: "未来",
};

function canonValueText(version: CanonPageVersionView): string {
	let text: string;
	if (version.field === "voices") {
		const voices = version.value as readonly CanonPageVoiceView[];
		text =
			voices.length === 0
				? "（没有话术）"
				: voices
						.map(
							(voice) =>
								`${voice.character}${voice.kind === "speech" ? "说" : "想"}：${voice.text}`,
						)
						.join("；");
	} else if (version.field === "passage") {
		const paragraphs = version.value as readonly string[];
		text = paragraphs.length === 0 ? "（没有原文）" : paragraphs.join(" / ");
	} else {
		text = version.value as string;
		if (text.trim().length === 0) text = "（空）";
	}
	return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/** 一格：标题、概要、缩写、话术或原文；带版本列表与一键撤销。 */
function CanonField({
	label,
	field,
	event,
	onRollback,
	children,
}: {
	readonly label: string;
	readonly field: CanonEventField;
	readonly event: CanonPageEventView;
	readonly onRollback: (request: {
		readonly field?: CanonEventField;
		readonly versionId?: number;
	}) => Promise<void>;
	readonly children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const versions = event.versions.filter((version) => version.field === field);
	const edited = event.editedFields.includes(field);
	return (
		<section className="canonfield" aria-label={label}>
			<div className="canonfieldhead">
				<span className="label">{label}</span>
				{edited ? <span className="pill gold">你改的</span> : null}
				<button
					type="button"
					className="btn ghost sm"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
				>
					版本 {versions.length}
				</button>
				{versions.length === 0 ? null : (
					<button
						type="button"
						className="btn ghost sm"
						onClick={() => void onRollback({ field })}
					>
						撤销
					</button>
				)}
			</div>
			{children}
			{open && versions.length > 0 ? (
				<ol className="canonversions">
					{versions.map((version, index) => (
						<li key={version.id}>
							<span className="pill mute">
								{version.source === "player" ? "你改的" : "撤销"}
							</span>{" "}
							<span className="canonvtext">{canonValueText(version)}</span>{" "}
							{index === 0 ? null : (
								<button
									type="button"
									className="btn sm"
									onClick={() => void onRollback({ versionId: version.id })}
								>
									回到这一版
								</button>
							)}
						</li>
					))}
				</ol>
			) : null}
		</section>
	);
}

/** 记忆页的原著分页：左边事件轨道，右边有效内容与按格编辑。 */
function CanonBoard({
	storyId,
	binding,
	focusEventId,
	onChanged,
}: {
	readonly storyId: string;
	readonly binding: CanonPageBindingView;
	readonly focusEventId: number | null;
	readonly onChanged: () => void;
}) {
	const toast = useToast();
	const [page, setPage] = useState(binding);
	const [selectedId, setSelectedId] = useState(
		focusEventId ?? binding.currentEventId,
	);
	const [voiceDraft, setVoiceDraft] = useState<{
		character: string;
		kind: "speech" | "thought";
		text: string;
	}>({ character: "", kind: "speech", text: "" });
	const [passageDraft, setPassageDraft] = useState("");

	useEffect(() => setPage(binding), [binding]);
	useEffect(() => {
		if (focusEventId !== null) setSelectedId(focusEventId);
	}, [focusEventId]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 换选中事件时清空草稿
	useEffect(() => {
		setVoiceDraft({ character: "", kind: "speech", text: "" });
		setPassageDraft("");
	}, [selectedId]);

	const selected =
		page.events.find((event) => event.id === selectedId) ??
		page.events.find((event) => event.id === page.currentEventId) ??
		page.events[0] ??
		null;

	const apply = (view: StoryCanonPageView) => {
		if (view.bound !== null) setPage(view.bound);
		onChanged();
	};

	const edit = async (field: CanonEventField, value: unknown) => {
		if (selected === null) return;
		try {
			const view = await api.editCanonEvent(storyId, selected.id, {
				field,
				value,
			});
			apply(view);
			toast("已保存，下一轮生效");
		} catch (error) {
			// 校验失败时把改坏的那一处恢复成服务端内容。
			onChanged();
			toast(errorText(error));
		}
	};

	const rollback = async (request: {
		readonly field?: CanonEventField;
		readonly versionId?: number;
	}) => {
		if (selected === null) return;
		try {
			const view = await api.rollbackCanonEvent(storyId, selected.id, request);
			apply(view);
			toast("已回到上一版");
		} catch (error) {
			toast(errorText(error));
		}
	};

	const startHere = async (eventId: number) => {
		try {
			await api.startCanonFromHere(storyId, { eventId });
			const view = await api.getStoryCanonPage(storyId);
			apply(view);
			setSelectedId(eventId);
			toast("已从这里开始，下一楼按这件演");
		} catch (error) {
			toast(errorText(error));
		}
	};

	const voices = selected?.voices ?? [];
	const saveVoices = (next: readonly CanonPageVoiceView[]) =>
		void edit("voices", next);

	return (
		<div className="canonpage">
			<div className="canontrack" aria-label="原著事件轨道">
				<div className="canonbook">
					<h2>{page.bookTitle}</h2>
					<span className="pill mute">第 {page.chapterCount} 章</span>
					<TLink to={`/canon/${encodeURIComponent(page.bookId)}`}>
						原著书架
					</TLink>
				</div>
				{page.events.length === 0 ? (
					<p className="v4empty">这本原著还没有排好事件时间线。</p>
				) : (
					<ol className="canonlist">
						{page.events.map((event) => (
							<li key={event.id}>
								<button
									type="button"
									aria-pressed={event.id === selected?.id}
									data-focus={`canon-${event.id}`}
									onClick={() => setSelectedId(event.id)}
								>
									<span
										className={`pill ${event.state === "current" ? "teal" : "mute"}`}
									>
										{CANON_STATE_LABELS[event.state]}
									</span>
									<span className="canontitle">{event.title}</span>
									{event.isTurningPoint ? (
										<span className="pill gold">关键转折</span>
									) : null}
									{event.editedFields.length > 0 ? (
										<span className="pill gold">已改</span>
									) : null}
									<small>第 {event.chapterOrdinal} 章</small>
								</button>
								<button
									type="button"
									className="btn ghost sm"
									onClick={() => void startHere(event.id)}
								>
									从这里开始
								</button>
							</li>
						))}
					</ol>
				)}
			</div>
			{selected === null ? (
				<p className="v4empty">选中左边的事件查看详情。</p>
			) : (
				<article className="canondetail">
					<div className="canonhead">
						<h2>{selected.title}</h2>
						<span
							className={`pill ${selected.state === "current" ? "teal" : "mute"}`}
						>
							{CANON_STATE_LABELS[selected.state]}
						</span>
						{selected.isTurningPoint ? (
							<span className="pill gold">关键转折</span>
						) : null}
						<span className="pill mute">第 {selected.chapterOrdinal} 章</span>
						<button
							type="button"
							className="btn ghost sm"
							onClick={() => void startHere(selected.id)}
						>
							从这里开始
						</button>
					</div>
					{selected.location === null ? null : (
						<p className="muted">地点：{selected.location}</p>
					)}
					{selected.timeText === null ? null : (
						<p className="muted">时间：{selected.timeText}</p>
					)}

					<CanonField
						label={CANON_FIELD_LABELS.title}
						field="title"
						event={selected}
						onRollback={rollback}
					>
						<Editable
							value={selected.title}
							onCommit={(text) => void edit("title", text)}
						/>
					</CanonField>

					<CanonField
						label={CANON_FIELD_LABELS.summary}
						field="summary"
						event={selected}
						onRollback={rollback}
					>
						<Editable
							value={selected.summary}
							onCommit={(text) => void edit("summary", text)}
						/>
					</CanonField>

					<CanonField
						label={CANON_FIELD_LABELS.digest}
						field="digest"
						event={selected}
						onRollback={rollback}
					>
						<Editable
							value={selected.digest}
							placeholder="缩写"
							onCommit={(text) => void edit("digest", text)}
						/>
					</CanonField>

					<CanonField
						label={CANON_FIELD_LABELS.voices}
						field="voices"
						event={selected}
						onRollback={rollback}
					>
						{voices.length === 0 ? (
							<p className="muted">还没有话术。</p>
						) : (
							<ul className="canonvoices">
								{voices.map((voice, index) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: 话术按顺序排列，增删后按位置改
									<li key={index}>
										<Editable
											as="span"
											className="canonwho"
											value={voice.character}
											onCommit={(text) =>
												saveVoices(
													voices.map((item, at) =>
														at === index ? { ...item, character: text } : item,
													),
												)
											}
										/>
										<select
											value={voice.kind}
											aria-label={`${voice.character}的话术类型`}
											onChange={(event_) =>
												saveVoices(
													voices.map((item, at) =>
														at === index
															? {
																	...item,
																	kind:
																		event_.target.value === "thought"
																			? "thought"
																			: "speech",
																}
															: item,
													),
												)
											}
										>
											<option value="speech">说</option>
											<option value="thought">想</option>
										</select>
										<Editable
											as="span"
											className="canonvtext"
											value={voice.text}
											onCommit={(text) =>
												saveVoices(
													voices.map((item, at) =>
														at === index ? { ...item, text } : item,
													),
												)
											}
										/>
										<button
											type="button"
											className="btn ghost sm"
											onClick={() =>
												saveVoices(voices.filter((_, at) => at !== index))
											}
										>
											删掉
										</button>
									</li>
								))}
							</ul>
						)}
						<div className="canonadd">
							<input
								value={voiceDraft.character}
								placeholder="谁"
								aria-label="话术人物"
								onChange={(event_) =>
									setVoiceDraft({
										...voiceDraft,
										character: event_.target.value,
									})
								}
							/>
							<select
								value={voiceDraft.kind}
								aria-label="新话术的类型"
								onChange={(event_) =>
									setVoiceDraft({
										...voiceDraft,
										kind:
											event_.target.value === "thought" ? "thought" : "speech",
									})
								}
							>
								<option value="speech">说</option>
								<option value="thought">想</option>
							</select>
							<input
								value={voiceDraft.text}
								placeholder="一句原话"
								aria-label="话术内容"
								onChange={(event_) =>
									setVoiceDraft({ ...voiceDraft, text: event_.target.value })
								}
							/>
							<button
								type="button"
								className="btn sm"
								disabled={
									voiceDraft.character.trim().length === 0 ||
									voiceDraft.text.trim().length === 0
								}
								onClick={() => {
									saveVoices([
										...voices,
										{
											character: voiceDraft.character.trim(),
											kind: voiceDraft.kind,
											text: voiceDraft.text.trim(),
										},
									]);
									setVoiceDraft({
										character: "",
										kind: "speech",
										text: "",
									});
								}}
							>
								加上
							</button>
						</div>
					</CanonField>

					<CanonField
						label={CANON_FIELD_LABELS.passage}
						field="passage"
						event={selected}
						onRollback={rollback}
					>
						{selected.passage.length === 0 ? (
							<p className="muted">
								{selected.hasText
									? "这一件没有对应的原文段落。"
									: "当前原著包未包含原文，可以写一段本局的参考片段。"}
							</p>
						) : (
							<div className="canonpassage">
								{selected.passage.map((paragraph, index) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: 段落按顺序排列，增删后按位置改
									<div key={index} className="canonpara">
										<Editable
											value={paragraph}
											onCommit={(text) =>
												void edit(
													"passage",
													selected.passage.map((item, at) =>
														at === index ? text : item,
													),
												)
											}
										/>
										<button
											type="button"
											className="btn ghost sm"
											onClick={() =>
												void edit(
													"passage",
													selected.passage.filter((_, at) => at !== index),
												)
											}
										>
											删掉
										</button>
									</div>
								))}
							</div>
						)}
						{!selected.hasText && selected.passage.length > 0 ? (
							<p className="muted">
								当前原著包未包含原文，这里是本局的参考片段。
							</p>
						) : null}
						<div className="canonadd">
							<textarea
								rows={2}
								value={passageDraft}
								placeholder="加一段原文或本局参考片段"
								aria-label="新原文段落"
								onChange={(event_) => setPassageDraft(event_.target.value)}
							/>
							<button
								type="button"
								className="btn sm"
								disabled={passageDraft.trim().length === 0}
								onClick={() => {
									void edit("passage", [
										...selected.passage,
										passageDraft.trim(),
									]);
									setPassageDraft("");
								}}
							>
								加一段
							</button>
						</div>
					</CanonField>
				</article>
			)}
		</div>
	);
}

/** 记忆页：百科、状态、秘密、时间线、偏好，全部可以就地修改。 */
export function Memory() {
	const { storyId = "" } = useParams();
	const [search, setSearch] = useSearchParams();
	const toast = useToast();
	const memory = useLoad<MemoryView>(
		() => api.get(sp(storyId, "/memory")),
		[storyId],
	);
	const tab = (
		TABS.some(([id]) => id === search.get("tab")) ? search.get("tab") : "wiki"
	) as Tab;
	// 原著分页只在需要时拉完整内容；其他分页只查绑定，决定要不要显示「原著」。
	const canonBinding = useLoad(() => api.getStoryCanon(storyId), [storyId]);
	const canon = useLoad(
		() =>
			tab === "canon" ? api.getStoryCanonPage(storyId) : Promise.resolve(null),
		[storyId, tab],
	);
	const pageParam = search.get("page");
	const focus = search.get("focus");
	const eventParam = search.get("event");
	const focusEventId =
		eventParam !== null && /^\d+$/.test(eventParam) ? Number(eventParam) : null;
	const [pageId, setPageId] = useState<string | null>(pageParam);
	const [raw, setRaw] = useState<ReadonlySet<string>>(new Set());
	const [history, setHistory] = useState<string | null>(null);
	const [fieldError, setFieldError] = useState<{
		key: string;
		text: string;
	} | null>(null);
	const [rule, setRule] = useState("");

	const goTab = useCallback((id: Tab) => setSearch({ tab: id }), [setSearch]);
	usePaletteCommands(
		useCallback(
			() => [
				{ label: "记忆 · 故事记事", run: () => goTab("wiki") },
				{ label: "记忆 · 原著", run: () => goTab("canon") },
				{ label: "记忆 · 此刻局面", run: () => goTab("state") },
				{ label: "记忆 · 秘密", run: () => goTab("secret") },
				{ label: "记忆 · 时间线", run: () => goTab("line") },
				{ label: "记忆 · 偏好", run: () => goTab("rule") },
			],
			[goTab],
		),
	);

	const data = memory.data;
	useEffect(() => {
		if (data === null) return;
		if (pageId === null || !data.pages.some((page) => page.id === pageId)) {
			setPageId(data.pages[0]?.id ?? null);
		}
	}, [data, pageId]);
	useEffect(() => {
		if (pageParam === null) return;
		setPageId(pageParam);
	}, [pageParam]);
	// 从上下文跳过来时，翻到这一条对应的行或语句。
	const focusReady = data !== null;
	useEffect(() => {
		if (focus === null || !focusReady) return;
		document
			.querySelector(`[data-focus="${CSS.escape(focus)}"]`)
			?.scrollIntoView({ block: "center" });
	}, [focus, focusReady]);

	/** 写一次修改；失败的原因显示在被改的那一处。 */
	const write = async (
		key: string,
		path: string,
		body: unknown,
		undo?: { path: string; body: unknown },
	) => {
		try {
			await api.call("POST", sp(storyId, path), body);
		} catch (error) {
			setFieldError({ key, text: errorText(error) });
			memory.reload();
			return;
		}
		setFieldError(null);
		memory.reload();
		toast(
			"已保存并锁定，下一轮生效",
			undo === undefined
				? undefined
				: () => {
						api
							.call("POST", sp(storyId, undo.path), undo.body)
							.then(() => memory.reload())
							.catch((error: unknown) => toast(errorText(error)));
					},
		);
	};

	const problem = (key: string) =>
		fieldError?.key === key ? (
			<div className="v4err">{fieldError.text}</div>
		) : null;

	if (memory.error !== null) return <div className="v4err">{memory.error}</div>;
	if (data === null) return <p className="v4empty">正在读取记忆…</p>;
	const page = data.pages.find((item) => item.id === pageId) ?? null;

	let lastKind = "";
	return (
		<section data-view="memory">
			<div className="vh">
				<div>
					<h1>记忆</h1>
				</div>
			</div>
			<div className="subtabs">
				{TABS.filter(
					([id]) =>
						id !== "canon" ||
						canonBinding.data?.bound != null ||
						tab === "canon",
				).map(([id, label]) => (
					<button
						type="button"
						key={id}
						aria-selected={tab === id}
						onClick={() => setSearch({ tab: id })}
					>
						{label}
					</button>
				))}
			</div>

			{tab === "canon" ? (
				canon.error !== null ? (
					<div className="v4err">{canon.error}</div>
				) : canon.data === null ? (
					<p className="v4empty">正在读取原著…</p>
				) : canon.data.bound === null ? (
					<p className="v4empty">
						这个故事还没有绑定原著。去 <TLink to="/canon">原著书架</TLink>{" "}
						挑一本，或者从原著开头新建故事。
					</p>
				) : (
					<CanonBoard
						storyId={storyId}
						binding={canon.data.bound}
						focusEventId={focusEventId}
						onChanged={canon.reload}
					/>
				)
			) : null}

			{tab === "wiki" ? (
				<div className="wiki">
					<div className="plist">
						{data.pages.length === 0 ? (
							<p className="v4empty">还没有页面。写几楼之后会出现。</p>
						) : null}
						{data.pages.map((item) => {
							const header =
								item.kind === lastKind ? null : (
									<span className="label">{item.kind}</span>
								);
							lastKind = item.kind;
							return (
								<Fragment key={item.id}>
									{header}
									<button
										type="button"
										aria-pressed={item.id === pageId}
										onClick={() => setPageId(item.id)}
									>
										<span>{item.name}</span>
										<small>
											{item.uptoFloor > 0 ? `第 ${item.uptoFloor} 楼` : ""}
										</small>
									</button>
								</Fragment>
							);
						})}
					</div>
					{page === null ? null : (
						<article
							className={page.id === pageParam ? "page is-focus" : "page"}
							data-focus={page.id}
						>
							<div
								style={{
									display: "flex",
									flexWrap: "wrap",
									alignItems: "center",
									gap: 10,
								}}
							>
								<img
									key={page.id}
									className="portrait"
									src={api.storyPortraitUrl(storyId, page.name)}
									alt={`${page.name}的立绘`}
									width={48}
									height={64}
									// 只有卡里带立绘的人物才有图，其余页面不占位。
									onError={(event) => {
										event.currentTarget.hidden = true;
									}}
								/>
								<h2>{page.name}</h2>
								<span className="pill teal">{page.kind}</span>
								{page.uptoFloor > 0 ? (
									<span className="pill mute">写到第 {page.uptoFloor} 楼</span>
								) : null}
								<button
									type="button"
									className="btn ghost sm"
									onClick={() => {
										memory.reload();
										toast("已从记录重新整理这一页；你锁定的句子保持不变");
									}}
								>
									重新整理
								</button>
							</div>
							<LinkedText
								className="lead"
								text={page.lead || "（还没有简介，点这里写一句）"}
								pages={data.pages}
								self={page.id}
								open={setPageId}
								onCommit={(text) =>
									write(
										`${page.id}|lead`,
										"/memory/edit",
										{
											kind: "wiki",
											target: `${page.id}|lead`,
											value: { text },
										},
										{
											path: "/memory/edit",
											body: {
												kind: "wiki",
												target: `${page.id}|lead`,
												reset: true,
											},
										},
									)
								}
							/>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 10,
									marginTop: 8,
								}}
							>
								<span className="num">来自设定</span>
								<button
									type="button"
									className="lock"
									aria-pressed={page.leadLocked}
									onClick={() =>
										write(
											`${page.id}|lead`,
											"/memory/edit",
											page.leadLocked
												? {
														kind: "wiki",
														target: `${page.id}|lead`,
														reset: true,
													}
												: {
														kind: "wiki",
														target: `${page.id}|lead`,
														value: { text: page.lead },
													},
										)
									}
								>
									{page.leadLocked ? "已锁定" : "锁定"}
								</button>
							</div>
							{problem(`${page.id}|lead`)}
							{(() => {
								const note = data.notebook.find(
									(item) => item.name === page.name,
								);
								return note === undefined ? null : (
									<NotebookBlock
										key={note.versionId}
										storyId={storyId}
										page={note}
										onChanged={memory.reload}
										duplicateBase={
											note.base.trim() !== "" &&
											note.base.trim() === page.lead.trim()
										}
									/>
								);
							})()}
							{page.sections.map((section) => (
								<Fragment key={section.title}>
									<h3>{section.title}</h3>
									{section.statements.map((statement) => {
										const target = `${page.id}|${statement.id}`;
										return (
											<div
												className={statement.old ? "st old" : "st"}
												key={statement.id}
											>
												<LinkedText
													text={statement.text}
													pages={data.pages}
													self={page.id}
													open={setPageId}
													onCommit={(text) =>
														write(
															target,
															"/memory/edit",
															{ kind: "wiki", target, value: { text } },
															{
																path: "/memory/edit",
																body: { kind: "wiki", target, reset: true },
															},
														)
													}
												/>
												<div className="m">
													<span className="num">
														{statement.old && statement.validUntilFloor !== null
															? `至第 ${statement.validUntilFloor} 楼`
															: statement.floorNo === null
																? ""
																: `第 ${statement.floorNo} 楼`}
													</span>
													<span
														className={`pill ${statement.source === "player" ? "gold" : "mute"} src`}
													>
														{statement.source === "player" ? "你改的" : "自动"}
													</span>
													{statement.quote === null ? null : (
														<button
															type="button"
															className="btn ghost sm"
															onClick={() => {
																const next = new Set(raw);
																if (next.has(target)) next.delete(target);
																else next.add(target);
																setRaw(next);
															}}
														>
															原文
														</button>
													)}
													<button
														type="button"
														className="lock"
														aria-pressed={statement.locked}
														onClick={() =>
															write(target, "/memory/edit", {
																kind: "wiki",
																target,
																locked: !statement.locked,
															})
														}
													>
														{statement.locked ? "已锁定" : "锁定"}
													</button>
													<button
														type="button"
														className="btn ghost sm"
														onClick={() =>
															write(
																target,
																"/memory/edit",
																{ kind: "wiki", target, disabled: true },
																{
																	path: "/memory/edit",
																	body: {
																		kind: "wiki",
																		target,
																		disabled: false,
																	},
																},
															)
														}
													>
														删掉
													</button>
												</div>
												{statement.quote !== null && raw.has(target) ? (
													<div className="raw">{statement.quote}</div>
												) : null}
												{problem(target)}
											</div>
										);
									})}
								</Fragment>
							))}
						</article>
					)}
				</div>
			) : null}

			{tab === "state" && data.situation !== null ? (
				<pre className="situation" aria-label="此刻局面">
					{data.situation.text.replace(/^此刻局面：\n/, "")}
				</pre>
			) : null}
			{tab === "state" ? (
				<div className="tblwrap">
					<table className="tbl">
						<thead>
							<tr>
								<th>谁 / 什么</th>
								<th>项目</th>
								<th>现在</th>
								<th>最后变化</th>
							</tr>
						</thead>
						<tbody>
							{data.state.map((item) => (
								<Fragment key={item.target}>
									<tr
										className={focus === item.target ? "is-focus" : undefined}
										data-focus={item.target}
									>
										<td>{item.owner}</td>
										<td>{item.item}</td>
										<Editable
											as="td"
											value={showValue(item.value)}
											onCommit={(text) =>
												write(
													item.target,
													"/memory/state",
													{
														path: item.path,
														value: parseValue(text, item.value),
													},
													{
														path: "/memory/rollback",
														body: { target: item.target, value: item.value },
													},
												)
											}
										/>
										<td className="num" style={{ color: "var(--muted)" }}>
											第 {item.floorNo} 楼{" "}
											<span
												className={`pill ${item.source === "player" ? "gold" : "mute"}`}
											>
												{item.locked
													? "已锁定"
													: item.source === "player"
														? "你改的"
														: "自动"}
											</span>{" "}
											<button
												type="button"
												className="btn ghost sm"
												onClick={() =>
													setHistory(
														history === item.target ? null : item.target,
													)
												}
											>
												历史 {item.history.length}
											</button>
										</td>
									</tr>
									{fieldError?.key === item.target ? (
										<tr>
											<td colSpan={4}>{problem(item.target)}</td>
										</tr>
									) : null}
									{history === item.target ? (
										<tr>
											<td colSpan={4}>
												<div className="hist">
													{item.history.map((version, index) => (
														// biome-ignore lint/suspicious/noArrayIndexKey: 历史按顺序排列
														<span key={index}>
															第 {version.floorNo} 楼 ·{" "}
															{version.source === "player" ? "你" : "自动"} ·{" "}
															{version.value === null
																? "（移除）"
																: showValue(version.value)}{" "}
															<button
																type="button"
																onClick={() =>
																	write(item.target, "/memory/rollback", {
																		target: item.target,
																		value: version.value,
																	})
																}
															>
																回到这一版
															</button>
														</span>
													))}
												</div>
											</td>
										</tr>
									) : null}
								</Fragment>
							))}
						</tbody>
					</table>
					{data.state.length === 0 ? (
						<p className="v4empty">还没有记下状态。</p>
					) : null}
				</div>
			) : null}

			{tab === "secret" ? (
				<div className="tblwrap">
					<table className="tbl">
						<thead>
							<tr>
								<th>秘密</th>
								<th>知道的人</th>
								<th>不知道的人</th>
								<th>来源</th>
							</tr>
						</thead>
						<tbody>
							{data.secrets.map((secret) => {
								const save = (patch: Partial<Secret>) =>
									write(
										secret.id,
										"/memory/edit",
										{
											kind: "secret",
											target: secret.id,
											value: {
												text: patch.text ?? secret.text,
												knowers: patch.knowers ?? secret.knowers,
												unaware: patch.unaware ?? secret.unaware,
											},
										},
										{
											path: "/memory/edit",
											body: { kind: "secret", target: secret.id, reset: true },
										},
									);
								const names = (text: string) =>
									text
										.split(/[、,，\s]+/)
										.map((name) => name.trim())
										.filter((name) => name !== "");
								return (
									<Fragment key={secret.id}>
										<tr>
											<Editable
												as="td"
												value={secret.text}
												onCommit={(text) => save({ text })}
											/>
											<Editable
												as="td"
												value={secret.knowers.join("、")}
												onCommit={(text) => save({ knowers: names(text) })}
											/>
											<Editable
												as="td"
												value={secret.unaware.join("、")}
												onCommit={(text) => save({ unaware: names(text) })}
											/>
											<td className="num" style={{ color: "var(--muted)" }}>
												{secret.floorNo === null
													? "你加的"
													: `第 ${secret.floorNo} 楼`}{" "}
												{secret.locked ? (
													<span className="pill gold">已锁定</span>
												) : null}{" "}
												<button
													type="button"
													className="btn ghost sm"
													onClick={() =>
														write(
															secret.id,
															"/memory/edit",
															{
																kind: "secret",
																target: secret.id,
																value: {
																	text: secret.text,
																	knowers: secret.knowers,
																	unaware: secret.unaware,
																},
																disabled: true,
															},
															{
																path: "/memory/edit",
																body: {
																	kind: "secret",
																	target: secret.id,
																	disabled: false,
																},
															},
														)
													}
												>
													删掉
												</button>
											</td>
										</tr>
										{fieldError?.key === secret.id ? (
											<tr>
												<td colSpan={4}>{problem(secret.id)}</td>
											</tr>
										) : null}
									</Fragment>
								);
							})}
						</tbody>
					</table>
					{data.secrets.length === 0 ? (
						<p className="v4empty">还没有只有一部分人知道的事。</p>
					) : null}
				</div>
			) : null}

			{tab === "line" ? (
				<div className="spine">
					{data.timeline.length === 0 ? (
						<p className="v4empty">暂无内容</p>
					) : null}
					{data.timeline.map((scene, index) => (
						<details
							key={scene.id}
							open={focus === scene.id || index === data.timeline.length - 1}
							className={focus === scene.id ? "is-focus" : undefined}
							data-focus={scene.id}
						>
							<summary>
								{scene.title}
								<small>
									{scene.floors} 楼 · {scene.present.join("、")}
									{scene.locked ? " · 已锁定" : ""}
								</small>
							</summary>
							<Editable
								className="sum"
								value={scene.summary}
								onCommit={(text) =>
									write(
										scene.id,
										"/memory/edit",
										{ kind: "summary", target: scene.id, value: { text } },
										{
											path: "/memory/edit",
											body: { kind: "summary", target: scene.id, reset: true },
										},
									)
								}
							/>
							{problem(scene.id)}
							<ul>
								{scene.changes.map((change) => (
									<li key={change}>
										<b>◆</b>
										{change}
									</li>
								))}
							</ul>
						</details>
					))}
				</div>
			) : null}

			{tab === "rule" ? (
				<div>
					<div className="rows">
						{data.prefs.map((pref) => (
							<Fragment key={pref.id}>
								<div
									className={focus === pref.id ? "is-focus" : undefined}
									data-focus={pref.id}
									style={pref.disabled ? { opacity: 0.5 } : undefined}
								>
									<Editable
										as="span"
										value={pref.text}
										onCommit={(text) =>
											write(
												pref.id,
												"/memory/prefs",
												{ id: pref.id, text },
												{
													path: "/memory/prefs",
													body: {
														id: pref.id,
														text: pref.text,
														disabled: pref.disabled,
													},
												},
											)
										}
									/>
									<span>
										{pref.origin}{" "}
										{pref.locked ? (
											<span className="pill gold">已锁定</span>
										) : null}{" "}
										<button
											type="button"
											className="btn ghost sm"
											onClick={() =>
												write(
													pref.id,
													"/memory/prefs",
													{ id: pref.id, disabled: !pref.disabled },
													{
														path: "/memory/prefs",
														body: { id: pref.id, disabled: pref.disabled },
													},
												)
											}
										>
											{pref.disabled ? "恢复" : "不用了"}
										</button>
									</span>
								</div>
								{problem(pref.id)}
							</Fragment>
						))}
					</div>
					{problem("new-rule")}
					<div className="say" style={{ marginTop: 14 }}>
						<textarea
							rows={1}
							value={rule}
							placeholder="加一条偏好"
							onChange={(event) => setRule(event.target.value)}
						/>
						<button
							type="button"
							className="btn"
							onClick={() => {
								const text = rule.trim();
								if (text === "") return;
								setRule("");
								void write("new-rule", "/memory/prefs", { text });
							}}
						>
							加上
						</button>
					</div>
					{data.rejections.length > 0 ? (
						<>
							<div className="label" style={{ marginTop: 22 }}>
								被挡下的自动写入
							</div>
							<div className="rows">
								{data.rejections.map((item) => (
									<div key={item.id}>
										<span>{item.text}</span>
										<span>{item.reason}</span>
									</div>
								))}
							</div>
						</>
					) : null}
				</div>
			) : null}
		</section>
	);
}
