import type { LedgerChangeCard } from "@dramaticer/core";
import type {
	ProposalDecisionAction,
	StorySerialView,
} from "@dramaticer/protocol";
import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api";
import { formatFloorTime } from "../../chat/format";
import { formatNodeRef } from "../../chat/ledger-view";
import { replaceProposalCard } from "../../chat/proposal-view";
import {
	EMPTY_SERIAL_VIEW,
	MEMORY_FIELDS,
	SERIAL_TABS,
	type SerialTabId,
	buildCharacterDiffs,
	defaultMemoryDescription,
	formatChapterTitle,
} from "../../chat/serial-view";
import { ErrorNotice } from "../../components/ErrorNotice";
import { ProposalList } from "../../components/ledger/ProposalList";

/** 连载页：四块派生数据与可编辑记忆共用一个 `GET /serial` 响应。 */
export function SerialPage() {
	const { storyId } = useParams();
	const [view, setView] = useState<StorySerialView | null>(null);
	const [tab, setTab] = useState<SerialTabId>("recap");
	const [cards, setCards] = useState<readonly LedgerChangeCard[]>([]);
	const [cueBusyId, setCueBusyId] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<unknown>(null);
	const [cardError, setCardError] = useState<unknown>(null);
	const [exporting, setExporting] = useState(false);
	const [exportError, setExportError] = useState<unknown>(null);
	const [exported, setExported] = useState<string | null>(null);

	useEffect(() => {
		if (storyId === undefined) return;
		let active = true;
		setView(null);
		setTab("recap");
		setCards([]);
		setCueBusyId(null);
		setLoadError(null);
		setCardError(null);
		setExportError(null);
		setExported(null);
		void (async () => {
			try {
				const [serial, proposals] = await Promise.all([
					api.getSerial(storyId),
					api.getProposals(storyId, "all"),
				]);
				if (!active) return;
				setView(serial);
				setCards(proposals.proposals);
			} catch (error) {
				if (active) setLoadError(error);
			}
		})();
		return () => {
			active = false;
		};
	}, [storyId]);

	const reload = async (): Promise<void> => {
		if (storyId === undefined) return;
		const serial = await api.getSerial(storyId);
		setView(serial);
	};

	const decide = (cardId: string, action: ProposalDecisionAction): void => {
		if (storyId === undefined) return;
		setCueBusyId(cardId);
		setCardError(null);
		api
			.decideProposal(cardId, action)
			.then(async (result) => {
				setCards((previous) => replaceProposalCard(previous, result.card));
				await reload();
			})
			.catch((error: unknown) => setCardError(error))
			.finally(() => setCueBusyId(null));
	};

	const addCard = (card: LedgerChangeCard): void => {
		setCards((previous) => replaceProposalCard(previous, card));
	};

	const exportBook = (): void => {
		if (storyId === undefined) return;
		setExporting(true);
		setExportError(null);
		setExported(null);
		api
			.exportBook(storyId)
			.then((book) => {
				const blob = new Blob([book.markdown], {
					type: "text/markdown;charset=utf-8",
				});
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = book.fileName;
				link.rel = "noopener";
				document.body.appendChild(link);
				link.click();
				link.remove();
				window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
				setExported(`${book.fileName} 已下载`);
			})
			.catch((error: unknown) => setExportError(error))
			.finally(() => setExporting(false));
	};

	if (storyId === undefined) {
		return (
			<section className="panel">
				<p>地址里缺少故事 id。</p>
			</section>
		);
	}

	const serial = view ?? EMPTY_SERIAL_VIEW;
	const sceneByOrdinal = new Map(
		serial.scenes.map((scene) => [scene.ordinal, scene]),
	);

	return (
		<section className="serial-panel">
			<header className="serial-header">
				<div>
					<h1>连载</h1>
					<p className="muted">
						前情提要、章节目录、人物关系与时间线读同一份派生数据。
					</p>
				</div>
				<button
					type="button"
					className="serial-export"
					onClick={exportBook}
					disabled={exporting}
				>
					{exporting ? "正在导出…" : "导出成书"}
				</button>
			</header>
			<ErrorNotice error={loadError} />
			<ErrorNotice error={exportError} />
			{exported === null ? null : <p className="muted">{exported}</p>}
			{view === null ? null : (
				<nav className="serial-tabs" aria-label="连载视图">
					{SERIAL_TABS.map((entry) => (
						<button
							key={entry.id}
							type="button"
							className={entry.id === tab ? "serial-tab active" : "serial-tab"}
							aria-pressed={entry.id === tab}
							onClick={() => setTab(entry.id)}
						>
							{entry.label}
						</button>
					))}
				</nav>
			)}
			{view === null ? null : (
				<div className="serial-body">
					{tab === "recap" ? <RecapPanel view={view} /> : null}
					{tab === "chapters" ? (
						<ChaptersPanel view={view} sceneByOrdinal={sceneByOrdinal} />
					) : null}
					{tab === "cast" ? <CastPanel view={view} /> : null}
					{tab === "timeline" ? <TimelinePanel view={view} /> : null}
					{tab === "memory" ? (
						<>
							<ErrorNotice error={cardError} />
							<section className="serial-section serial-memory">
								<h2>可编辑记忆</h2>
								<p className="muted">
									改动先写成待审变更卡；批准之前台账不变，批准后事实来源记为玩家。
								</p>
								{view.cast.length === 0 ? (
									<p className="muted">还没有人物档案。</p>
								) : (
									view.cast.map((character) => (
										<CharacterMemoryForm
											key={`${character.who}:${character.status ?? ""}:${character.location ?? ""}`}
											storyId={storyId}
											character={character}
											onCreated={addCard}
										/>
									))
								)}
							</section>
							<ProposalList
								cards={cards}
								busyId={cueBusyId}
								onDecide={decide}
							/>
						</>
					) : null}
				</div>
			)}
		</section>
	);
}

