import type { ImportStoryRequest } from "@dramaticer/protocol";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Seg, errorText } from "./ui";

type Mode = "card" | "blank";

type CardFile = ImportStoryRequest["card"];

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

/** 新建故事：导入角色卡或空白开局；完成后直接进入故事页。 */
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

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !busy) onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [busy, onClose]);

	const onDrop = (event: DragEvent<HTMLButtonElement>) => {
		event.preventDefault();
		setDragging(false);
		const files = [...event.dataTransfer.files];
		const first = files.find((file) => /\.(png|json)$/i.test(file.name));
		if (first !== undefined) setCard(first);
	};

	const submit = async () => {
		setError(null);
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
				<label className="field">
					<span>标题</span>
					<input
						value={title}
						placeholder={mode === "card" ? "留空则用卡的名字" : "空白故事"}
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
					<button type="submit" className="btn gold" disabled={busy}>
						{busy ? "正在创建…" : "开始"}
					</button>
				</footer>
			</form>
		</div>
	);
}
