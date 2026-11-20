import type { RerollRateReport } from "@dramaticer/core";
import { api } from "../api";
import { sp, useLoad } from "./ui";

// 北极星指标（DESIGN §14.1，refactor/04）：每百楼带原因重写率。和命令行
// `dramaticer stats rerolls` 读同一份数据，只显示数字。

function per(count: number, floors: number): string {
	return floors === 0 ? "—" : ((count / floors) * 100).toFixed(1);
}

export function RerollStats({ storyId }: { readonly storyId: string }) {
	const report = useLoad<RerollRateReport>(
		() => api.get(sp(storyId, "/stats/rerolls")),
		[storyId],
	);
	const data = report.data;
	if (data === null) return null;
	const { directorOn, directorOff } = data.interference;
	return (
		<div className="grp" id="rerolls">
			<h2>重写率</h2>
			<p className="rr-lead">
				每百楼重写 <b className="num">{data.total.perHundred}</b> 次（
				{data.total.floors} 楼里重写 {data.total.rerolls}{" "}
				次）。越低说明越少需要你返工。
			</p>
			<div className="tblwrap rr-wrap">
				<table className="tbl rr">
					<thead>
						<tr>
							<th>原因</th>
							<th>1–10 楼</th>
							<th>之后</th>
						</tr>
					</thead>
					<tbody>
						{data.reasons.map((row) => (
							<tr key={row.reason}>
								<td>{row.label}</td>
								<td className="num">
									{row.early}
									<small>（{per(row.early, data.early.floors)}）</small>
								</td>
								<td className="num">
									{row.late}
									<small>（{per(row.late, data.late.floors)}）</small>
								</td>
							</tr>
						))}
					</tbody>
					<tfoot>
						<tr>
							<td>每百楼</td>
							<td className="num">{data.early.perHundred}</td>
							<td className="num">{data.late.perHundred}</td>
						</tr>
					</tfoot>
				</table>
			</div>
			<div className="rr-groups">
				{(
					[
						["导演参与的楼层", directorOn],
						["导演没参与的楼层", directorOff],
					] as const
				).map(([label, group]) => (
					<div key={label}>
						<span className="label">{label}</span>
						<b className="num">{(group.ratio * 100).toFixed(1)}%</b>
						<small>
							{group.floors} 楼 · 没听我的 {group.ignoredInstruction} ·
							别推这条线 {group.avoidLine}
						</small>
					</div>
				))}
			</div>
		</div>
	);
}
