/** 面板骨架：本任务只建路由，具体内容由后续任务填充。 */
export function PlaceholderPanel({
	title,
	task,
	description,
}: {
	readonly title: string;
	readonly task: string;
	readonly description: string;
}) {
	return (
		<section className="panel">
			<header className="panel-header">
				<h1>{title}</h1>
				<span className="badge">{task}</span>
			</header>
			<p className="muted">{description}</p>
		</section>
	);
}
