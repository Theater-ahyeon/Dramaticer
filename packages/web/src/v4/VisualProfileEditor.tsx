import type {
	CharacterOutfit,
	CharacterVisualProfile,
	TagLibraryEntry,
	VisualDressState,
	VisualSlotPart,
	VisualSlotView,
	WritingEntry,
} from "@dramaticer/core";
import {
	TAG_LIBRARY_CATEGORIES,
	TAG_LIBRARY_CATEGORY_LABELS,
	VISUAL_DRESS_STATES,
	VISUAL_SLOT_PARTS,
	VISUAL_SLOT_VIEWS,
} from "@dramaticer/core/image-vocabulary";
import { type ReactNode, useState } from "react";
import { api } from "../api";
import { Sw, errorText, sp, useLoad } from "./ui";

const PART_LABELS: Readonly<Record<VisualSlotPart, string>> = {
	face: "脸",
	upper: "上身",
	full: "全身",
};

const VIEW_LABELS: Readonly<Record<VisualSlotView, string>> = {
	front: "正面",
	back: "背面",
};

const STATE_LABELS: Readonly<Record<VisualDressState, string>> = {
	clothed: "着装",
	bare: "裸露",
};

function tagsToText(tags: readonly string[]): string {
	return tags.join("、");
}

function textToTags(text: string): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of text.split(/[、,，;；\n]+/)) {
		const tag = item.trim();
		if (tag.length === 0 || seen.has(tag)) continue;
		seen.add(tag);
		result.push(tag);
	}
	return result;
}

function nowText(): string {
	return new Date().toISOString();
}

function Field({
	label,
	children,
}: {
	readonly label: string;
	readonly children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: label 直接包住调用方传入的输入控件
		<label className="plan-field">
			<span>{label}</span>
			{children}
		</label>
	);
}