function RecapPanel({ view }: { readonly view: StorySerialView }) {
	const { recap } = view;
	return (
		<section className="serial-section serial-recap">
			<details open={recap.stale}>
				<summary>
					前情提要（{recap.scenes.length} 场）
					{recap.stale ? " · 隔了一段时间，默认展开" : ""}
				</summary>
				<p className="muted">
					{recap.lastPlayedAt === null
						? "这个分支还没有楼层。"
						: `上次游玩：${formatFloorTime(recap.lastPlayedAt)}；超过 ${recap.staleHours} 小时算隔了一段时间。`}
				</p>
				{recap.scenes.length === 0 ? (
					<p className="muted">还没有归档的场次。</p>
				) : (
					<ul className="serial-recap-list">
						{recap.scenes.map((scene) => (
							<li key={scene.endNodeId} className="serial-recap-scene">
								<div className="serial-meta">
									{scene.place ?? "地点未记"} · {scene.storyTime ?? "时间未记"}{" "}
									· {scene.present.join("、") || "在场未记"}
								</div>
								<p>{scene.summary}</p>
							</li>
						))}
					</ul>
				)}
			</details>
		</section>
	);
}

function ChaptersPanel({
	view,
	sceneByOrdinal,
}: {
	readonly view: StorySerialView;
	readonly sceneByOrdinal: ReadonlyMap<
		number,
		StorySerialView["scenes"][number]
	>;
}) {
	return (
		<section className="serial-section serial-chapters">
			<h2>章节目录</h2>
			{view.chapters.length === 0 ? (
				<p className="muted">还没有章节目录。</p>
			) : (
				view.chapters.map((chapter) => (
					<article key={chapter.startNodeId} className="serial-chapter">
						<header className="serial-chapter-head">
							<h3>{formatChapterTitle(chapter)}</h3>
							<span className="ledger-tag">{chapter.floorCount} 楼</span>
							<span className="ledger-tag">
								{chapter.sceneOrdinals.length} 场
							</span>
						</header>
						{chapter.focusLineIds.length === 0 ? null : (
							<p className="serial-meta">
								下一章聚焦：{chapter.focusLineIds.join("、")}
							</p>
						)}
						<ul className="serial-chapter-scenes">
							{chapter.sceneOrdinals.map((ordinal) => {
								const scene = sceneByOrdinal.get(ordinal);
								if (scene === undefined) return null;
								return (
									<li key={scene.startNodeId} className="serial-scene">
										<div className="serial-meta">
											第 {scene.ordinal} 场 · {formatNodeRef(scene.startNodeId)}
											{scene.endNodeId === null
												? " · 进行中"
												: `–${formatNodeRef(scene.endNodeId)}`}{" "}
											· {scene.floorCount} 楼
										</div>
										{scene.summary === null ? (
											<p className="muted">这一场还没有归档摘要。</p>
										) : (
											<p>{scene.summary}</p>
										)}
										{scene.place === null && scene.storyTime === null ? null : (
											<p className="serial-meta">
												{scene.place ?? "地点未记"} ·{" "}
												{scene.storyTime ?? "时间未记"}
											</p>
										)}
									</li>
								);
							})}
						</ul>
					</article>
				))
			)}
		</section>
	);
}

