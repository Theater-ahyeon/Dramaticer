import type {
	CanonEventRecord,
	CanonStartingPage,
	ImportStoryRequest,
} from "@dramaticer/protocol";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Seg, errorText } from "./ui";

type Mode = "card" | "blank" | "canon";
type Identity = "canon" | "custom";

type CardFile = ImportStoryRequest["card"];

interface CanonBookOption {
	readonly id: string;
	readonly title: string;
}

function toBase64(bytes: Uint8Array): string {
	const chunkSize = 0x8000;
	let binary = "";
	for (let index = 0; index < bytes.length; index += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
	}
	return btoa(binary);
}

async function readCard(file: File): Promise<CardFile> {
	const name = file.name.toLowerCase();
	if (name.endsWith(".png")) {
		return {
			format: "png",
			data: toBase64(new Uint8Array(await file.arrayBuffer())),
		};
	}
	if (name.endsWith(".json"))
		return { format: "json", data: await file.text() };
	throw new Error("角色卡要是 PNG 或 JSON 文件");
}

function timeline(events: readonly CanonEventRecord[]): CanonEventRecord[] {
	return events
		.filter((event) => !event.isInterlude)
		.sort((left, right) => {
			const order =
				(left.timelineOrder ?? Number.MAX_SAFE_INTEGER) -
				(right.timelineOrder ?? Number.MAX_SAFE_INTEGER);
			if (order !== 0) return order;
			return (
				left.chapterOrdinal - right.chapterOrdinal ||
				left.paragraphStart - right.paragraphStart ||
				left.seq - right.seq
			);
		});
}

