import type {
	CanonChapterExtractionRecord,
	CanonChapterKind,
	CanonChapterRecord,
	CanonChapterView,
	CanonCompilationRecord,
	CanonCompiledEntityRecord,
	CanonEventRecord,
	CanonExtractionView,
	CanonStartingPage,
	CanonWorldIndex,
} from "@dramaticer/protocol";
import { Fragment, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import {
	BOOK_STATUS_LABELS,
	CHAPTER_KIND_LABELS,
	formatChars,
} from "./canon-labels";
import { TLink, formatTokens, useAct, useLoad, useToast } from "./ui";

const KIND_OPTIONS = Object.entries(CHAPTER_KIND_LABELS) as [
	CanonChapterKind,
	string,
][];

const CHAPTER_STATUS_LABELS: Readonly<
	Record<CanonChapterExtractionRecord["status"], string>
> = {
	pending: "待抽取",
	running: "抽取中",
	done: "已完成",
	failed: "失败",
};

const EXTRACTION_STATUS_LABELS: Readonly<Record<string, string>> = {
	idle: "未开始",
	running: "抽取中",
	paused: "已暂停",
	done: "已完成",
	failed: "有失败章",
};

const COMPILATION_STATUS_LABELS: Readonly<
	Record<CanonCompilationRecord["status"], string>
> = {
	idle: "未汇编",
	running: "汇编中",
	done: "已汇编",
	failed: "汇编失败",
};

const VOICE_LABELS = {
	speech: "说",
	thought: "想",
} as const;

function formatCost(value: number): string {
	return `¥${value.toFixed(4)}`;
}

/** 原著分章预览、预估与后台抽取：计时、暂停、续跑与单章重跑都在这一页。 */
export function CanonBook() {
	const { bookId = "" } = useParams();
	const navigate = useNavigate();
	const toast = useToast();
	const act = useAct();
	const detail = useLoad(() => api.getCanonBook(bookId), [bookId]);
	const estimate = useLoad(() => api.getCanonEstimate(bookId), [bookId]);
	const extraction = useLoad(() => api.getCanonExtraction(bookId), [bookId]);
	const [view, setView] = useState<"chapters" | "entities" | "timeline">(
		"chapters",
	);
	const [previewChapter, setPreviewChapter] = useState(1);
	const [includeText, setIncludeText] = useState(false);
	const compiled = useLoad(
		() => api.getCanonCompiled(bookId, previewChapter),
		[bookId, previewChapter],
	);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [titleDraft, setTitleDraft] = useState("");
	const [kind, setKind] = useState<CanonChapterKind>("chapter");
	const [splitAt, setSplitAt] = useState(1);
	const [pane, setPane] = useState<"text" | "results">("text");
	const [busy, setBusy] = useState(false);

	const chapters = detail.data?.chapters ?? [];
	const selected =
		chapters.find((chapter) => chapter.id === selectedId) ?? null;
	const chapter = useLoad<CanonChapterRecord | null>(
		() =>
			selectedId === null
				? Promise.resolve(null)
				: api.getCanonChapter(bookId, selectedId),
		[bookId, selectedId],
	);
	const progressByChapter = new Map(
		(extraction.data?.chapters ?? []).map((item) => [
			item.chapter.id,
			item.extraction,
		]),
	);
	const selectedProgress =
		selected === null ? null : (progressByChapter.get(selected.id) ?? null);
	const extractionState = extraction.data?.extraction ?? null;
	const compilation = compiled.data?.compilation ?? null;
	const compilationStatus = compilation?.status ?? "idle";

	useEffect(() => {
		if (detail.data === null) return;
		if (
			selectedId !== null &&
			detail.data.chapters.some((item) => item.id === selectedId)
		) {
			return;
		}
		setSelectedId(detail.data.chapters[0]?.id ?? null);
	}, [detail.data, selectedId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: 换一章时重新填表单
	useEffect(() => {
		if (selected === null) return;
		setTitleDraft(selected.title);
		setKind(selected.kind);
		setSplitAt(1);
		setPane("text");
	}, [selected?.id, selected?.title, selected?.kind]);

	const extractionStatus = extractionState?.status ?? "idle";
	useEffect(() => {
		if (extractionStatus !== "running") {
			if (extractionStatus === "done" || extractionStatus === "failed") {
				detail.reload();
			}
			return;
		}
		const timer = setInterval(() => extraction.reload(), 1_200);
		return () => clearInterval(timer);
	}, [extractionStatus, extraction.reload, detail.reload]);

	useEffect(() => {
		if (compilationStatus !== "running") return;
		const timer = setInterval(() => compiled.reload(), 1_200);
		return () => clearInterval(timer);
	}, [compilationStatus, compiled.reload]);

	const run = async (work: () => Promise<unknown>, done: string) => {
		setBusy(true);
		try {
			await act(work, done);
		} finally {
			setBusy(false);
		}
	};

	const save = () => {
		if (selected === null) return;
		const title = titleDraft.trim();
		if (title.length === 0) {
			toast("标题不能为空");
			return;
		}
		void run(async () => {
			await api.updateCanonChapter(bookId, selected.id, { title, kind });
			detail.reload();
			chapter.reload();
		}, "已保存");
	};

	const mergeNext = () => {
		if (selected === null) return;
		void run(async () => {
			await api.mergeCanonChapter(bookId, selected.id);
			detail.reload();
			chapter.reload();
			extraction.reload();
		}, "已与下一章合并");
	};

	const split = () => {
		if (selected === null) return;
		const count = chapter.data?.paragraphs.length ?? 0;
		if (!Number.isInteger(splitAt) || splitAt < 1 || splitAt >= count) {
			toast(`拆分位置必须在 1 到 ${Math.max(count - 1, 0)} 之间`);
			return;
		}
		void run(async () => {
			await api.splitCanonChapter(bookId, selected.id, splitAt);
			detail.reload();
			chapter.reload();
			extraction.reload();
		}, "已拆分");
	};

	const remove = () => {
		if (!window.confirm("删除这本原著？原文与分章都会删除，无法恢复。")) {
			return;
		}
		void run(async () => {
			await api.deleteCanonBook(bookId);
			navigate("/canon");
		}, "已删除");
	};

	const start = () => {
		void run(async () => {
			await api.startCanonExtraction(bookId);
			extraction.reload();
			detail.reload();
		}, "已开始抽取");
	};

	const pause = () => {
		void run(async () => {
			await api.pauseCanonExtraction(bookId);
			extraction.reload();
		}, "已暂停");
	};

	const rerunSelected = () => {
		if (selected === null) return;
		const mode = selectedProgress?.status === "done" ? "full" : "resume";
		void run(
			async () => {
				await api.reextractCanonChapter(bookId, selected.id, { mode });
				extraction.reload();
				setPane("results");
			},
			mode === "full" ? "已清掉旧结果，整章重抽" : "已重跑这一章",
		);
	};

	const compile = () => {
		void run(async () => {
			await api.compileCanonBook(bookId);
			compiled.reload();
		}, "已开始全书汇编");
	};

	const exportPackage = () => {
		void run(async () => {
			const payload = await api.exportCanonPackage(bookId, includeText);
			const blob = new Blob([JSON.stringify(payload, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `${detail.data?.book.title ?? "原著"}.canon.json`;
			link.click();
			URL.revokeObjectURL(url);
		}, "已导出原著包");
	};

	if (detail.error !== null) {
		return (
			<section data-view="canonbook">
				<div className="vh">
					<h1>原著</h1>
					<TLink className="btn ghost sm" to="/canon">
						全部原著
					</TLink>
				</div>
				<div className="v4err">{detail.error}</div>
			</section>
		);
	}
	if (detail.data === null) {
		return <p className="v4empty">正在读取原著…</p>;
	}

	const book = detail.data.book;
	const estimateView = estimate.data;
	const canStart =
		book.hasText &&
		(extractionStatus === "idle" ||
			extractionStatus === "paused" ||
			extractionStatus === "failed");
	const compiledEntities = compiled.data?.entities ?? [];
	const compiledEvents = compiled.data?.events ?? [];
	const startingPages = compiled.data?.pages ?? [];
	const worldIndex: CanonWorldIndex | null = compiled.data?.worldIndex ?? null;
	const mainEvents = compiledEvents.filter((event) => !event.isInterlude);
	const chapterEvents = (extraction.data?.events ?? []).filter(
		(event) => event.chapterId === selected?.id,
	);
	const chapterVoices = (extraction.data?.voices ?? []).filter(
		(voice) => voice.chapterId === selected?.id,
	);
	const chapterFacts = (extraction.data?.facts ?? []).filter(
		(fact) => fact.chapterId === selected?.id,
	);

	return (
		<section data-view="canonbook">
			<div className="vh">
				<div>
					<span className="label">
						{BOOK_STATUS_LABELS[book.status]} · {book.encoding} ·{" "}
						{formatChars(book.charCount)} · {book.chapterCount} 章
					</span>
					<h1>{book.title}</h1>
					{book.filename === null ? null : (
						<p className="canon-file">{book.filename}</p>
					)}
				</div>
				<TLink className="btn ghost sm" to="/canon">
					全部原著
				</TLink>
			</div>
			<section className="page canon-extract" aria-label="抽取预估与进度">
				{book.hasText ? (
					<div className="canon-extract-stats">
						<dl>
							<div>
								<dt>章数</dt>
								<dd className="num">{estimateView?.chapterCount ?? "—"}</dd>
							</div>
							<div>
								<dt>字数</dt>
								<dd className="num">
									{estimateView === null
										? "—"
										: formatChars(estimateView.charCount)}
								</dd>
							</div>
							<div>
								<dt>块数</dt>
								<dd className="num">{estimateView?.chunkCount ?? "—"}</dd>
							</div>
							<div>
								<dt>预计输入</dt>
								<dd className="num">
									{formatTokens(estimateView?.inputTokens ?? null)}
								</dd>
							</div>
							<div>
								<dt>预计输出</dt>
								<dd className="num">
									{formatTokens(estimateView?.outputTokens ?? null)}
								</dd>
							</div>
							<div>
								<dt>预计费用</dt>
								<dd className="num">
									{estimateView === null
										? "—"
										: formatCost(estimateView.estimatedCost)}
								</dd>
							</div>
						</dl>
						{estimateView === null ? null : (
							<p className="muted">{estimateView.note}</p>
						)}
					</div>
				) : (
					<p className="muted">
						这本原著包不含原文：实体、时间线与话术已经就绪，不需要抽取，也没有可查看的原文。
					</p>
				)}
				<div className="canon-extract-controls">
					<div className="canon-extract-state">
						<span
							className="canon-status"
							data-status={extractionStatus}
							aria-live="polite"
						>
							{EXTRACTION_STATUS_LABELS[extractionStatus] ?? extractionStatus}
						</span>
						{extractionState === null ? null : (
							<span className="num">
								{extractionState.doneChapters}/{extractionState.totalChapters}{" "}
								章
								{extractionState.failedChapters === 0
									? ""
									: ` · 失败 ${extractionState.failedChapters} 章`}
							</span>
						)}
						{extractionState === null ? null : (
							<span className="label">
								{formatTokens(extractionState.llmTokens)} token ·{" "}
								{extractionState.llmCalls} 次调用
							</span>
						)}
					</div>
					{book.hasText ? (
						<div className="canon-extract-buttons">
							<button
								type="button"
								className="btn gold sm"
								disabled={busy || !canStart}
								onClick={start}
							>
								{extractionStatus === "idle"
									? "开始抽取"
									: extractionStatus === "done"
										? "已完成"
										: "继续抽取"}
							</button>
							<button
								type="button"
								className="btn sm"
								disabled={busy || extractionStatus !== "running"}
								onClick={pause}
							>
								暂停
							</button>
						</div>
					) : null}
				</div>
				{extractionState?.lastError === null ||
				extractionState?.lastError === undefined ? null : (
					<div className="v4err">{extractionState.lastError}</div>
				)}
			</section>
			<section className="page canon-compile" aria-label="全书汇编">
				<div className="canon-compile-head">
					<h2>全书汇编</h2>
					<span
						className="canon-status"
						data-status={compilationStatus}
						aria-live="polite"
					>
						{COMPILATION_STATUS_LABELS[compilationStatus]}
					</span>
					{compilation === null ? null : (
						<span className="label">
							{compilation.llmCalls} 次调用 ·{" "}
							{formatTokens(compilation.llmTokens)} token
						</span>
					)}
					<span className="label">
						{compiledEntities.length} 个实体 · {mainEvents.length} 件主线事件
					</span>
				</div>
				<p className="muted">
					合并同名与别名、排定时间线与关键转折、给每个实体写一行简介与记事页底色。一次后台跑完，不计入每楼的调用预算。
				</p>
				<div className="canon-compile-buttons">
					<button
						type="button"
						className="btn gold sm"
						disabled={
							busy ||
							!book.hasText ||
							extractionStatus !== "done" ||
							compilationStatus === "running"
						}
						onClick={compile}
					>
						{compilationStatus === "done"
							? "重新汇编"
							: compilationStatus === "running"
								? "汇编中…"
								: "全书汇编"}
					</button>
					<label className="canon-export-check">
						<input
							type="checkbox"
							checked={includeText}
							disabled={!book.hasText}
							onChange={(event) => setIncludeText(event.target.checked)}
						/>
						包含原文
					</label>
					<button
						type="button"
						className="btn sm"
						disabled={busy || compilationStatus !== "done"}
						onClick={exportPackage}
					>
						导出原著包
					</button>
				</div>
				{book.hasText ? null : (
					<p className="muted">
						这本原著包不含原文，已经带汇编结果，不需要抽取与汇编。
					</p>
				)}
				{compilation?.lastError === null ||
				compilation?.lastError === undefined ? null : (
					<div className="v4err">{compilation.lastError}</div>
				)}
			</section>
			<div className="canon-tabs" role="tablist" aria-label="原著视图">
				<button
					type="button"
					role="tab"
					aria-selected={view === "chapters"}
					className={view === "chapters" ? "canon-tab on" : "canon-tab"}
					onClick={() => setView("chapters")}
				>
					分章
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={view === "entities"}
					className={view === "entities" ? "canon-tab on" : "canon-tab"}
					onClick={() => setView("entities")}
				>
					人物与世界索引
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={view === "timeline"}
					className={view === "timeline" ? "canon-tab on" : "canon-tab"}
					onClick={() => setView("timeline")}
				>
					时间线
				</button>
			</div>
			{view === "entities" ? (
				<CanonEntityPages
					entities={compiledEntities}
					pages={startingPages}
					worldIndex={worldIndex}
					chapterCount={book.chapterCount}
					previewChapter={previewChapter}
					onPreviewChapter={setPreviewChapter}
					compiled={compilationStatus === "done"}
				/>
			) : view === "timeline" ? (
				<CanonTimeline
					events={compiledEvents}
					compiled={compilationStatus === "done"}
				/>
			) : (
				<div className="canon-grid">
					<aside className="page canon-chapters" aria-label="章节目录">
						{chapters.map((item, index) => {
							const progress = progressByChapter.get(item.id) ?? null;
							return (
								<Fragment key={item.id}>
									{showVolume(chapters, index) ? (
										<div className="canon-vol">{item.volumeTitle}</div>
									) : null}
									<button
										type="button"
										className={
											item.id === selectedId ? "canon-ch on" : "canon-ch"
										}
										onClick={() => setSelectedId(item.id)}
									>
										<span className="num">{item.ordinal}</span>
										<span className="canon-chtitle">{item.title}</span>
										<span className="canon-chmeta">
											<span className="label">
												{CHAPTER_KIND_LABELS[item.kind]} · {item.paragraphCount}{" "}
												段
											</span>
											<span
												className="canon-status"
												data-status={progress?.status ?? "none"}
											>
												{progress === null
													? "未抽取"
													: CHAPTER_STATUS_LABELS[progress.status]}
											</span>
										</span>
									</button>
								</Fragment>
							);
						})}
					</aside>
					<div className="page canon-chapter">
						{selected === null ? (
							<p className="v4empty">这本书还没有章节。</p>
						) : (
							<>
								<div className="canon-editrow">
									<input
										type="text"
										aria-label="章节标题"
										value={titleDraft}
										onChange={(event) => setTitleDraft(event.target.value)}
									/>
									<select
										aria-label="章节类型"
										value={kind}
										onChange={(event) =>
											setKind(event.target.value as CanonChapterKind)
										}
									>
										{KIND_OPTIONS.map(([value, label]) => (
											<option key={value} value={value}>
												{label}
											</option>
										))}
									</select>
									<button
										type="button"
										className="btn gold sm"
										disabled={busy}
										onClick={save}
									>
										保存
									</button>
									<button
										type="button"
										className="btn sm"
										disabled={busy}
										onClick={rerunSelected}
									>
										{selectedProgress?.status === "done"
											? "整章重跑"
											: "重跑这一章"}
									</button>
								</div>
								<div className="canon-editrow">
									<label className="canon-splitlabel">
										在第
										<input
											type="number"
											aria-label="拆分位置"
											min={1}
											max={Math.max(
												(chapter.data?.paragraphs.length ?? 1) - 1,
												1,
											)}
											value={splitAt}
											onChange={(event) =>
												setSplitAt(Number(event.target.value))
											}
										/>
										段后拆分
									</label>
									<button
										type="button"
										className="btn sm"
										disabled={busy}
										onClick={split}
									>
										拆分
									</button>
									<button
										type="button"
										className="btn sm"
										disabled={busy || selected.ordinal === book.chapterCount}
										onClick={mergeNext}
									>
										与下一章合并
									</button>
									<span className="spacer" />
									<button
										type="button"
										className="btn ghost sm"
										disabled={busy}
										onClick={remove}
									>
										删除原著
									</button>
								</div>
								{selectedProgress?.lastError === null ||
								selectedProgress?.lastError === undefined ? null : (
									<div className="v4err">{selectedProgress.lastError}</div>
								)}
								<div
									className="canon-tabs"
									role="tablist"
									aria-label="章节内容"
								>
									<button
										type="button"
										role="tab"
										aria-selected={pane === "text"}
										className={pane === "text" ? "canon-tab on" : "canon-tab"}
										onClick={() => setPane("text")}
									>
										原文段落
									</button>
									<button
										type="button"
										role="tab"
										aria-selected={pane === "results"}
										className={
											pane === "results" ? "canon-tab on" : "canon-tab"
										}
										onClick={() => setPane("results")}
									>
										抽取结果
									</button>
								</div>
								{chapter.error !== null ? (
									<div className="v4err">{chapter.error}</div>
								) : chapter.data === null ? (
									<p className="v4empty">正在读取这一章…</p>
								) : pane === "text" ? (
									<ol className="canon-paras">
										{chapter.data.paragraphs.map((paragraph, index) => (
											<li key={`${index}-${paragraph.slice(0, 8)}`}>
												<span className="num">{index + 1}</span>
												<p>{paragraph}</p>
											</li>
										))}
									</ol>
								) : (
									<ChapterResults
										events={chapterEvents}
										voices={chapterVoices}
										facts={chapterFacts}
									/>
								)}
							</>
						)}
					</div>
				</div>
			)}
		</section>
	);
}

/** 汇编后的人物与世界索引：一行简介、合并后的别名与按章节切片的底色。 */
function CanonEntityPages({
	entities,
	pages,
	worldIndex,
	chapterCount,
	previewChapter,
	onPreviewChapter,
	compiled,
}: {
	readonly entities: readonly CanonCompiledEntityRecord[];
	readonly pages: readonly CanonStartingPage[];
	readonly worldIndex: CanonWorldIndex | null;
	readonly chapterCount: number;
	readonly previewChapter: number;
	readonly onPreviewChapter: (value: number) => void;
	readonly compiled: boolean;
}) {
	if (!compiled) {
		return <p className="v4empty">还没有完成全书汇编。</p>;
	}
	const pageByName = new Map(pages.map((page) => [page.name, page]));
	return (
		<div className="canon-entity-view">
			<div className="canon-preview">
				<label>
					截至第
					<input
						type="number"
						aria-label="截至章节"
						min={1}
						max={Math.max(chapterCount, 1)}
						value={previewChapter}
						onChange={(event) => onPreviewChapter(Number(event.target.value))}
					/>
					章
				</label>
				<span className="label">
					只显示不晚于这一章的底色与世界索引条目，防剧透。
				</span>
			</div>
			<section className="page" aria-label="世界索引">
				<h3>世界索引</h3>
				{worldIndex === null ? (
					<p className="muted">这一章还没有已出场的实体。</p>
				) : (
					<pre className="canon-worldindex">{worldIndex.text}</pre>
				)}
			</section>
			<ul className="canon-entities">
				{entities.map((entity) => {
					const page = pageByName.get(entity.name) ?? null;
					const entries = page?.entries ?? [];
					return (
						<li key={entity.name} className="page">
							<div className="canon-event-head">
								<b>{entity.name}</b>
								<span className="label">{entity.kind}</span>
								<span className="label">
									第 {entity.firstChapterOrdinal}–{entity.lastChapterOrdinal} 章
								</span>
								{entity.aliases.length === 0 ? null : (
									<span className="label">
										别名：{entity.aliases.join("、")}
									</span>
								)}
							</div>
							<p>{entity.lead}</p>
							{page === null ? (
								<p className="muted">第 {previewChapter} 章时还没有出场。</p>
							) : entries.length === 0 ? (
								<p className="muted">这一章之前还没有底色条目。</p>
							) : (
								<ol className="canon-base">
									{entries.map((entry) => (
										<li key={`${entry.chapterOrdinal}-${entry.text}`}>
											<span className="label">
												第 {entry.chapterOrdinal} 章
											</span>
											<p>{entry.text}</p>
										</li>
									))}
								</ol>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

/** 汇编后的时间线：主线按 timelineOrder，插叙单列，关键转折带标记。 */
function CanonTimeline({
	events,
	compiled,
}: {
	readonly events: readonly CanonEventRecord[];
	readonly compiled: boolean;
}) {
	if (!compiled) {
		return <p className="v4empty">还没有完成全书汇编。</p>;
	}
	const main = events
		.filter((event) => !event.isInterlude && event.timelineOrder !== null)
		.sort(
			(left, right) => (left.timelineOrder ?? 0) - (right.timelineOrder ?? 0),
		);
	const interludes = events.filter((event) => event.isInterlude);
	return (
		<div className="canon-timeline">
			<section aria-label="主时间线">
				<h3>主时间线</h3>
				<ol className="canon-events">
					{main.map((event) => (
						<li key={event.id}>
							<div className="canon-event-head">
								<span className="num">{event.timelineOrder}</span>
								<b>{event.title}</b>
								{event.isTurningPoint ? (
									<span className="canon-badge">关键转折</span>
								) : null}
								<span className="label">第 {event.chapterOrdinal} 章</span>
							</div>
							<p>{event.summary}</p>
							<p className="muted">
								{event.participants.join("、") || "—"}
								{event.location === null ? "" : ` · ${event.location}`}
								{event.timeText === null ? "" : ` · ${event.timeText}`}
							</p>
						</li>
					))}
				</ol>
			</section>
			{interludes.length === 0 ? null : (
				<section aria-label="插叙">
					<h3>插叙</h3>
					<ol className="canon-events">
						{interludes.map((event) => (
							<li key={event.id}>
								<div className="canon-event-head">
									<b>{event.title}</b>
									<span className="canon-badge">插叙</span>
									<span className="label">第 {event.chapterOrdinal} 章</span>
								</div>
								<p>{event.summary}</p>
							</li>
						))}
					</ol>
				</section>
			)}
		</div>
	);
}

function ChapterResults({
	events,
	voices,
	facts,
}: {
	readonly events: readonly CanonEventRecord[];
	readonly voices: CanonExtractionView["voices"];
	readonly facts: CanonExtractionView["facts"];
}) {
	if (events.length === 0 && voices.length === 0 && facts.length === 0) {
		return <p className="v4empty">这一章还没有抽取结果。</p>;
	}
	return (
		<div className="canon-results">
			<section aria-label="抽取的事件">
				<h3>事件</h3>
				{events.length === 0 ? (
					<p className="muted">无</p>
				) : (
					<ol className="canon-events">
						{events.map((event) => (
							<li key={event.id}>
								<div className="canon-event-head">
									<b>{event.title}</b>
									{event.isInterlude ? (
										<span className="canon-badge">插叙</span>
									) : null}
									<span className="label">第 {event.chapterOrdinal} 章</span>
								</div>
								<p>{event.summary}</p>
								<p className="muted">{event.digest}</p>
								<dl>
									<dt>人物</dt>
									<dd>{event.participants.join("、") || "—"}</dd>
									<dt>地点</dt>
									<dd>{event.location ?? "—"}</dd>
									<dt>时间</dt>
									<dd>{event.timeText ?? "—"}</dd>
									<dt>段落</dt>
									<dd className="num">
										{event.paragraphStart === event.paragraphEnd
											? `第 ${event.paragraphStart} 段`
											: `第 ${event.paragraphStart}–${event.paragraphEnd} 段`}
									</dd>
								</dl>
							</li>
						))}
					</ol>
				)}
			</section>
			<section aria-label="抽取的话术">
				<h3>话术</h3>
				{voices.length === 0 ? (
					<p className="muted">无</p>
				) : (
					<ul className="canon-voices">
						{voices.map((voice) => (
							<li key={voice.id}>
								<span className="canon-badge">{VOICE_LABELS[voice.kind]}</span>
								<b>{voice.character}</b> {voice.text}
							</li>
						))}
					</ul>
				)}
			</section>
			<section aria-label="抽出的实体增量">
				<h3>实体增量</h3>
				{facts.length === 0 ? (
					<p className="muted">无</p>
				) : (
					<ul className="canon-facts">
						{facts.map((fact) => (
							<li key={fact.id}>
								<div>
									<b>{fact.entityName}</b>
									<span className="label">{fact.entityKind}</span>
									{fact.aliases.length === 0 ? null : (
										<span className="label">
											别名：{fact.aliases.join("、")}
										</span>
									)}
									<span className="label">第 {fact.chapterOrdinal} 章</span>
								</div>
								<p>{fact.fact}</p>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

function showVolume(
	chapters: readonly CanonChapterView[],
	index: number,
): boolean {
	const chapter = chapters[index];
	if (chapter === undefined || chapter.volumeTitle === null) return false;
	return chapters[index - 1]?.volumeTitle !== chapter.volumeTitle;
}
