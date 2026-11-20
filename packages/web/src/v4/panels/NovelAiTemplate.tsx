import type { NovelAiParameters } from "@dramaticer/core";
import { type ReactNode, useState } from "react";
import { api } from "../../api";

// 与 core 的 DEFAULT_NOVELAI_PARAMETERS 一致；前端不引入 core 的运行时代码。
const DEFAULTS: NovelAiParameters = {
	model: "nai-diffusion-4-5-full",
	width: 832,
	height: 1216,
	steps: 28,
	scale: 5,
	sampler: "k_euler_ancestral",
	noiseSchedule: "karras",
	sm: false,
	smDyn: false,
	varietyBoost: false,
	qualityTags: "best quality, amazing quality, very aesthetic, absurdres",
	negativeTags:
		"lowres, bad anatomy, bad hands, text, error, worst quality, jpeg artifacts, watermark, signature",
};

const MODELS: readonly [string, string][] = [
	["nai-diffusion-4-5-full", "V4.5 Full"],
	["nai-diffusion-4-5-curated", "V4.5 Curated"],
	["nai-diffusion-4-full", "V4 Full"],
	["nai-diffusion-4-curated-preview", "V4 Curated"],
	["nai-diffusion-3", "V3 Anime"],
	["nai-diffusion-furry-3", "V3 Furry"],
];

const SIZES: readonly [string, number, number][] = [
	["竖图 832×1216", 832, 1216],
	["横图 1216×832", 1216, 832],
	["方图 1024×1024", 1024, 1024],
];

const SAMPLERS: readonly string[] = [
	"k_euler_ancestral",
	"k_euler",
	"k_dpmpp_2s_ancestral",
	"k_dpmpp_2m_sde",
	"k_dpmpp_2m",
	"k_dpmpp_sde",
];

function Row({
	label,
	children,
}: { readonly label: string; readonly children: ReactNode }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: label 直接包住输入控件
		<label className="plan-field">
			<span>{label}</span>
			{children}
		</label>
	);
}

/** 新建或覆盖一个 NovelAI 出图模板；只有配置了 novelai 后端时显示。 */
export function NovelAiTemplateForm({
	providers,
	onSaved,
}: {
	readonly providers: readonly string[];
	readonly onSaved: () => void;
}) {
	const [name, setName] = useState("NovelAI");
	const [provider, setProvider] = useState(providers[0] ?? "");
	const [params, setParams] = useState<NovelAiParameters>(DEFAULTS);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const set = (patch: Partial<NovelAiParameters>) =>
		setParams({ ...params, ...patch });
	const sizeKey = `${params.width}x${params.height}`;

	const save = async () => {
		setBusy(true);
		setMessage(null);
		try {
			await api.call("POST", "/api/images/workflows/novelai", {
				name: name.trim(),
				provider,
				parameters: params,
			});
			setMessage("已保存。在故事设置的「生图」里选这个模板即可。");
			onSaved();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="director-section" aria-label="NovelAI 模板">
			<header className="director-section-head">
				<h2>NovelAI 模板</h2>
			</header>
			<div className="settings-grid">
				<Row label="名称">
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</Row>
				{providers.length > 1 ? (
					<Row label="后端">
						<select
							value={provider}
							onChange={(event) => setProvider(event.target.value)}
						>
							{providers.map((id) => (
								<option key={id} value={id}>
									{id}
								</option>
							))}
						</select>
					</Row>
				) : null}
				<Row label="模型">
					<select
						value={params.model}
						onChange={(event) => set({ model: event.target.value })}
					>
						{MODELS.map(([id, label]) => (
							<option key={id} value={id}>
								{label}
							</option>
						))}
					</select>
				</Row>
				<Row label="尺寸">
					<select
						value={sizeKey}
						onChange={(event) => {
							const size = SIZES.find(
								([, w, h]) => `${w}x${h}` === event.target.value,
							);
							if (size !== undefined) set({ width: size[1], height: size[2] });
						}}
					>
						{SIZES.map(([label, w, h]) => (
							<option key={label} value={`${w}x${h}`}>
								{label}
							</option>
						))}
					</select>
				</Row>
				<Row label="步数">
					<input
						type="number"
						min={1}
						max={50}
						value={params.steps}
						onChange={(event) =>
							set({ steps: Math.trunc(Number(event.target.value) || 1) })
						}
					/>
				</Row>
				<Row label="引导强度">
					<input
						type="number"
						min={0}
						max={10}
						step={0.1}
						value={params.scale}
						onChange={(event) =>
							set({ scale: Number(event.target.value) || 0 })
						}
					/>
				</Row>
				<Row label="采样器">
					<select
						value={params.sampler}
						onChange={(event) => set({ sampler: event.target.value })}
					>
						{SAMPLERS.map((id) => (
							<option key={id} value={id}>
								{id}
							</option>
						))}
					</select>
				</Row>
				<Row label="画质标签（加在提示词后）">
					<input
						value={params.qualityTags}
						onChange={(event) => set({ qualityTags: event.target.value })}
					/>
				</Row>
				<Row label="固定负面标签">
					<input
						value={params.negativeTags}
						onChange={(event) => set({ negativeTags: event.target.value })}
					/>
				</Row>
			</div>
			<div className="plan-toolbar">
				<button
					type="button"
					onClick={() => void save()}
					disabled={busy || name.trim() === ""}
				>
					{busy ? "正在保存…" : "保存模板"}
				</button>
				{message === null ? null : <span className="muted">{message}</span>}
			</div>
		</section>
	);
}
