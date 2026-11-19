import type { FeatureTier, StoryFeatureSwitchView } from "@dramaticer/core";
import { useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Seg, Sw, sp, useAct, useLoad, useToast } from "./ui";

interface WritingView {
	readonly dials: Readonly<Record<string, string | boolean>>;
	readonly recommended: Readonly<Record<string, string | boolean>> | null;
	readonly overrides: Readonly<Record<string, string | boolean>>;
	readonly preset: {
		readonly name: string;
		readonly total: number;
		readonly mapped: number;
		readonly packCount: number;
	} | null;
}

interface FeatureStats {
	readonly costs: Readonly<Record<string, number>>;
	readonly uses: Readonly<Record<string, string>>;
}

interface CardView {
	readonly card: {
		readonly name: string;
		readonly version: string;
		readonly importedAt: string;
	} | null;
	readonly recommendedMode: string | null;
}

const DIALS: readonly {
	id: string;
	title: string;
	hint: string;
	choices: readonly [string, string][];
}[] = [
	{
		id: "style",
		title: "文风",
		hint: "跟着卡 / 冷叙述 / 细腻 / 口语",
		choices: [
			["card", "跟着卡"],
			["cold", "冷叙述"],
			["rich", "细腻"],
			["spoken", "口语"],
		],
	},
	{
		id: "person",
		title: "人称",
		hint: "叙述时怎么称呼你",
		choices: [
			["second", "你"],
			["first", "我"],
			["third", "他"],
		],
	},
	{
		id: "length",
		title: "长度",
		hint: "每一楼写多少",
		choices: [
			["short", "短"],
			["medium", "中"],
			["long", "长"],
		],
	},
	{
		id: "pace",
		title: "节奏",
		hint: "没有你指示时走多快",
		choices: [
			["slow", "慢"],
			["medium", "适中"],
			["fast", "快"],
		],
	},
	{
		id: "rating",
		title: "尺度",
		hint: "跟着卡的设定，或者收一点",
		choices: [
			["card", "跟着卡"],
			["restrained", "收敛"],
		],
	},
	{
		id: "thinking",
		title: "思考",
		hint: "写之前想多久",
		choices: [
			["off", "不想"],
			["low", "想一下"],
			["high", "多想"],
		],
	},
];

const TABS = [
	["write", "写作"],
	["feat", "功能"],
	["model", "模型"],
] as const;