/** 新建故事：导入角色卡、空白开局，或从一本已汇编的原著开局。 */
export function NewStoryDialog({ onClose }: { readonly onClose: () => void }) {
	const navigate = useNavigate();
	const [mode, setMode] = useState<Mode>("card");
	const [title, setTitle] = useState("");
	const [card, setCard] = useState<File | null>(null);
	const [worlds, setWorlds] = useState<readonly File[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const cardInput = useRef<HTMLInputElement>(null);
	const worldInput = useRef<HTMLInputElement>(null);

	const [canonBooks, setCanonBooks] = useState<
		readonly CanonBookOption[] | null
	>(null);
	const [canonBookId, setCanonBookId] = useState("");
	const [canonEvents, setCanonEvents] = useState<readonly CanonEventRecord[]>(
		[],
	);
	const [canonEventId, setCanonEventId] = useState<number | null>(null);
	const [canonPages, setCanonPages] = useState<readonly CanonStartingPage[]>(
		[],
	);
	const [canonLoading, setCanonLoading] = useState(false);
	const [identity, setIdentity] = useState<Identity>("canon");
	const [characterName, setCharacterName] = useState("");
	const [customName, setCustomName] = useState("");
	const [customPersona, setCustomPersona] = useState("");
	const [canonCard, setCanonCard] = useState<File | null>(null);
	const [canonDragging, setCanonDragging] = useState(false);
	const canonCardInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !busy) onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [busy, onClose]);

	// 只列出已经汇编过的原著；导入或汇编完成后重新打开弹窗会看到它们。
	useEffect(() => {
		if (mode !== "canon" || canonBooks !== null) return;
		let alive = true;
		setCanonLoading(true);
		void api
			.getCanonExtractionOverview()
			.then((view) => {
				if (!alive) return;
				const options = view.books
					.filter((item) => item.compilation?.status === "done")
					.map((item) => ({ id: item.book.id, title: item.book.title }));
				setCanonBooks(options);
				setCanonBookId((current) => current || (options[0]?.id ?? ""));
			})
			.catch((value: unknown) => {
				if (alive) setError(errorText(value));
			})
			.finally(() => {
				if (alive) setCanonLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [mode, canonBooks]);

	useEffect(() => {
		if (canonBookId === "") return;
		let alive = true;
		setCanonLoading(true);
		setCanonEvents([]);
		setCanonEventId(null);
		setCanonPages([]);
		void api
			.getCanonCompiled(canonBookId)
			.then((view) => {
				if (!alive) return;
				const events = timeline(view.events);
				setCanonEvents(events);
				setCanonEventId(events[0]?.id ?? null);
			})
			.catch((value: unknown) => {
				if (alive) setError(errorText(value));
			})
			.finally(() => {
				if (alive) setCanonLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [canonBookId]);

	useEffect(() => {
		const event = canonEvents.find((item) => item.id === canonEventId);
		if (canonBookId === "" || event === undefined) return;
		let alive = true;
		setCanonLoading(true);
		void api
			.getCanonCompiled(canonBookId, event.chapterOrdinal)
			.then((view) => {
				if (!alive) return;
				const pages = (view.pages ?? []).filter((page) => page.kind === "人物");
				setCanonPages(pages);
				setCharacterName((current) =>
					pages.some((page) => page.name === current)
						? current
						: (pages[0]?.name ?? ""),
				);
				if (pages.length === 0) setIdentity("custom");
			})
			.catch((value: unknown) => {
				if (alive) setError(errorText(value));
			})
			.finally(() => {
				if (alive) setCanonLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [canonBookId, canonEventId, canonEvents]);

	const onDrop = (event: DragEvent<HTMLButtonElement>) => {
		event.preventDefault();
		setDragging(false);
		const files = [...event.dataTransfer.files];
		const first = files.find((file) => /\.(png|json)$/i.test(file.name));
		if (first !== undefined) setCard(first);
	};

	const onCanonDrop = (event: DragEvent<HTMLButtonElement>) => {
		event.preventDefault();
		setCanonDragging(false);
		const files = [...event.dataTransfer.files];
		const first = files.find((file) => /\.(png|json)$/i.test(file.name));
		if (first !== undefined) setCanonCard(first);
	};

	const submitCanon = async () => {
		if (canonBookId === "") {
			setError("先选一本已汇编的原著");
			return;
		}
		if (canonEventId === null) {
			setError("先选开局事件");
			return;
		}
		if (identity === "canon" && characterName === "") {
			setError("先选一个扮演的原著人物");
			return;
		}
		if (identity === "custom" && customName.trim() === "") {
			setError("自创人物要填名字");
			return;
		}
		setBusy(true);
		try {
			const name = title.trim();
			const result = await api.startCanonStory({
				...(name.length === 0 ? {} : { title: name }),
				bookId: canonBookId,
				startEventId: canonEventId,
				identityKind: identity,
				playerName: identity === "canon" ? characterName : customName.trim(),
				...(identity === "custom" && customPersona.trim().length > 0
					? { persona: customPersona }
					: {}),
				...(canonCard === null ? {} : { card: await readCard(canonCard) }),
			});
			onClose();
			navigate(`/stories/${encodeURIComponent(result.story.id)}/play`);
		} catch (value) {
			setError(errorText(value));
			setBusy(false);
		}
	};

	const submit = async () => {
		setError(null);
		if (mode === "canon") {
			await submitCanon();
			return;
		}
		if (mode === "card" && card === null) {
			setError("先选一张角色卡");
			return;
		}
		setBusy(true);
		try {
			const name = title.trim();
			const story = await api.createStory({
				title: name.length > 0 ? name : mode === "card" ? "新故事" : "空白故事",
			});
			if (mode === "card" && card !== null) {
				const result = await api.importCard(story.id, {
					card: await readCard(card),
					...(worlds.length === 0
						? {}
						: { worlds: await Promise.all(worlds.map((file) => file.text())) }),
				});
				if (name.length === 0 && result.cardName.trim().length > 0) {
					await api.updateStory(story.id, { title: result.cardName.trim() });
				}
			}
			onClose();
			navigate(`/stories/${encodeURIComponent(story.id)}/play`);
		} catch (value) {
			setError(errorText(value));
			setBusy(false);
		}
	};

	const selectedPage = canonPages.find((page) => page.name === characterName);
	const book = canonBooks?.find((item) => item.id === canonBookId) ?? null;
	const event = canonEvents.find((item) => item.id === canonEventId) ?? null;

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: Esc 在 window 上处理
		<div
			className="scrim"
			onClick={(event) => {
				if (event.target === event.currentTarget && !busy) onClose();
			}}
		>
			<form
				className="dialog new-story"
				aria-label="新建故事"
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<header>
					<h2>新建故事</h2>
					<button
						type="button"
						className="btn ghost sm"
						aria-label="关闭"
						onClick={onClose}
						disabled={busy}
					>
						✕
					</button>
				</header>
				<Seg<Mode>
					label="开局方式"
					value={mode}
					options={[
						{ v: "card", label: "导入角色卡" },
						{ v: "blank", label: "空白开局" },
						{ v: "canon", label: "从原著开局" },
					]}
					onChange={setMode}
				/>
				{mode === "card" ? (
					<>
						<button
							type="button"
							className="dropzone"
							data-dragging={dragging ? "" : undefined}
							onClick={() => cardInput.current?.click()}
							onDragOver={(event) => {
								event.preventDefault();
								setDragging(true);
							}}
							onDragLeave={() => setDragging(false)}
							onDrop={onDrop}
							disabled={busy}
						>
							{card === null ? (
								<>
									<b>选择角色卡</b>
									<span>PNG 或 JSON，也可以拖到这里</span>
								</>
							) : (
								<>
									<b>{card.name}</b>
									<span>点击更换</span>
								</>
							)}
						</button>
						<input
							ref={cardInput}
							type="file"
							accept=".png,.json,image/png,application/json"
							hidden
							aria-label="角色卡文件"
							onChange={(event) => {
								const file = event.target.files?.[0];
								event.target.value = "";
								if (file !== undefined) setCard(file);
							}}
						/>
						<div className="world-pick">
							<button
								type="button"
								className="btn ghost sm"
								onClick={() => worldInput.current?.click()}
								disabled={busy}
							>
								添加世界书（可选）
							</button>
							<span className="muted">
								{worlds.length === 0
									? "卡里自带的世界书会一起导入"
									: worlds.map((file) => file.name).join("、")}
							</span>
							<input
								ref={worldInput}
								type="file"
								accept=".json,application/json"
								multiple
								hidden
								aria-label="世界书文件"
								onChange={(event) => {
									setWorlds([...(event.target.files ?? [])]);
									event.target.value = "";
								}}
							/>
						</div>
					</>
				) : null}
				{mode === "canon" ? (
					<div className="canon-start">
						{canonBooks === null ? (
							<p className="muted">
								{canonLoading ? "正在读取原著…" : "正在准备原著列表…"}
							</p>
						) : canonBooks.length === 0 ? (
							<p className="muted">还没有汇编过的原著。</p>
						) : (
							<>
								<label className="field">
									<span>原著</span>
									<select
										aria-label="原著"
										value={canonBookId}
										onChange={(event) => setCanonBookId(event.target.value)}
										disabled={busy}
									>
										{canonBooks.map((item) => (
											<option key={item.id} value={item.id}>
												{item.title}
											</option>
										))}
									</select>
								</label>
								<label className="field">
									<span>开局事件</span>
									<select
										aria-label="开局事件"
										value={canonEventId === null ? "" : String(canonEventId)}
										onChange={(event) => {
											const value = Number(event.target.value);
											setCanonEventId(
												Number.isInteger(value) && value > 0 ? value : null,
											);
										}}
										disabled={busy || canonEvents.length === 0}
									>
										{canonEvents.length === 0 ? (
											<option value="">没有主时间线事件</option>
										) : null}
										{canonEvents.map((item, index) => (
											<option key={item.id} value={String(item.id)}>
												{`${index + 1}. ${item.title}${
													item.isTurningPoint ? "（关键转折）" : ""
												}`}
											</option>
										))}
									</select>
								</label>
								{event === null ? null : (
									<p className="muted">
										第 {event.chapterOrdinal} 章 · {event.summary}
									</p>
								)}
								<Seg<Identity>
									label="扮演身份"
									value={identity}
									options={[
										{ v: "canon", label: "原著人物" },
										{ v: "custom", label: "自创人物" },
									]}
									onChange={setIdentity}
								/>
								{identity === "canon" ? (
									canonPages.length === 0 ? (
										<p className="muted">可以改用自创人物。</p>
									) : (
										<>
											<label className="field">
												<span>扮演人物</span>
												<select
													aria-label="扮演人物"
													value={characterName}
													onChange={(event) =>
														setCharacterName(event.target.value)
													}
													disabled={busy}
												>
													{canonPages.map((page) => (
														<option key={page.name} value={page.name}>
															{page.name}
														</option>
													))}
												</select>
											</label>
											{selectedPage === undefined ? null : (
												<p className="muted">
													{selectedPage.lead.length === 0
														? "开局前还没有简介。"
														: selectedPage.lead}
												</p>
											)}
										</>
									)
								) : (
									<>
										<label className="field">
											<span>扮演名字</span>
											<input
												value={customName}
												placeholder="你在这个故事里的名字"
												onChange={(event) => setCustomName(event.target.value)}
												disabled={busy}
											/>
										</label>
										<label className="field">
											<span>人设（可选）</span>
											<textarea
												value={customPersona}
												placeholder="身份与来历"
												rows={3}
												onChange={(event) =>
													setCustomPersona(event.target.value)
												}
												disabled={busy}
											/>
										</label>
									</>
								)}
								<button
									type="button"
									className="dropzone"
									data-dragging={canonDragging ? "" : undefined}
									onClick={() => canonCardInput.current?.click()}
									onDragOver={(event) => {
										event.preventDefault();
										setCanonDragging(true);
									}}
									onDragLeave={() => setCanonDragging(false)}
									onDrop={onCanonDrop}
									disabled={busy}
								>
									{canonCard === null ? (
										<>
											<b>叠加角色卡（可选，提供文风与规则）</b>
											<span>PNG 或 JSON，也可以拖到这里</span>
										</>
									) : (
										<>
											<b>{canonCard.name}</b>
											<span>点击更换</span>
										</>
									)}
								</button>
								<input
									ref={canonCardInput}
									type="file"
									accept=".png,.json,image/png,application/json"
									hidden
									aria-label="叠加角色卡文件"
									onChange={(event) => {
										const file = event.target.files?.[0];
										event.target.value = "";
										if (file !== undefined) setCanonCard(file);
									}}
								/>
								<p className="muted">卡只提供文风与规则。</p>
							</>
						)}
					</div>
				) : null}
				<label className="field">
					<span>标题</span>
					<input
						value={title}
						placeholder={
							mode === "card"
								? "留空则用卡的名字"
								: mode === "canon"
									? book === null
										? "留空则用书名"
										: `留空则用《${book.title}》`
									: "空白故事"
						}
						onChange={(event) => setTitle(event.target.value)}
						disabled={busy}
					/>
				</label>
				{error === null ? null : <p className="v4err">{error}</p>}
				<footer>
					<button
						type="button"
						className="btn ghost"
						onClick={onClose}
						disabled={busy}
					>
						取消
					</button>
					<button
						type="submit"
						className="btn gold"
						disabled={busy || (mode === "canon" && canonBooks === null)}
					>
						{busy ? "正在创建…" : "开始"}
					</button>
				</footer>
			</form>
		</div>
	);
}
