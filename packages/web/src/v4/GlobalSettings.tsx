import type { ChannelsView } from "@dramaticer/protocol";
import { useEffect, useState } from "react";
import { api } from "../api";
import { ChannelWizard } from "./ChannelWizard";
import { ChannelsAdvanced } from "./ChannelsAdvanced";
import { ImageSettings } from "./ImageSettings";
import { type Theme, onThemeChange, setTheme, storedTheme } from "./stage";
import { Seg, errorText } from "./ui";

const ROLE_LABELS: Readonly<Record<string, string>> = {
	writer: "正文",
	settler: "记忆整理",
	planner: "规划",
	judge: "评测",
};

/** 全局设置：模型与渠道、生图、外观。不属于任何一个故事。 */
export function GlobalSettings() {
	const [view, setView] = useState<ChannelsView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [theme, setThemeState] = useState<Theme>(storedTheme);
	const [advanced, setAdvanced] = useState(0);

	useEffect(() => onThemeChange(setThemeState), []);
	useEffect(() => {
		api
			.getChannels()
			.then(setView)
			.catch((value: unknown) => setError(errorText(value)));
	}, []);

	const configured = view !== null && view.roles.writer !== null;

	return (
		<section data-view="settings" className="global-settings">
			<div className="vh">
				<div>
					<h1>设置</h1>
				</div>
			</div>

			<div className="card-block">
				<h2>模型与渠道</h2>
				{error !== null ? <div className="v4err">{error}</div> : null}
				{view === null && error === null ? (
					<p className="muted">读取中…</p>
				) : null}
				{view !== null ? (
					<>
						{configured ? (
							<ul className="role-summary" aria-label="当前使用的模型">
								{Object.entries(view.roles).map(([role, alias]) => {
									const model = view.models.find(
										(item) => item.alias === alias,
									);
									return (
										<li key={role}>
											<span>{ROLE_LABELS[role] ?? role}</span>
											<b>{model?.id ?? alias ?? "未设置"}</b>
										</li>
									);
								})}
							</ul>
						) : (
							<p className="muted">还没有连接模型。填好下面几项就能开始。</p>
						)}
						{view.warnings.length > 0 ? (
							<ul className="channel-warnings" aria-label="配置提醒">
								{view.warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						) : null}
						<h3 className="wizard-title">
							{configured ? "添加或更换模型" : "连接模型"}
						</h3>
						<ChannelWizard
							view={view}
							onSaved={(next) => {
								setView(next);
								setAdvanced((value) => value + 1);
							}}
						/>
						<details className="advanced">
							<summary>高级配置（多渠道、保底、岗位、嵌入模型）</summary>
							<ChannelsAdvanced key={advanced} />
						</details>
					</>
				) : null}
			</div>

			<div className="card-block">
				<h2>生图</h2>
				<ImageSettings storyId={null} />
			</div>

			<div className="card-block">
				<h2>外观</h2>
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
		</section>
	);
}
