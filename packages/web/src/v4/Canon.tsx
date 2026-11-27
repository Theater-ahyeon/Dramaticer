import type { CanonBookView, CanonPackageView } from "@dramaticer/protocol";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { BOOK_STATUS_LABELS, formatChars } from "./canon-labels";
import { TLink, errorText, useLoad, useToast } from "./ui";

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(binary);
}

/** 原著书架：上传 txt，导入后立刻进入分章预览。 */
export function CanonLibrary() {
	const books = useLoad(() => api.listCanonBooks(), []);
	const navigate = useNavigate();
	const toast = useToast();
	const [title, setTitle] = useState("");
	const [dragging, setDragging] = useState(false);
	const [busy, setBusy] = useState(false);

	const upload = async (file: File) => {
		if (!file.name.toLowerCase().endsWith(".txt")) {
			toast("只能导入 txt 文件");
			return;
		}
		if (file.size > MAX_FILE_BYTES) {
			toast("文件超过 32 MB");
			return;
		}
		setBusy(true);
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const result = await api.importCanonBook({
				...(title.trim().length === 0 ? {} : { title: title.trim() }),
				filename: file.name,
				dataBase64: bytesToBase64(bytes),
			});
			setTitle("");
			toast(
				`已导入《${result.book.title}》，分为 ${result.book.chapterCount} 章`,
			);
			navigate(`/canon/${encodeURIComponent(result.book.id)}`);
		} catch (error) {
			toast(errorText(error));
		} finally {
			setBusy(false);
		}
	};

	const uploadPackage = async (file: File) => {
		if (!file.name.toLowerCase().endsWith(".json")) {
			toast("只能导入 .json 原著包");
			return;
		}
		if (file.size > MAX_PACKAGE_BYTES) {
			toast("原著包超过 64 MB");
			return;
		}
		setBusy(true);
		try {
			const raw: unknown = JSON.parse(await file.text());
			const result = await api.importCanonPackage({
				package: raw as CanonPackageView,
			});
			toast(`已导入《${result.book.title}》，无需再抽取`);
			navigate(`/canon/${encodeURIComponent(result.book.id)}`);
		} catch (error) {
			toast(errorText(error));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section data-view="canon">
			<div className="vh">
				<div>
					<span className="label">原著</span>
					<h1>原著书架</h1>
					<p>导入小说原文，按章查看与调整，之后可以从这里抽取事件。</p>
				</div>
				<TLink className="btn ghost sm" to="/">
					回到书架
				</TLink>
			</div>
			<div className="canon-upload">
				<input
					type="text"
					aria-label="书名"
					placeholder="书名（默认用文件名）"
					value={title}
					onChange={(event) => setTitle(event.target.value)}
				/>
				<label
					className={dragging ? "canon-drop on" : "canon-drop"}
					onDragOver={(event) => {
						event.preventDefault();
						setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={(event) => {
						event.preventDefault();
						setDragging(false);
						const file = event.dataTransfer.files[0];
						if (file !== undefined && !busy) void upload(file);
					}}
				>
					<input
						type="file"
						accept=".txt,text/plain"
						hidden
						disabled={busy}
						onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (file !== undefined && !busy) void upload(file);
						}}
					/>
					<strong>{busy ? "正在分章…" : "选择 txt 文件，或拖到这里"}</strong>
					<span>UTF-8、UTF-16、GB18030 自动识别</span>
				</label>
				<label className="canon-drop canon-drop-package">
					<input
						type="file"
						accept=".json,application/json"
						hidden
						disabled={busy}
						onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (file !== undefined && !busy) void uploadPackage(file);
						}}
					/>
					<strong>导入原著包（.json）</strong>
					<span>已汇编好的原著，导入后直接能开局，不用重新抽取</span>
				</label>
			</div>
			{books.error !== null ? (
				<div className="v4err">{books.error}</div>
			) : books.data === null ? (
				<p className="v4empty">正在读取原著…</p>
			) : books.data.length === 0 ? (
				<p className="v4empty">还没有导入原著。上传一本 txt 开始。</p>
			) : (
				<div className="canon-books">
					{books.data.map((book) => (
						<CanonBookCard key={book.id} book={book} />
					))}
				</div>
			)}
		</section>
	);
}

function CanonBookCard({ book }: { readonly book: CanonBookView }) {
	return (
		<TLink className="canon-book" to={`/canon/${encodeURIComponent(book.id)}`}>
			<span className="label">{BOOK_STATUS_LABELS[book.status]}</span>
			<h2>{book.title}</h2>
			<p>
				{book.chapterCount} 章 · {formatChars(book.charCount)}
			</p>
			<span className="label">{book.encoding}</span>
		</TLink>
	);
}