/** 设置页：写作选项、功能开关与档位、模型。 */
export function Prefs() {
	const { storyId = "" } = useParams();
	const [search, setSearch] = useSearchParams();
	const act = useAct();
	const toast = useToast();
	const tab = TABS.some(([id]) => id === search.get("tab"))
		? search.get("tab")
		: "write";
	const writing = useLoad<WritingView>(
		() => api.get(sp(storyId, "/writing")),
		[storyId],
	);
	const features = useLoad(() => api.getStoryFeatures(storyId), [storyId]);
	const stats = useLoad<FeatureStats>(
		() => api.get(sp(storyId, "/features/stats")),
		[storyId],
	);
	const card = useLoad<CardView>(
		() => api.get(sp(storyId, "/card")),
		[storyId],
	);
	const presetFile = useRef<HTMLInputElement | null>(null);
	const cardFile = useRef<HTMLInputElement | null>(null);

	const setDial = (patch: Record<string, string | boolean>) =>
		act(
			() => api.call("PUT", sp(storyId, "/writing"), patch),
			() => {
				writing.reload();
				toast("已保存，下一楼生效");
			},
		);
	const setSwitch = (item: StoryFeatureSwitchView, value: unknown) =>
		act(
			() =>
				api.updateSettings(storyId, {
					featureSwitches: { [item.id]: value } as never,
				}),
			() => features.reload(),
		);

	let total = 0;
	let enabled = 0;
	for (const group of features.data?.groups ?? []) {
		for (const item of group.switches) {
			const on = item.value !== false && item.value !== "off";
			if (!on) continue;
			enabled += 1;
			total += stats.data?.costs[item.id] ?? 0;
		}
	}

	return (
		<section data-view="prefs">
			<div className="vh">
				<div>
					<h1>设置</h1>
					<p>每一项都能随时开、随时关。晚开的功能会在后台把前面的楼层补上。</p>
				</div>
				<Seg<FeatureTier>
					label="档位"
					value={features.data?.tier ?? null}
					options={[
						{ v: "lite", label: "省" },
						{ v: "standard", label: "均衡" },
						{ v: "immersive", label: "全开" },
					]}
					onChange={(tier) =>
						act(
							() =>
								api.updateSettings(storyId, {
									featureTier: tier,
									featureSwitches: null,
								}),
							() => {
								features.reload();
								toast(
									{
										lite: "省：只留最必要的几项",
										standard: "均衡：记忆和导演都开",
										immersive: "全开：加上提前备好、插图和配乐",
									}[tier],
								);
							},
						)
					}
				/>
			</div>
			<div className="subtabs">
				{TABS.map(([id, label]) => (
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

			{tab === "write" && writing.data !== null ? (
				<div id="dials">
					{DIALS.map((dial) => (
						<div className="dial" key={dial.id}>
							<div>
								<h3>
									{dial.title}{" "}
									{writing.data?.overrides[dial.id] !== undefined &&
									writing.data.recommended !== null ? (
										<span className="pill gold">你调过</span>
									) : null}
								</h3>
								<p>{dial.hint}</p>
							</div>
							<Seg<string>
								label={dial.title}
								value={String(writing.data?.dials[dial.id] ?? "")}
								options={dial.choices.map(([v, label]) => ({ v, label }))}
								onChange={(value) => setDial({ [dial.id]: value })}
							/>
						</div>
					))}
					<div className="dial">
						<div>
							<h3>替我行动</h3>
							<p>关掉后，角色不会替你说话或做决定</p>
						</div>
						<Sw
							label="替我行动"
							checked={writing.data.dials.actForMe === true}
							onChange={(value) => setDial({ actForMe: value })}
						/>
					</div>
					<div className="dial">
						<div>
							<h3>导入的预设</h3>
							<p>
								{writing.data.preset === null
									? "还没有导入预设。导入后，能对应上的条目会变成上面的选项，其余作为文风包整体开关。"
									: `「${writing.data.preset.name}」${writing.data.preset.total} 条里 ${writing.data.preset.mapped} 条已对应到上面的选项，其余 ${writing.data.preset.packCount} 条作为文风包整体开关`}
							</p>
							<div className="stat">
								<button
									type="button"
									className="btn ghost sm"
									onClick={() => presetFile.current?.click()}
								>
									导入预设文件
								</button>
								<input
									ref={presetFile}
									type="file"
									accept=".json,application/json"
									hidden
									onChange={async (event) => {
										const file = event.target.files?.[0];
										event.target.value = "";
										if (file === undefined) return;
										const text = await file.text();
										await act(
											() =>
												api.call("POST", sp(storyId, "/writing/preset"), {
													name: file.name.replace(/\.json$/i, ""),
													preset: text,
												}),
											() => {
												writing.reload();
												toast("预设已导入");
											},
										);
									}}
								/>
							</div>
						</div>
						<Sw
							label="文风包"
							checked={writing.data.dials.stylePack === true}
							onChange={(value) => setDial({ stylePack: value })}
						/>
					</div>
					<div className="dial">
						<div>
							<h3>卡的推荐</h3>
							<p>
								{writing.data.recommended === null
									? "这张卡没有带推荐的写作选项。"
									: `这张卡带了推荐配置；你的调整叠在它上面（${Object.keys(writing.data.overrides).length} 项）。`}
								{card.data?.card
									? ` 故事固定在卡的 ${card.data.card.version.slice(0, 8)} 版（${new Date(card.data.card.importedAt).toLocaleDateString()} 载入）。`
									: ""}
							</p>
							<div className="stat">
								<button
									type="button"
									className="btn ghost sm"
									onClick={() => cardFile.current?.click()}
								>
									卡更新了？对比并升级
								</button>
								<input
									ref={cardFile}
									type="file"
									accept=".json,.png,application/json,image/png"
									hidden
									onChange={async (event) => {
										const file = event.target.files?.[0];
										event.target.value = "";
										if (file === undefined) return;
										const isPng = file.name.toLowerCase().endsWith(".png");
										let data: string;
										if (isPng) {
											const bytes = new Uint8Array(await file.arrayBuffer());
											let binary = "";
											for (const byte of bytes)
												binary += String.fromCharCode(byte);
											data = btoa(binary);
										} else {
											data = await file.text();
										}
										const payload = { format: isPng ? "png" : "json", data };
										try {
											const diff = await api.call<{
												same: boolean;
												added: readonly string[];
												changed: readonly string[];
												removed: readonly string[];
											}>("POST", sp(storyId, "/card/diff"), { card: payload });
											if (diff.same) {
												toast("这张卡和故事正在用的是同一版");
												return;
											}
											const summary = [
												`新增 ${diff.added.length} 条${diff.added.length > 0 ? `：${diff.added.slice(0, 5).join("、")}` : ""}`,
												`改动 ${diff.changed.length} 条${diff.changed.length > 0 ? `：${diff.changed.slice(0, 5).join("、")}` : ""}`,
												`新版里没有了 ${diff.removed.length} 条`,
											].join("\n");
											if (
												!window.confirm(
													`新版和现在的差异：\n${summary}\n\n升级这个故事吗？你改过的条目保持不变。`,
												)
											) {
												return;
											}
											await api.call("POST", sp(storyId, "/import"), {
												card: payload,
											});
											writing.reload();
											card.reload();
											toast("已升级到新版");
										} catch (error) {
											toast(
												error instanceof Error ? error.message : String(error),
											);
										}
									}}
								/>
							</div>
						</div>
						<button
							type="button"
							className="btn"
							disabled={Object.keys(writing.data.overrides).length === 0}
							onClick={() =>
								act(
									() => api.call("DELETE", sp(storyId, "/writing")),
									() => {
										writing.reload();
										toast("已回到卡的推荐");
									},
								)
							}
						>
							回到推荐
						</button>
					</div>
				</div>
			) : null}

			{tab === "feat" ? (
				<div>
					<div id="groups">
						{(features.data?.groups ?? []).map((group) => (
							<div className="grp" key={group.group}>
								<h2>{group.label}</h2>
								{group.switches.map((item) => {
									const cost = stats.data?.costs[item.id] ?? 0;
									return (
										<div className="dial" key={item.id}>
											<div>
												<h3>{item.label}</h3>
												{item.description ? <p>{item.description}</p> : null}
												<div className="stat">
													<span className="num">
														{cost > 0 ? `每轮约 ${cost} token` : "不多花"}
													</span>
													<span>{stats.data?.uses[item.id] ?? "—"}</span>
												</div>
											</div>
											{item.kind === "toggle" ? (
												<Sw
													label={item.label}
													checked={item.value === true}
													onChange={(value) => setSwitch(item, value)}
												/>
											) : item.kind === "choice" ? (
												<Seg<string>
													small
													label={item.label}
													value={String(item.value)}
													options={item.choices.map((choice) => ({
														v: String(choice.value),
														label: choice.label,
													}))}
													onChange={(value) => setSwitch(item, value)}
												/>
											) : (
												<input
													className="v4in"
													style={{ width: 80 }}
													type="number"
													min={item.minimum ?? undefined}
													max={item.maximum ?? undefined}
													defaultValue={Number(item.value)}
													onBlur={(event) => {
														const value = Number(event.target.value);
														if (
															Number.isFinite(value) &&
															value !== item.value
														) {
															void setSwitch(item, value);
														}
													}}
												/>
											)}
										</div>
									);
								})}
							</div>
						))}
					</div>
					<div className="total">
						<span>
							按现在的开关，每轮后台约{" "}
							<b className="num">{total.toLocaleString()}</b> token
						</span>
						<span className="num">开了 {enabled} 项 · 正文另算</span>
					</div>
				</div>
			) : null}

			{tab === "model" ? (
				<div id="models">
					<div className="dial">
						<div>
							<h3>渠道与模型</h3>
							<p>写正文、后台记账、每章规划各用哪个模型；密钥只存在本机。</p>
							<div className="stat">
								<span>
									{card.data?.recommendedMode
										? `这张卡推荐的写法：${{ fast: "快速", plan: "规划", deep: "深度" }[card.data.recommendedMode] ?? card.data.recommendedMode}`
										: "写法在故事页的输入台旁切换"}
								</span>
							</div>
						</div>
						<Link
							className="btn"
							style={{ textDecoration: "none" }}
							to={`/stories/${encodeURIComponent(storyId)}/channels`}
						>
							选渠道和模型 ›
						</Link>
					</div>
					<div className="dial">
						<div>
							<h3>高级设置</h3>
							<p>上下文模板、导演的细项、出图工作流。</p>
						</div>
						<Link
							className="btn"
							style={{ textDecoration: "none" }}
							to={`/stories/${encodeURIComponent(storyId)}/settings`}
						>
							打开 ›
						</Link>
					</div>
				</div>
			) : null}
		</section>
	);
}
