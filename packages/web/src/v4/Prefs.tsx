import type {
	FeatureTier,
	StoryFeatureSwitchView,
	WritingEntry,
} from "@dramaticer/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { AdvancedSettings } from "./AdvancedSettings";
import { usePaletteCommands } from "./Shell";
import { WritingEntries } from "./WritingEntries";
import { type Theme, onThemeChange, setTheme, storedTheme } from "./stage";
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
	readonly entries?: readonly WritingEntry[];
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
			["off", "关闭"],
			["low", "低"],
			["high", "高"],
		],
	},
];

const TABS = [
	["write", "写作"],
	["feat", "功能"],
	["model", "模型"],
	["adv", "高级"],
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
	const canon = useLoad(() => api.getStoryCanon(storyId), [storyId]);
	const stats = useLoad<FeatureStats>(
		() => api.get(sp(storyId, "/features/stats")),
		[storyId],
	);
	// 渠道配置提醒（例如后台保底与主模型共用渠道）；没有渠道文件时为空。
	const channelWarnings = useLoad<readonly string[]>(
		() =>
			tab === "model"
				? api
						.getChannels()
						.then((view) => view.warnings)
						.catch(() => [])
				: Promise.resolve([]),
		[tab],
	);
	const card = useLoad<CardView>(
		() => api.get(sp(storyId, "/card")),
		[storyId],
	);
	const presetFile = useRef<HTMLInputElement | null>(null);
	const [theme, setThemeState] = useState<Theme>(storedTheme);
	useEffect(() => onThemeChange(setThemeState), []);
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
	const setTier = useCallback(
		(tier: FeatureTier) =>
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
							lite: "轻量",
							standard: "标准",
							immersive: "完整",
						}[tier],
					);
				},
			),
		[act, features.reload, storyId, toast],
	);

	usePaletteCommands(
		useCallback(
			() => [
				{ label: "档位 · 轻量", run: () => setTier("lite") },
				{ label: "档位 · 标准", run: () => setTier("standard") },
				{ label: "档位 · 完整", run: () => setTier("immersive") },
			],
			[setTier],
		),
	);

	let enabled = 0;
	for (const group of features.data?.groups ?? []) {
		for (const item of group.switches) {
			const on = item.value !== false && item.value !== "off";
			if (!on) continue;
			enabled += 1;
		}
	}

	return (
		<section data-view="prefs">
			<div className="vh">
				<div>
					<h1>设置</h1>
				</div>
				<Seg<FeatureTier>
					label="档位"
					value={features.data?.tier ?? null}
					options={[
						{ v: "lite", label: "轻量" },
						{ v: "standard", label: "标准" },
						{ v: "immersive", label: "完整" },
					]}
					onChange={setTier}
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
					{canon.data?.bound === null ||
					canon.data?.bound === undefined ? null : (
						<div className="dial" data-canon-settings="">
							<div>
								<h3>原著窗口</h3>
								<p>
									《{canon.data.bound.bookTitle}》当前演到「
									{canon.data.bound.currentEvent?.title ?? "—"}」。
									关掉「知道全书」时，人物页与世界索引只取游标之前的内容。
								</p>
							</div>
							<div className="stat" style={{ flexWrap: "wrap", gap: 8 }}>
								<span>允许模型知道全书</span>
								<Sw
									label="允许模型知道全书"
									checked={canon.data.bound.allowFullBookSpoilers}
									onChange={(value) =>
										act(
											() =>
												api.updateStoryCanonSettings(storyId, {
													allowFullBookSpoilers: value,
												}),
											() => canon.reload(),
										)
									}
								/>
								<Seg<string>
									small
									label="原著窗口内容"
									value={canon.data.bound.windowMode}
									options={[
										{ v: "summary_only", label: "概要" },
										{ v: "summary_voice", label: "概要+话术" },
										{ v: "full_text", label: "原文" },
									]}
									onChange={(value) =>
										act(
											() =>
												api.updateStoryCanonSettings(storyId, {
													windowMode: value as
														| "summary_only"
														| "summary_voice"
														| "full_text",
												}),
											() => canon.reload(),
										)
									}
								/>
							</div>
						</div>
					)}
					<div className="dial">
						<div>
							<h3>外观</h3>
							<p>跟随系统时随设备切换深浅色</p>
						</div>
						<Seg<Theme>
							label="外观"
							value={theme}
							options={[
								{ v: "auto", label: "跟随系统" },
								{ v: "light", label: "亮" },
								{ v: "dark", label: "暗" },
							]}
							onChange={(value) => {
								setThemeState(value);
								setTheme(value);
							}}
						/>
					</div>
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
									? "还没有导入预设。"
									: `「${writing.data.preset.name}」共 ${writing.data.preset.total} 条：${writing.data.preset.mapped} 条变成上面的选项，${writing.data.preset.packCount} 条成为写作条目。`}
							</p>
							<div className="stat">
								<button
									type="button"
									className="btn sm"
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
						<div className="sw-row">
							<span className="num">文风包</span>
							<Sw
								label="文风包"
								checked={writing.data.dials.stylePack === true}
								onChange={(value) => setDial({ stylePack: value })}
							/>
						</div>
					</div>
					<WritingEntries
						storyId={storyId}
						entries={writing.data.entries ?? []}
						onSaved={writing.reload}
					/>
					<div className="dial">
						<div>
							<h3>卡的推荐</h3>
							<p>
								{writing.data.recommended === null
									? "这张卡没有带推荐的写作选项。"
									: `这张卡带了推荐配置（你改过 ${Object.keys(writing.data.overrides).length} 项）。`}
								{card.data?.card
									? ` 卡版本 ${card.data.card.version.slice(0, 8)}（${new Date(card.data.card.importedAt).toLocaleDateString()} 载入）。`
									: ""}
							</p>
							<div className="stat">
								<button
									type="button"
									className="btn ghost sm"
									onClick={() => cardFile.current?.click()}
								>
									对比并升级卡
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
											await api.call("POST", sp(storyId, "/card/diff"), {
												card: payload,
												apply: true,
											});
											writing.reload();
											card.reload();
											features.reload();
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
										features.reload();
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
									return (
										<div className="dial" key={item.id}>
											<div>
												<h3>
													{item.label}
													{item.wired ? null : (
														<span
															className="pending-tag"
															title="已保存，运行时尚未读取"
														>
															尚未生效
														</span>
													)}
												</h3>
												{item.description ? <p>{item.description}</p> : null}
												<div className="stat">
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
						<span className="num">开了 {enabled} 项</span>
					</div>
				</div>
			) : null}

			{tab === "model" ? (
				<div id="models">
					<div className="dial">
						<div>
							<h3>渠道与模型</h3>
							{(channelWarnings.data ?? []).length > 0 ? (
								<ul className="channel-warnings" aria-label="渠道配置提醒">
									{(channelWarnings.data ?? []).map((warning) => (
										<li key={warning}>{warning}</li>
									))}
								</ul>
							) : null}
							<div className="stat">
								<span>
									{card.data?.recommendedMode
										? `这张卡推荐：${{ fast: "快速", plan: "规划", deep: "深度" }[card.data.recommendedMode] ?? card.data.recommendedMode}`
										: "写法在「实验」里选择，默认快速"}
								</span>
							</div>
						</div>
						<Link
							className="btn"
							style={{ textDecoration: "none" }}
							to="/settings"
						>
							选渠道和模型
						</Link>
					</div>
				</div>
			) : null}
			{tab === "adv" ? <AdvancedSettings storyId={storyId} /> : null}
		</section>
	);
}