function CastPanel({ view }: { readonly view: StorySerialView }) {
	return (
		<section className="serial-section serial-cast">
			<h2>人物关系</h2>
			{view.cast.length === 0 ? (
				<p className="muted">还没有人物档案。</p>
			) : (
				view.cast.map((character) => (
					<article key={character.who} className="serial-character">
						<header className="serial-character-head">
							<h3>{character.who}</h3>
							<span className="ledger-tag">
								{character.present ? "在场" : "不在场"}
							</span>
							{character.tier === null ? null : (
								<span className="ledger-tag">
									{character.tier === "lead" ? "主演" : "龙套"}
								</span>
							)}
						</header>
						<p className="serial-meta">
							状态：{character.status ?? "未记"} · 位置：
							{character.location ?? "未记"}
						</p>
						{character.lastScene === null ? null : (
							<p className="serial-meta">
								上次出场：{formatNodeRef(character.lastScene.startNodeId)}–
								{formatNodeRef(character.lastScene.endNodeId)}
							</p>
						)}
						{character.notes.length === 0 ? null : (
							<ul className="serial-note-list">
								{character.notes.map((note) => (
									<li
										key={`${note.field}:${note.sceneEndNodeId}`}
										className="serial-note"
									>
										<span className="ledger-tag">{note.label}</span> {note.text}
										<span className="serial-meta">
											{" "}
											出处 {formatNodeRef(note.sceneStartNodeId)}–
											{formatNodeRef(note.sceneEndNodeId)}
										</span>
									</li>
								))}
							</ul>
						)}
						{character.relations.length === 0 ? null : (
							<ul className="serial-relation-list">
								{character.relations.map((relation) => (
									<li
										key={`${relation.from}:${relation.to}:${relation.type ?? ""}`}
										className="serial-relation"
									>
										{relation.from} → {relation.to} ·{" "}
										{relation.type ?? "关系未记"} ·{" "}
										{relation.stage ?? "阶段未记"}
									</li>
								))}
							</ul>
						)}
						{character.uninformedScenes.length === 0 ? null : (
							<div className="serial-uninformed">
								<p className="serial-meta">不知情的场次</p>
								<ul className="serial-note-list">
									{character.uninformedScenes.map((scene) => (
										<li key={scene.endNodeId} className="serial-note">
											{scene.summary}
											<span className="serial-meta">
												{" "}
												（{formatNodeRef(scene.startNodeId)}–
												{formatNodeRef(scene.endNodeId)}）
											</span>
										</li>
									))}
								</ul>
							</div>
						)}
					</article>
				))
			)}
		</section>
	);
}

function TimelinePanel({ view }: { readonly view: StorySerialView }) {
	return (
		<section className="serial-section serial-timeline">
			<h2>时间线</h2>
			{view.timeline.length === 0 ? (
				<p className="muted">还没有可以排出的时间线。</p>
			) : (
				<ol className="serial-timeline-list">
					{view.timeline.map((entry) => (
						<li
							key={`${entry.kind}:${entry.nodeId}`}
							className="serial-timeline-entry"
						>
							<div className="serial-meta">
								<span className="ledger-tag">
									{entry.kind === "scene" ? "场景" : "跳时间"}
								</span>{" "}
								第 {entry.ordinal} 楼 · {entry.storyTime ?? "时间未记"} ·{" "}
								{entry.place ?? "地点未记"}
							</div>
							{entry.summary === null ? null : <p>{entry.summary}</p>}
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

function CharacterMemoryForm({
	storyId,
	character,
	onCreated,
}: {
	readonly storyId: string;
	readonly character: StorySerialView["cast"][number];
	readonly onCreated: (card: LedgerChangeCard) => void;
}) {
	const [draft, setDraft] = useState<Record<string, string>>(() => {
		const initial: Record<string, string> = {};
		for (const { field } of MEMORY_FIELDS) {
			initial[field] = character[field] ?? "";
		}
		return initial;
	});
	const [description, setDescription] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const [saved, setSaved] = useState(false);

	const submit = (event: FormEvent): void => {
		event.preventDefault();
		const diffs = buildCharacterDiffs(character, {
			status: draft.status ?? "",
			location: draft.location ?? "",
		});
		if (diffs.length === 0) {
			setError(new Error("没有改动，先改一个字段再提交。"));
			setSaved(false);
			return;
		}
		const text =
			description.trim().length > 0
				? description.trim()
				: defaultMemoryDescription(character, diffs);
		setBusy(true);
		setError(null);
		setSaved(false);
		api
			.createProposal(storyId, { text, diffs })
			.then((result) => {
				onCreated(result.card);
				setDescription("");
				setSaved(true);
			})
			.catch((value: unknown) => setError(value))
			.finally(() => setBusy(false));
	};

	return (
		<form className="serial-memory-form" onSubmit={submit}>
			<h3>{character.who}</h3>
			<div className="serial-memory-fields">
				{MEMORY_FIELDS.map(({ field, label }) => (
					<label key={field} className="serial-memory-field">
						{label}
						<input
							value={draft[field] ?? ""}
							onChange={(event) =>
								setDraft((previous) => ({
									...previous,
									[field]: event.target.value,
								}))
							}
						/>
					</label>
				))}
				<label className="serial-memory-field serial-memory-description">
					修改说明
					<input
						value={description}
						placeholder="比如：她还不知道信的内容"
						onChange={(event) => setDescription(event.target.value)}
					/>
				</label>
			</div>
			{error === null ? null : <ErrorNotice error={error} />}
			{saved ? <p className="muted">已生成待审变更卡。</p> : null}
			<div className="serial-memory-actions">
				<button type="submit" disabled={busy}>
					{busy ? "提交中…" : "提交修改"}
				</button>
			</div>
		</form>
	);
}
