import type {
	ImportAuditEntrySummary,
	ImportAuditReviewEntry,
	ImportEntryKind,
	ImportEntryKindSource,
} from "@dramaticer/core";
import type {
	ImportAuditPlayerSource,
	ImportAuditReportView,
	StoryView,
} from "@dramaticer/protocol";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api";
import { ErrorNotice } from "../../components/ErrorNotice";

const KIND_LABELS: Record<ImportEntryKind, string> = {
	common: "常识",
	entity: "实体档案",
	rule: "规则",
	state: "状态定义",
	conditional: "条件内容",
	event: "事件与舞台",
	writing: "写作指令",
	presentation: "表现资源",
	options: "作者选项",
	"plugin-residue": "插件残留",
	unknown: "未识别",
};

const SOURCE_LABELS: Record<ImportEntryKindSource, string> = {
	rule: "规则判定",
	model: "模型建议",
	player: "玩家指定",
};

const numberFormat = new Intl.NumberFormat("zh-CN");

function formatCount(value: number): string {
	return numberFormat.format(value);
}

interface KindTarget {
	readonly source: string;
	readonly title: string;
	readonly kind: ImportEntryKind;
	readonly kindSource: ImportEntryKindSource;
	readonly rulePrimary: ImportEntryKind;
}

type ChangeKind = (
	source: string,
	kind: ImportEntryKind,
	kindSource?: ImportAuditPlayerSource,
) => Promise<void>;

interface ReviewGroup {
	readonly id: string;
	readonly title: string;
	readonly hint: string;
	readonly entries: readonly ImportAuditReviewEntry[];
}

export function ImportAuditPage() {
	const { storyId } = useParams();
	const [story, setStory] = useState<StoryView | null>(null);
	const [report, setReport] = useState<ImportAuditReportView | null>(null);
	const [loading, setLoading] = useState(false);
	const [busySource, setBusySource] = useState<string | null>(null);
	const [error, setError] = useState<unknown>(null);

	useEffect(() => {
		if (storyId === undefined) return;
		let active = true;
		setStory(null);
		setReport(null);
		setError(null);
		setBusySource(null);
		setLoading(true);
		void (async () => {
			try {
				const [loadedStory, loadedReport] = await Promise.all([
					api.getStory(storyId),
					api.getImportAudit(storyId),
				]);
				if (!active) return;
				setStory(loadedStory);
				setReport(loadedReport);
			} catch (value) {
				if (active) setError(value);
			} finally {
				if (active) setLoading(false);
			}
		})();
		return () => {
			active = false;
		};
	}, [storyId]);

	if (storyId === undefined) {
		return (
			<section className="panel">
				<p>地址里缺少故事 id。</p>
			</section>
		);
	}

	const changeKind: ChangeKind = async (source, kind, kindSource) => {
		setBusySource(source);
		setError(null);
		try {
			const result = await api.updateImportAuditEntry(
				storyId,
				source,
				kindSource === undefined ? { kind } : { kind, kindSource },
			);
			setReport(result.report);
		} catch (value) {
			setError(value);
		} finally {
			setBusySource(null);
		}
	};

	const groups: readonly ReviewGroup[] =
		report === null
			? []
			: [
					{
						id: "unknown",
						title: "未识别条目",
						hint: "没有认出来的条目暂按原样处理；展开一条可以看正文并改类型。",
						entries: report.unknown,
					},
					{
						id: "author-options",
						title: "作者选项",
						hint: "卡作者留下的可选、扩展与难度条目。",
						entries: report.authorOptions,
					},
					{
						id: "plugin-residue",
						title: "插件残留",
						hint: "其他插件写进世界书的总结与表格。",
						entries: report.pluginResidue,
					},
				];

	return (
		<section className="panel import-audit">
			<header className="import-head">
				<img
					className="story-cover story-cover-large"
					src={api.storyCoverUrl(storyId)}
					alt={`${story?.title ?? "故事"} 的封面`}
					width={240}
					height={360}
				/>
				<div>
					<h1>{story?.title ?? "故事"} · 导入体检</h1>
					<p className="muted">
						{report === null
							? "条目按运行时的用法分流，原文一字不改。"
							: `这张卡的世界书有 ${formatCount(report.total)} 条。条目按运行时的用法分流，原文一字不改；调整类型后数字立即重算。`}
					</p>
				</div>
			</header>
			<ErrorNotice error={error} />
			{loading ? <p className="muted">读取中……</p> : null}
			{report === null ? null : report.total === 0 ? (
				<p className="muted">
					这个故事还没有导入过世界书条目。先在「导入」页导入一张带世界书的卡。
				</p>
			) : (
				<>
					<div className="import-audit-summary">
						<section>
							<h2>类型分布</h2>
							<ul className="import-audit-counts">
								{report.counts.map((item) => (
									<li key={item.kind} data-kind={item.kind}>
										<span>{KIND_LABELS[item.kind]}</span>
										<span className="import-audit-count-value">
											{formatCount(item.count)}
										</span>
									</li>
								))}
							</ul>
						</section>
						<section>
							<h2>每轮常驻注入</h2>
							<p className="import-audit-tokens">
								<span className="import-audit-token-before">
									{formatCount(report.tokens.before)}
								</span>
								<span className="import-audit-arrow">→</span>
								<span className="import-audit-token-after">
									{formatCount(report.tokens.after)}
								</span>
								<span className="muted">token</span>
							</p>
							<p className="muted">
								常驻条目 {formatCount(report.tokens.beforeEntries)} 条 → 分型后{" "}
								{formatCount(report.tokens.afterEntries)} 条
							</p>
						</section>
					</div>
					{groups.map((group) => (
						<ReviewSection
							key={group.id}
							group={group}
							kinds={report.counts.map((item) => item.kind)}
							busySource={busySource}
							onChange={changeKind}
						/>
					))}
					<AllEntriesSection
						entries={report.entries}
						kinds={report.counts.map((item) => item.kind)}
						busySource={busySource}
						onChange={changeKind}
					/>
				</>
			)}
		</section>
	);
}

