import type {
	CanonChapterExtractionRecord,
	CanonChapterKind,
	CanonChapterRecord,
	CanonChapterView,
	CanonEventRecord,
	CanonExtractionView,
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
		extractionStatus === "idle" ||
		extractionStatus === "paused" ||
		extractionStatus === "failed";
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
				</div>
				{extractionState?.lastError === null ||
				extractionState?.lastError === undefined ? null : (
					<div className="v4err">{extractionState.lastError}</div>
				)}
			</section>
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
										onChange={(event) => setSplitAt(Number(event.target.value))}
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
							<div className="canon-tabs" role="tablist" aria-label="章节内容">
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
									className={pane === "results" ? "canon-tab on" : "canon-tab"}
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
		</section>
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
