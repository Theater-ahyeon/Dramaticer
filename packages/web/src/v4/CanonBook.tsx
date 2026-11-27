import type {
	CanonChapterKind,
	CanonChapterRecord,
	CanonChapterView,
} from "@dramaticer/protocol";
import { Fragment, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import {
	BOOK_STATUS_LABELS,
	CHAPTER_KIND_LABELS,
	formatChars,
} from "./canon-labels";
import { TLink, useAct, useLoad, useToast } from "./ui";

const KIND_OPTIONS = Object.entries(CHAPTER_KIND_LABELS) as [
	CanonChapterKind,
	string,
][];

/** 原著分章预览：左列章节目录，右边看当前章原文并改标题、合并、拆分。 */
export function CanonBook() {
	const { bookId = "" } = useParams();
	const navigate = useNavigate();
	const toast = useToast();
	const act = useAct();
	const detail = useLoad(() => api.getCanonBook(bookId), [bookId]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [titleDraft, setTitleDraft] = useState("");
	const [kind, setKind] = useState<CanonChapterKind>("chapter");
	const [splitAt, setSplitAt] = useState(1);
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
	}, [selected?.id, selected?.title, selected?.kind]);

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
			<div className="canon-grid">
				<aside className="page canon-chapters" aria-label="章节目录">
					{chapters.map((item, index) => (
						<Fragment key={item.id}>
							{showVolume(chapters, index) ? (
								<div className="canon-vol">{item.volumeTitle}</div>
							) : null}
							<button
								type="button"
								className={item.id === selectedId ? "canon-ch on" : "canon-ch"}
								onClick={() => setSelectedId(item.id)}
							>
								<span className="num">{item.ordinal}</span>
								<span className="canon-chtitle">{item.title}</span>
								<span className="label">
									{CHAPTER_KIND_LABELS[item.kind]} · {item.paragraphCount} 段
								</span>
							</button>
						</Fragment>
					))}
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
							{chapter.error !== null ? (
								<div className="v4err">{chapter.error}</div>
							) : chapter.data === null ? (
								<p className="v4empty">正在读取这一章…</p>
							) : (
								<ol className="canon-paras">
									{chapter.data.paragraphs.map((paragraph, index) => (
										<li key={`${index}-${paragraph.slice(0, 8)}`}>
											<span className="num">{index + 1}</span>
											<p>{paragraph}</p>
										</li>
									))}
								</ol>
							)}
						</>
					)}
				</div>
			</div>
		</section>
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