function ReviewSection({
	group,
	kinds,
	busySource,
	onChange,
}: {
	readonly group: ReviewGroup;
	readonly kinds: readonly ImportEntryKind[];
	readonly busySource: string | null;
	readonly onChange: ChangeKind;
}) {
	if (group.entries.length === 0 && group.id !== "unknown") return null;
	return (
		<section className="import-audit-section" data-group={group.id}>
			<h2>
				{group.title}
				<span className="badge">{formatCount(group.entries.length)}</span>
			</h2>
			<p className="muted">{group.hint}</p>
			{group.entries.length === 0 ? (
				<p className="muted">没有未识别条目。</p>
			) : (
				<ul className="import-audit-entries">
					{group.entries.map((entry) => (
						<li key={entry.source} className="import-audit-entry">
							<div className="import-audit-entry-head">
								<span className="import-audit-entry-title">
									{displayTitle(entry)}
								</span>
								<span className="badge">{KIND_LABELS[entry.kind]}</span>
								<span className="muted">{SOURCE_LABELS[entry.kindSource]}</span>
								<KindControl
									entry={entry}
									label={`${displayTitle(entry)} 的类型`}
									kinds={kinds}
									busy={busySource === entry.source}
									onChange={onChange}
								/>
							</div>
							{entry.kind === entry.rulePrimary ? null : (
								<p className="muted">
									规则判定的类型是 {KIND_LABELS[entry.rulePrimary]}。
								</p>
							)}
							<details className="import-audit-content">
								<summary>展开正文</summary>
								<pre>{entry.content}</pre>
							</details>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function AllEntriesSection({
	entries,
	kinds,
	busySource,
	onChange,
}: {
	readonly entries: readonly ImportAuditEntrySummary[];
	readonly kinds: readonly ImportEntryKind[];
	readonly busySource: string | null;
	readonly onChange: ChangeKind;
}) {
	return (
		<details className="import-audit-all">
			<summary>全部条目（{formatCount(entries.length)}）</summary>
			<ul className="import-audit-entries">
				{entries.map((entry) => (
					<li key={entry.source} className="import-audit-all-row">
						<span className="import-audit-entry-title">
							{displayTitle(entry)}
						</span>
						<span className="badge">{KIND_LABELS[entry.kind]}</span>
						<span className="muted">{SOURCE_LABELS[entry.kindSource]}</span>
						<span className="muted">{formatCount(entry.contentChars)} 字</span>
						<KindControl
							entry={entry}
							label={`全部条目：${displayTitle(entry)} 的类型`}
							kinds={kinds}
							busy={busySource === entry.source}
							onChange={onChange}
						/>
					</li>
				))}
			</ul>
		</details>
	);
}

function KindControl({
	entry,
	label,
	kinds,
	busy,
	onChange,
}: {
	readonly entry: KindTarget;
	readonly label: string;
	readonly kinds: readonly ImportEntryKind[];
	readonly busy: boolean;
	readonly onChange: ChangeKind;
}) {
	return (
		<>
			<label className="import-audit-kind">
				<span>类型</span>
				<select
					aria-label={label}
					value={entry.kind}
					disabled={busy}
					onChange={(event) => {
						void onChange(entry.source, event.target.value as ImportEntryKind);
					}}
				>
					{kinds.map((kind) => (
						<option key={kind} value={kind}>
							{KIND_LABELS[kind]}
						</option>
					))}
				</select>
			</label>
			{entry.kindSource === "rule" ? null : (
				<button
					type="button"
					disabled={busy}
					onClick={() => {
						void onChange(entry.source, entry.rulePrimary, "rule");
					}}
				>
					恢复规则判定（{KIND_LABELS[entry.rulePrimary]}）
				</button>
			)}
		</>
	);
}

function displayTitle(entry: { readonly title: string }): string {
	return entry.title.trim().length === 0 ? "（无标题）" : entry.title;
}
