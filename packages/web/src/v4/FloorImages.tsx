import type { ImageWorkflowRecord } from "@dramaticer/core";
import type { NodeImage } from "@dramaticer/protocol";
import { useEffect, useState } from "react";
import { api } from "../api";
import { ImageZoom } from "../components/chat/ImageZoom";
import { errorText } from "./ui";

type Panel = "none" | "edit" | "switch";

/** 楼层里的一张插图：按状态显示图片、绘制提示或失败菜单。 */
export function FloorImage({
	image,
	workflows,
	onChanged,
}: {
	readonly image: NodeImage;
	readonly workflows: readonly ImageWorkflowRecord[];
	readonly onChanged: () => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [panel, setPanel] = useState<Panel>("none");
	const [prompt, setPrompt] = useState(image.prompt ?? "");
	const [negative, setNegative] = useState(image.negativePrompt ?? "");
	const [workflowId, setWorkflowId] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [zoom, setZoom] = useState(false);
	const label = image.title ?? "插图";
	const others = workflows.filter(
		(workflow) => workflow.id !== image.workflowId,
	);

	useEffect(() => {
		setPrompt(image.prompt ?? "");
		setNegative(image.negativePrompt ?? "");
	}, [image.prompt, image.negativePrompt]);

	const run = (action: () => Promise<unknown>) => {
		if (busy) return;
		setBusy(true);
		setError(null);
		action()
			.then(() => {
				setMenuOpen(false);
				setPanel("none");
				onChanged();
			})
			.catch((value: unknown) => setError(errorText(value)))
			.finally(() => setBusy(false));
	};

	const openPanel = (next: Panel) => {
		setError(null);
		if (next === "switch" && workflowId === "") {
			setWorkflowId(others[0]?.id ?? "");
		}
		setPanel((current) => (current === next ? "none" : next));
	};

	const menuActions = (
		<>
			{image.status === "failed" ? (
				<button
					type="button"
					role="menuitem"
					disabled={busy}
					onClick={() => run(() => api.retryImage(image.id))}
				>
					重试
				</button>
			) : null}
			<button
				type="button"
				role="menuitem"
				disabled={busy}
				onClick={() =>
					run(() => api.redrawImage(image.id, { mode: "new_seed" }))
				}
			>
				重绘（换 seed）
			</button>
			<button type="button" role="menuitem" onClick={() => openPanel("edit")}>
				改提示词后重绘
			</button>
			<button type="button" role="menuitem" onClick={() => openPanel("switch")}>
				换模板
			</button>
			<button
				type="button"
				role="menuitem"
				disabled={busy}
				onClick={() => run(() => api.deleteImage(image.id))}
			>
				删除
			</button>
		</>
	);

	const panels = (
		<>
			{panel === "edit" ? (
				<form
					className="floor-ill-panel"
					aria-label="改提示词后重绘"
					onSubmit={(event) => {
						event.preventDefault();
						if (prompt.trim() === "") {
							setError("提示词不能为空");
							return;
						}
						run(() =>
							api.redrawImage(image.id, {
								mode: "edit_prompt",
								prompt,
								negativePrompt: negative.trim() === "" ? null : negative,
							}),
						);
					}}
				>
					<label>
						<span>提示词</span>
						<textarea
							rows={3}
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
						/>
					</label>
					<label>
						<span>负面提示词</span>
						<textarea
							rows={2}
							value={negative}
							onChange={(event) => setNegative(event.target.value)}
						/>
					</label>
					<div className="floor-ill-panel-acts">
						<button
							type="button"
							className="btn ghost sm"
							disabled={busy}
							onClick={() => setPanel("none")}
						>
							取消
						</button>
						<button
							type="submit"
							className="btn gold sm"
							disabled={busy || prompt.trim() === ""}
						>
							{busy ? "重绘中…" : "按新提示词重绘"}
						</button>
					</div>
				</form>
			) : null}
			{panel === "switch" ? (
				<form
					className="floor-ill-panel"
					aria-label="换模板"
					onSubmit={(event) => {
						event.preventDefault();
						if (workflowId === "") {
							setError("请选择模板");
							return;
						}
						run(() =>
							api.redrawImage(image.id, {
								mode: "switch_workflow",
								workflowId,
							}),
						);
					}}
				>
					<label>
						<span>新模板</span>
						<select
							value={workflowId}
							onChange={(event) => setWorkflowId(event.target.value)}
						>
							{others.length === 0 ? (
								<option value="">没有其他可用模板</option>
							) : null}
							{others.map((workflow) => (
								<option key={workflow.id} value={workflow.id}>
									{workflow.name}
								</option>
							))}
						</select>
					</label>
					<div className="floor-ill-panel-acts">
						<button
							type="button"
							className="btn ghost sm"
							disabled={busy}
							onClick={() => setPanel("none")}
						>
							取消
						</button>
						<button
							type="submit"
							className="btn gold sm"
							disabled={busy || workflowId === ""}
						>
							{busy ? "切换中…" : "确定"}
						</button>
					</div>
				</form>
			) : null}
		</>
	);

	if (image.status === "pending" || image.status === "running") {
		return (
			<output className="floor-ill pending" data-image-id={image.id}>
				正在绘制：{label}…
			</output>
		);
	}

	if (image.status === "failed") {
		return (
			<figure className="floor-ill failed" data-image-id={image.id}>
				<div className="floor-ill-head">
					<figcaption>{label}</figcaption>
				</div>
				<p className="floor-ill-err">出图失败：{image.error ?? "未知错误"}</p>
				<div
					className="floor-ill-menu"
					role="menu"
					aria-label={`插图菜单：${label}`}
				>
					{menuActions}
				</div>
				{panels}
				{error === null ? null : (
					<p className="floor-ill-err" role="alert">
						{error}
					</p>
				)}
			</figure>
		);
	}

	return (
		<>
			<figure className="floor-ill" data-image-id={image.id}>
				<div className="floor-ill-head">
					<figcaption>{label}</figcaption>
					<button
						type="button"
						className="floor-ill-more"
						aria-label={`插图操作：${label}`}
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						onClick={() => {
							setError(null);
							setPanel("none");
							setMenuOpen((value) => !value);
						}}
					>
						⋯
					</button>
				</div>
				<button
					type="button"
					className="floor-ill-img"
					aria-label={`放大插图：${label}`}
					onClick={() => setZoom(true)}
				>
					<img
						src={image.url ?? ""}
						alt={label}
						width={image.width ?? undefined}
						height={image.height ?? undefined}
						loading="lazy"
					/>
				</button>
				{menuOpen ? (
					<div
						className="floor-ill-menu"
						role="menu"
						aria-label={`插图菜单：${label}`}
					>
						{menuActions}
					</div>
				) : null}
				{panels}
				{error === null ? null : (
					<p className="floor-ill-err" role="alert">
						{error}
					</p>
				)}
			</figure>
			{zoom && image.url !== null ? (
				<ImageZoom src={image.url} onClose={() => setZoom(false)} />
			) : null}
		</>
	);
}

/** 插件渲染的楼层没有可定位的段落；插图统一排在楼层下方。 */
export function FloorImageList({
	images,
	workflows,
	onChanged,
}: {
	readonly images: readonly NodeImage[];
	readonly workflows: readonly ImageWorkflowRecord[];
	readonly onChanged: () => void;
}) {
	if (images.length === 0) return null;
	return (
		<div className="floor-ill-end">
			{images.map((image) => (
				<FloorImage
					key={image.id}
					image={image}
					workflows={workflows}
					onChanged={onChanged}
				/>
			))}
		</div>
	);
}