/** 设定页的视觉档案、服装、标签库、画面整理条目与导入。 */
export function VisualProfileEditor({
	storyId,
}: {
	readonly storyId: string;
}) {
	const profilesLoad = useLoad(() => api.getVisualProfiles(storyId), [storyId]);
	const outfitsLoad = useLoad(
		() => api.getCharacterOutfits(storyId),
		[storyId],
	);
	const tagsLoad = useLoad(() => api.getStoryTagLibrary(storyId), [storyId]);
	const writingLoad = useLoad(
		() =>
			api.get<{ entries?: readonly WritingEntry[] }>(sp(storyId, "/writing")),
		[storyId],
	);
	const [profileDraft, setProfileDraft] =
		useState<CharacterVisualProfile | null>(null);
	const [outfitDraft, setOutfitDraft] = useState<CharacterOutfit | null>(null);
	const [tagDraft, setTagDraft] = useState<TagLibraryEntry | null>(null);
	const [entryDraft, setEntryDraft] = useState<WritingEntry | null>(null);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const reloadAll = (): void => {
		profilesLoad.reload();
		outfitsLoad.reload();
		tagsLoad.reload();
		writingLoad.reload();
	};

	const run = async (
		work: () => Promise<unknown>,
		done: string,
	): Promise<boolean> => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await work();
			setNotice(done);
			reloadAll();
			return true;
		} catch (value) {
			setError(errorText(value));
			return false;
		} finally {
			setBusy(false);
		}
	};

	const profiles = profilesLoad.data?.profiles ?? [];
	const outfits = outfitsLoad.data?.outfits ?? [];
	const allTags = tagsLoad.data?.entries ?? [];
	const storyTags = allTags.filter((entry) => entry.scope === "story");
	const globalTags = allTags.filter((entry) => entry.scope === "global");
	const allEntries = writingLoad.data?.entries ?? [];
	const organizerEntries = allEntries.filter(
		(entry) => entry.scope === "image_organizer",
	);

	const startProfile = (profile: CharacterVisualProfile): void => {
		setProfileDraft(profile);
		setNotice(null);
		setError(null);
	};

	const updateSlot = (
		part: VisualSlotPart,
		view: VisualSlotView,
		state: VisualDressState,
		text: string,
	): void => {
		if (profileDraft === null) return;
		setProfileDraft({
			...profileDraft,
			slots: {
				...profileDraft.slots,
				[part]: {
					...profileDraft.slots[part],
					[view]: {
						...profileDraft.slots[part][view],
						[state]: textToTags(text),
					},
				},
			},
		});
	};

	const saveProfile = (): void => {
		if (profileDraft === null) return;
		const next = profiles.map((record) =>
			record.character === profileDraft.character
				? profileDraft
				: record.profile,
		);
		void run(
			() => api.saveVisualProfiles(storyId, next),
			`已保存 ${profileDraft.character} 的视觉档案`,
		).then((ok) => {
			if (ok) setProfileDraft(null);
		});
	};

	const newOutfit = (): void => {
		const character = profiles[0]?.character ?? "";
		const now = nowText();
		setOutfitDraft({
			id: `outfit-${Date.now().toString(36)}`,
			storyId,
			character,
			name: "新服装",
			upperVisible: [],
			upperHidden: [],
			fullVisible: [],
			fullHidden: [],
			isDefault: outfits.every((outfit) => outfit.character !== character),
			locked: false,
			createdAt: now,
			updatedAt: now,
		});
	};

	const saveOutfit = (): void => {
		if (outfitDraft === null) return;
		const updated = {
			...outfitDraft,
			updatedAt: nowText(),
		};
		const next = outfits.some((outfit) => outfit.id === updated.id)
			? outfits.map((outfit) => (outfit.id === updated.id ? updated : outfit))
			: [...outfits, updated];
		const normalized = updated.isDefault
			? next.map((outfit) =>
					outfit.character === updated.character && outfit.id !== updated.id
						? { ...outfit, isDefault: false }
						: outfit,
				)
			: next;
		void run(
			() => api.saveCharacterOutfits(storyId, normalized),
			`已保存服装：${updated.name}`,
		).then((ok) => {
			if (ok) setOutfitDraft(null);
		});
	};

	const deleteOutfit = (outfit: CharacterOutfit): void => {
		void run(
			() =>
				api.saveCharacterOutfits(
					storyId,
					outfits.filter((item) => item.id !== outfit.id),
				),
			`已删除服装：${outfit.name}`,
		).then((ok) => {
			if (ok) setOutfitDraft(null);
		});
	};

	const newTag = (): void => {
		const now = nowText();
		setTagDraft({
			id: `tag-${Date.now().toString(36)}`,
			storyId,
			scope: "story",
			category: "action",
			name: "新标签",
			content: "",
			keywords: [],
			constant: false,
			enabled: true,
			priority: 0,
			createdAt: now,
			updatedAt: now,
		});
	};

	const saveTag = (): void => {
		if (tagDraft === null) return;
		const updated = { ...tagDraft, updatedAt: nowText() };
		const next = storyTags.some((entry) => entry.id === updated.id)
			? storyTags.map((entry) => (entry.id === updated.id ? updated : entry))
			: [...storyTags, updated];
		void run(
			() => api.saveStoryTagLibrary(storyId, next),
			`已保存标签：${updated.name}`,
		).then((ok) => {
			if (ok) setTagDraft(null);
		});
	};

	const toggleTag = (entry: TagLibraryEntry, enabled: boolean): void => {
		void run(
			() =>
				api.saveStoryTagLibrary(
					storyId,
					storyTags.map((item) =>
						item.id === entry.id ? { ...item, enabled } : item,
					),
				),
			enabled ? `已启用 ${entry.name}` : `已停用 ${entry.name}`,
		);
	};

	const deleteTag = (entry: TagLibraryEntry): void => {
		void run(
			() =>
				api.saveStoryTagLibrary(
					storyId,
					storyTags.filter((item) => item.id !== entry.id),
				),
			`已删除标签：${entry.name}`,
		).then((ok) => {
			if (ok) setTagDraft(null);
		});
	};

	const newOrganizerEntry = (): void => {
		setEntryDraft({
			id: `image-entry-${Date.now().toString(36)}`,
			name: "新整理条目",
			content: "",
			role: "system",
			placement: "after-history",
			depth: 0,
			order: allEntries.length,
			enabled: true,
			scope: "image_organizer",
		});
	};

	const saveOrganizerEntry = (): void => {
		if (entryDraft === null) return;
		const next = allEntries.some((entry) => entry.id === entryDraft.id)
			? allEntries.map((entry) =>
					entry.id === entryDraft.id ? entryDraft : entry,
				)
			: [...allEntries, entryDraft];
		void run(
			() => api.call("PUT", sp(storyId, "/writing/entries"), { entries: next }),
			`已保存画面整理条目：${entryDraft.name}`,
		).then((ok) => {
			if (ok) setEntryDraft(null);
		});
	};

	const importFile = async (file: File, kind: "characters" | "preset") => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const data = JSON.parse(await file.text()) as unknown;
			const result = await api.importStoryImage(storyId, { kind, data });
			setNotice(
				kind === "characters"
					? `已导入 ${result.profiles} 个人物、${result.outfits} 套服装`
					: `已导入 ${result.tagEntries} 条标签、${result.writingEntries} 条画面整理条目`,
			);
			reloadAll();
		} catch (value) {
			setError(errorText(value));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="visual-profile-editor">
			<section className="director-section" aria-label="导入兼容文件">
				<header className="director-section-head">
					<h2>导入智绘姬</h2>
				</header>
				<p className="muted">支持角色/服装库与生图预设。</p>
				<div className="settings-grid">
					<Field label="智绘姬角色/服装 JSON">
						<input
							type="file"
							accept="application/json,.json"
							disabled={busy}
							onChange={(event) => {
								const file = event.target.files?.[0];
								event.target.value = "";
								if (file !== undefined) void importFile(file, "characters");
							}}
						/>
					</Field>
					<Field label="智绘姬生图预设 JSON">
						<input
							type="file"
							accept="application/json,.json"
							disabled={busy}
							onChange={(event) => {
								const file = event.target.files?.[0];
								event.target.value = "";
								if (file !== undefined) void importFile(file, "preset");
							}}
						/>
					</Field>
				</div>
				{notice === null ? null : <p className="ledger-tag">{notice}</p>}
				{error === null ? null : (
					<p className="v4err" role="alert">
						{error}
					</p>
				)}
			</section>

			<section className="director-section" aria-label="分格视觉档案">
				<header className="director-section-head">
					<h2>分格视觉档案</h2>
					<span className="ledger-tag">{profiles.length} 人</span>
				</header>
				<div className="plan-toolbar">
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							void run(
								() => api.generateVisualProfiles(storyId),
								"视觉档案已加入后台队列",
							);
						}}
					>
						重新生成视觉档案
					</button>
					<button type="button" disabled={busy} onClick={reloadAll}>
						刷新
					</button>
				</div>
				{profiles.length === 0 ? (
					<p className="muted">还没有视觉档案；可以生成或导入。</p>
				) : (
					<ul className="image-profile-list">
						{profiles.map((record) => (
							<li
								className="image-profile-card"
								key={record.character}
								data-character={record.character}
							>
								<div className="image-workflow-head">
									<strong>{record.character}</strong>
									<span className="ledger-tag">{record.source}</span>
									<Sw
										checked={record.profile.locked}
										label={`锁定 ${record.character}`}
										onChange={(locked) => {
											void run(
												() =>
													api.saveVisualProfiles(
														storyId,
														profiles.map((item) =>
															item.character === record.character
																? { ...item.profile, locked }
																: item.profile,
														),
													),
												locked
													? `已锁定 ${record.character}`
													: `已解锁 ${record.character}`,
											);
										}}
									/>
								</div>
								<p className="ledger-meta">
									基础：{record.profile.base.join("、")} · 默认服装：
									{record.profile.defaultOutfit}
								</p>
								<button
									type="button"
									className="btn sm"
									onClick={() => startProfile(record.profile)}
								>
									编辑分格
								</button>
								{profileDraft?.character === record.character ? (
									<div className="image-profile-editor">
										<div className="settings-grid">
											<Field label="基础外貌">
												<input
													aria-label={`${record.character} 基础外貌`}
													value={tagsToText(profileDraft.base)}
													onChange={(event) =>
														setProfileDraft({
															...profileDraft,
															base: textToTags(event.target.value),
														})
													}
												/>
											</Field>
											<Field label="默认服装">
												<input
													aria-label={`${record.character} 默认服装`}
													value={profileDraft.defaultOutfit}
													onChange={(event) =>
														setProfileDraft({
															...profileDraft,
															defaultOutfit: event.target.value,
														})
													}
												/>
											</Field>
											<Field label="负向标签">
												<input
													aria-label={`${record.character} 负向标签`}
													value={tagsToText(profileDraft.negative)}
													onChange={(event) =>
														setProfileDraft({
															...profileDraft,
															negative: textToTags(event.target.value),
														})
													}
												/>
											</Field>
											<Field label="固定 seed">
												<input
													aria-label={`${record.character} seed`}
													type="number"
													min={0}
													value={profileDraft.seed ?? ""}
													onChange={(event) => {
														const value = event.target.value.trim();
														setProfileDraft({
															...profileDraft,
															seed:
																value.length === 0
																	? null
																	: Math.max(0, Math.trunc(Number(value) || 0)),
														});
													}}
												/>
											</Field>
										</div>
										<div className="visual-slot-grid">
											{VISUAL_SLOT_PARTS.map((part) => (
												<fieldset key={part} className="visual-slot-part">
													<legend>{PART_LABELS[part]}</legend>
													{VISUAL_SLOT_VIEWS.map((view) => (
														<div key={view} className="visual-slot-row">
															<span className="label">{VIEW_LABELS[view]}</span>
															{VISUAL_DRESS_STATES.map((state) => (
																<label key={state} className="plan-field">
																	<span>{STATE_LABELS[state]}</span>
																	<input
																		aria-label={`${record.character} ${PART_LABELS[part]}·${VIEW_LABELS[view]}·${STATE_LABELS[state]}`}
																		value={tagsToText(
																			profileDraft.slots[part][view][state],
																		)}
																		placeholder="标签用顿号隔开"
																		onChange={(event) =>
																			updateSlot(
																				part,
																				view,
																				state,
																				event.target.value,
																			)
																		}
																	/>
																</label>
															))}
														</div>
													))}
												</fieldset>
											))}
										</div>
										<div className="plan-toolbar">
											<button
												type="button"
												disabled={busy}
												onClick={saveProfile}
											>
												保存视觉档案
											</button>
											<button
												type="button"
												onClick={() => setProfileDraft(null)}
											>
												取消
											</button>
										</div>
									</div>
								) : null}
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="director-section" aria-label="独立服装">
				<header className="director-section-head">
					<h2>独立服装</h2>
					<span className="ledger-tag">{outfits.length} 套</span>
				</header>
				<div className="plan-toolbar">
					<button
						type="button"
						disabled={busy || profiles.length === 0}
						onClick={newOutfit}
					>
						新增服装
					</button>
				</div>
				{outfits.length === 0 ? (
					<p className="muted">还没有独立服装；可以新增，或从角色库导入。</p>
				) : (
					<ul className="image-workflow-list">
						{outfits.map((outfit) => (
							<li
								className="image-workflow-card"
								key={outfit.id}
								data-outfit={outfit.name}
							>
								<div className="image-workflow-head">
									<strong>{outfit.character}</strong>
									<span className="ledger-tag">{outfit.name}</span>
									{outfit.isDefault ? (
										<span className="ledger-tag">默认</span>
									) : null}
									{outfit.locked ? (
										<span className="ledger-tag">锁定</span>
									) : null}
								</div>
								<p className="ledger-meta">
									上身可见：{outfit.upperVisible.join("、") || "无"} ·
									上身隐藏：
									{outfit.upperHidden.join("、") || "无"}
								</p>
								<p className="ledger-meta">
									全身可见：{outfit.fullVisible.join("、") || "无"} · 全身隐藏：
									{outfit.fullHidden.join("、") || "无"}
								</p>
								<button
									type="button"
									className="btn sm"
									onClick={() => setOutfitDraft(outfit)}
								>
									编辑服装
								</button>
								{outfitDraft?.id === outfit.id ? (
									<div className="image-profile-editor">
										<div className="settings-grid">
											<Field label="人物">
												<input
													aria-label="服装人物"
													value={outfitDraft.character}
													onChange={(event) =>
														setOutfitDraft({
															...outfitDraft,
															character: event.target.value.trim(),
														})
													}
												/>
											</Field>
											<Field label="服装名称">
												<input
													aria-label="服装名称"
													value={outfitDraft.name}
													onChange={(event) =>
														setOutfitDraft({
															...outfitDraft,
															name: event.target.value,
														})
													}
												/>
											</Field>
											<Field label="上身·可见">
												<input
													aria-label="上身可见"
													value={tagsToText(outfitDraft.upperVisible)}
													onChange={(event) =>
														setOutfitDraft({
															...outfitDraft,
															upperVisible: textToTags(event.target.value),
														})
													}
												/>
											</Field>
											<Field label="上身·隐藏">
												<input
													aria-label="上身隐藏"
													value={tagsToText(outfitDraft.upperHidden)}
													onChange={(event) =>
														setOutfitDraft({
															...outfitDraft,
															upperHidden: textToTags(event.target.value),
														})
													}
												/>
											</Field>
											<Field label="全身·可见">
												<input
													aria-label="全身可见"
													value={tagsToText(outfitDraft.fullVisible)}
													onChange={(event) =>
														setOutfitDraft({
															...outfitDraft,
															fullVisible: textToTags(event.target.value),
														})
													}
												/>
											</Field>
											<Field label="全身·隐藏">
												<input
													aria-label="全身隐藏"
													value={tagsToText(outfitDraft.fullHidden)}
													onChange={(event) =>
														setOutfitDraft({
															...outfitDraft,
															fullHidden: textToTags(event.target.value),
														})
													}
												/>
											</Field>
										</div>
										<div className="plan-toolbar">
											<span className="inline">
												<Sw
													checked={outfitDraft.isDefault}
													label="默认服装"
													onChange={(isDefault) =>
														setOutfitDraft({ ...outfitDraft, isDefault })
													}
												/>
												默认服装
											</span>
											<span className="inline">
												<Sw
													checked={outfitDraft.locked}
													label="锁定服装"
													onChange={(locked) =>
														setOutfitDraft({ ...outfitDraft, locked })
													}
												/>
												锁定服装
											</span>
											<button
												type="button"
												disabled={busy}
												onClick={saveOutfit}
											>
												保存服装
											</button>
											<button
												type="button"
												disabled={busy}
												onClick={() => deleteOutfit(outfit)}
											>
												删除服装
											</button>
											<button
												type="button"
												onClick={() => setOutfitDraft(null)}
											>
												取消
											</button>
										</div>
									</div>
								) : null}
							</li>
						))}
					</ul>
				)}
				{outfitDraft !== null &&
				!outfits.some((outfit) => outfit.id === outfitDraft.id) ? (
					<div className="image-profile-editor">
						<div className="settings-grid">
							<Field label="人物">
								<input
									aria-label="新服装人物"
									value={outfitDraft.character}
									onChange={(event) =>
										setOutfitDraft({
											...outfitDraft,
											character: event.target.value.trim(),
										})
									}
								/>
							</Field>
							<Field label="服装名称">
								<input
									aria-label="新服装名称"
									value={outfitDraft.name}
									onChange={(event) =>
										setOutfitDraft({
											...outfitDraft,
											name: event.target.value,
										})
									}
								/>
							</Field>
							<Field label="上身·可见">
								<input
									aria-label="新服装上身可见"
									value={tagsToText(outfitDraft.upperVisible)}
									onChange={(event) =>
										setOutfitDraft({
											...outfitDraft,
											upperVisible: textToTags(event.target.value),
										})
									}
								/>
							</Field>
							<Field label="上身·隐藏">
								<input
									aria-label="新服装上身隐藏"
									value={tagsToText(outfitDraft.upperHidden)}
									onChange={(event) =>
										setOutfitDraft({
											...outfitDraft,
											upperHidden: textToTags(event.target.value),
										})
									}
								/>
							</Field>
							<Field label="全身·可见">
								<input
									aria-label="新服装全身可见"
									value={tagsToText(outfitDraft.fullVisible)}
									onChange={(event) =>
										setOutfitDraft({
											...outfitDraft,
											fullVisible: textToTags(event.target.value),
										})
									}
								/>
							</Field>
							<Field label="全身·隐藏">
								<input
									aria-label="新服装全身隐藏"
									value={tagsToText(outfitDraft.fullHidden)}
									onChange={(event) =>
										setOutfitDraft({
											...outfitDraft,
											fullHidden: textToTags(event.target.value),
										})
									}
								/>
							</Field>
						</div>
						<div className="plan-toolbar">
							<button type="button" disabled={busy} onClick={saveOutfit}>
								保存服装
							</button>
							<button type="button" onClick={() => setOutfitDraft(null)}>
								取消
							</button>
						</div>
					</div>
				) : null}
			</section>

			<section className="director-section" aria-label="标签库">
				<header className="director-section-head">
					<h2>标签库</h2>
					<span className="ledger-tag">
						{storyTags.length} 条
						{globalTags.length > 0 ? ` · 全局 ${globalTags.length} 条` : ""}
					</span>
				</header>
				<div className="plan-toolbar">
					<button type="button" disabled={busy} onClick={newTag}>
						新增标签
					</button>
				</div>
				{storyTags.length === 0 ? (
					<p className="muted">还没有标签库条目。</p>
				) : (
					<ul className="image-workflow-list">
						{storyTags.map((entry) => (
							<li
								className="image-workflow-card"
								key={entry.id}
								data-tag={entry.name}
							>
								<div className="image-workflow-head">
									<strong>{entry.name}</strong>
									<span className="ledger-tag">
										{TAG_LIBRARY_CATEGORY_LABELS[entry.category]}
									</span>
									{entry.constant ? (
										<span className="ledger-tag">常驻</span>
									) : null}
									<Sw
										checked={entry.enabled}
										label={`启用标签 ${entry.name}`}
										onChange={(enabled) => toggleTag(entry, enabled)}
									/>
								</div>
								<p className="ledger-meta">{entry.content}</p>
								<p className="muted">
									触发词：{entry.keywords.join("、") || "无"} · 优先级：
									{entry.priority}
								</p>
								<button
									type="button"
									className="btn sm"
									onClick={() => setTagDraft(entry)}
								>
									编辑标签
								</button>
								{tagDraft?.id === entry.id ? (
									<div className="image-profile-editor">
										<div className="settings-grid">
											<Field label="分类">
												<select
													aria-label="标签分类"
													value={tagDraft.category}
													onChange={(event) =>
														setTagDraft({
															...tagDraft,
															category: event.target
																.value as TagLibraryEntry["category"],
														})
													}
												>
													{TAG_LIBRARY_CATEGORIES.map((category) => (
														<option key={category} value={category}>
															{TAG_LIBRARY_CATEGORY_LABELS[category]}
														</option>
													))}
												</select>
											</Field>
											<Field label="标题">
												<input
													aria-label="标签标题"
													value={tagDraft.name}
													onChange={(event) =>
														setTagDraft({
															...tagDraft,
															name: event.target.value,
														})
													}
												/>
											</Field>
											<Field label="标签内容">
												<textarea
													aria-label="标签内容"
													rows={3}
													value={tagDraft.content}
													onChange={(event) =>
														setTagDraft({
															...tagDraft,
															content: event.target.value,
														})
													}
												/>
											</Field>
											<Field label="触发词">
												<input
													aria-label="标签触发词"
													value={tagsToText(tagDraft.keywords)}
													onChange={(event) =>
														setTagDraft({
															...tagDraft,
															keywords: textToTags(event.target.value),
														})
													}
												/>
											</Field>
											<Field label="优先级">
												<input
													aria-label="标签优先级"
													type="number"
													value={tagDraft.priority}
													onChange={(event) =>
														setTagDraft({
															...tagDraft,
															priority: Math.trunc(
																Number(event.target.value) || 0,
															),
														})
													}
												/>
											</Field>
										</div>
										<div className="plan-toolbar">
											<span className="inline">
												<Sw
													checked={tagDraft.constant}
													label="常驻标签"
													onChange={(constant) =>
														setTagDraft({ ...tagDraft, constant })
													}
												/>
												常驻
											</span>
											<button type="button" disabled={busy} onClick={saveTag}>
												保存标签
											</button>
											<button
												type="button"
												disabled={busy}
												onClick={() => deleteTag(entry)}
											>
												删除标签
											</button>
											<button type="button" onClick={() => setTagDraft(null)}>
												取消
											</button>
										</div>
									</div>
								) : null}
							</li>
						))}
					</ul>
				)}
				{tagDraft !== null &&
				!storyTags.some((entry) => entry.id === tagDraft.id) ? (
					<div className="image-profile-editor">
						<div className="settings-grid">
							<Field label="分类">
								<select
									aria-label="新标签分类"
									value={tagDraft.category}
									onChange={(event) =>
										setTagDraft({
											...tagDraft,
											category: event.target
												.value as TagLibraryEntry["category"],
										})
									}
								>
									{TAG_LIBRARY_CATEGORIES.map((category) => (
										<option key={category} value={category}>
											{TAG_LIBRARY_CATEGORY_LABELS[category]}
										</option>
									))}
								</select>
							</Field>
							<Field label="标题">
								<input
									aria-label="新标签标题"
									value={tagDraft.name}
									onChange={(event) =>
										setTagDraft({ ...tagDraft, name: event.target.value })
									}
								/>
							</Field>
							<Field label="标签内容">
								<textarea
									aria-label="新标签内容"
									rows={3}
									value={tagDraft.content}
									onChange={(event) =>
										setTagDraft({ ...tagDraft, content: event.target.value })
									}
								/>
							</Field>
							<Field label="触发词">
								<input
									aria-label="新标签触发词"
									value={tagsToText(tagDraft.keywords)}
									onChange={(event) =>
										setTagDraft({
											...tagDraft,
											keywords: textToTags(event.target.value),
										})
									}
								/>
							</Field>
						</div>
						<div className="plan-toolbar">
							<button type="button" disabled={busy} onClick={saveTag}>
								保存标签
							</button>
							<button type="button" onClick={() => setTagDraft(null)}>
								取消
							</button>
						</div>
					</div>
				) : null}
			</section>

			<section className="director-section" aria-label="画面整理条目">
				<header className="director-section-head">
					<h2>画面整理条目</h2>
					<span className="ledger-tag">{organizerEntries.length} 条</span>
				</header>
				<p className="muted">只用于画面整理。</p>
				<div className="plan-toolbar">
					<button type="button" disabled={busy} onClick={newOrganizerEntry}>
						新增整理条目
					</button>
				</div>
				{organizerEntries.length === 0 ? (
					<p className="muted">还没有画面整理条目。</p>
				) : (
					<ul className="image-workflow-list">
						{organizerEntries.map((entry) => (
							<li
								className="image-workflow-card"
								key={entry.id}
								data-organizer={entry.name}
							>
								<div className="image-workflow-head">
									<strong>{entry.name}</strong>
									<Sw
										checked={entry.enabled}
										label={`启用整理条目 ${entry.name}`}
										onChange={(enabled) => {
											const next = allEntries.map((item) =>
												item.id === entry.id ? { ...item, enabled } : item,
											);
											void run(
												() =>
													api.call("PUT", sp(storyId, "/writing/entries"), {
														entries: next,
													}),
												enabled ? "已启用" : "已停用",
											);
										}}
									/>
								</div>
								<p className="ledger-meta">{entry.content}</p>
								<button
									type="button"
									className="btn sm"
									onClick={() => setEntryDraft(entry)}
								>
									编辑整理条目
								</button>
								{entryDraft?.id === entry.id ? (
									<div className="image-profile-editor">
										<Field label="标题">
											<input
												aria-label="整理条目标题"
												value={entryDraft.name}
												onChange={(event) =>
													setEntryDraft({
														...entryDraft,
														name: event.target.value,
													})
												}
											/>
										</Field>
										<Field label="内容">
											<textarea
												aria-label="整理条目内容"
												rows={4}
												value={entryDraft.content}
												onChange={(event) =>
													setEntryDraft({
														...entryDraft,
														content: event.target.value,
													})
												}
											/>
										</Field>
										<div className="plan-toolbar">
											<button
												type="button"
												disabled={busy}
												onClick={saveOrganizerEntry}
											>
												保存整理条目
											</button>
											<button type="button" onClick={() => setEntryDraft(null)}>
												取消
											</button>
										</div>
									</div>
								) : null}
							</li>
						))}
					</ul>
				)}
				{entryDraft !== null &&
				!organizerEntries.some((entry) => entry.id === entryDraft.id) ? (
					<div className="image-profile-editor">
						<Field label="标题">
							<input
								aria-label="新整理条目标题"
								value={entryDraft.name}
								onChange={(event) =>
									setEntryDraft({ ...entryDraft, name: event.target.value })
								}
							/>
						</Field>
						<Field label="内容">
							<textarea
								aria-label="新整理条目内容"
								rows={4}
								value={entryDraft.content}
								onChange={(event) =>
									setEntryDraft({
										...entryDraft,
										content: event.target.value,
									})
								}
							/>
						</Field>
						<div className="plan-toolbar">
							<button
								type="button"
								disabled={busy}
								onClick={saveOrganizerEntry}
							>
								保存整理条目
							</button>
							<button type="button" onClick={() => setEntryDraft(null)}>
								取消
							</button>
						</div>
					</div>
				) : null}
			</section>
		</div>
	);
}
