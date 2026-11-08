import { useMemo } from "react";
import {
	type OpeningCandidateItem,
	isFreshOpeningCandidate,
	orderOpeningCandidates,
} from "../../chat/opening-candidates";

export interface OpeningCandidatesProps {
	readonly candidates: readonly OpeningCandidateItem[];
	/** 手动重新生成之前的最大编号；0 表示第一页，不标“新一批”。 */
	readonly baselineOrdinal: number;
	readonly busy: boolean;
	readonly timedOut: boolean;
	readonly onPick: (candidateId: string) => void;
	readonly onGenerate: () => void;
}

/** 故事还没有楼层时显示开场候选；选中一条才成为根楼层。 */
export function OpeningCandidates({
	candidates,
	baselineOrdinal,
	busy,
	timedOut,
	onPick,
	onGenerate,
}: OpeningCandidatesProps) {
	const ordered = useMemo(
		() => orderOpeningCandidates(candidates),
		[candidates],
	);
	return (
		<section className="opening-candidates" aria-label="开场候选">
			<header className="opening-head">
				<h3>开场候选</h3>
				<span className="muted">选中一条作为故事开头，其余待选候选会丢弃</span>
			</header>
			{ordered.length === 0 ? (
				<p className="muted">还没有开场候选，可以现在生成一批。</p>
			) : (
				<ul className="opening-list">
					{ordered.map((candidate) => (
						<li key={candidate.id} className="opening-candidate">
							<header className="opening-candidate-head">
								<span className="muted">#{candidate.ordinal}</span>
								{isFreshOpeningCandidate(candidate, baselineOrdinal) ? (
									<span className="opening-new">新一批</span>
								) : null}
								<button
									type="button"
									disabled={busy}
									onClick={() => onPick(candidate.id)}
								>
									用这一条
								</button>
							</header>
							<p className="opening-raw">{candidate.raw}</p>
						</li>
					))}
				</ul>
			)}
			<div className="opening-actions">
				<button type="button" onClick={onGenerate} disabled={busy}>
					{ordered.length === 0 ? "生成开场候选" : "重新生成候选"}
				</button>
				{busy ? <span className="muted">正在生成新一批…</span> : null}
				{timedOut ? (
					<span className="muted">
						还没有新候选；稍后再刷新页面，或者再点一次生成。
					</span>
				) : null}
			</div>
		</section>
	);
}
