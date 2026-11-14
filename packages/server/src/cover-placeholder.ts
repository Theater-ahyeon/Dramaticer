const MAX_LINE_CHARS = 8;
const MAX_LINES = 3;
const LINE_HEIGHT = 72;

/**
 * 没有卡面图的故事用标题生成 2:3 占位图。颜色与月亮位置由标题决定，
 * 同一标题每次渲染结果相同，可以缓存。返回的是 SVG 文本。
 */
export function renderCoverPlaceholder(title: string): string {
	const clean = title.trim().length === 0 ? "未命名故事" : title.trim();
	const seed = hashTitle(clean);
	const hue = seed % 360;
	const moonX = 130 + ((seed >>> 9) % 340);
	const lines = wrapTitle(clean);
	const firstBaseline = 800 - (lines.length - 1) * LINE_HEIGHT;
	const text = lines
		.map(
			(line, index) =>
				`<text x="300" y="${firstBaseline + index * LINE_HEIGHT}" text-anchor="middle" fill="#f6efe2" font-family="'Songti SC', 'Noto Serif SC', serif" font-size="56" letter-spacing="2">${escapeXml(line)}</text>`,
		)
		.join("");
	return [
		'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900" role="img">',
		`<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">`,
		`<stop offset="0" stop-color="hsl(${hue} 45% 13%)"/>`,
		`<stop offset="0.6" stop-color="hsl(${hue + 20} 40% 33%)"/>`,
		`<stop offset="1" stop-color="hsl(${hue + 50} 45% 52%)"/>`,
		"</linearGradient></defs>",
		'<rect width="600" height="900" fill="url(#sky)"/>',
		`<circle cx="${moonX}" cy="200" r="112" fill="hsl(${hue + 60} 70% 80% / 0.12)"/>`,
		`<circle cx="${moonX}" cy="200" r="58" fill="hsl(${hue + 60} 65% 88% / 0.85)"/>`,
		`<path d="M0 620 L120 520 L250 600 L380 480 L520 590 L600 540 L600 900 L0 900 Z" fill="hsl(${hue + 5} 35% 26% / 0.9)"/>`,
		`<path d="M0 700 L160 620 L320 700 L470 610 L600 680 L600 900 L0 900 Z" fill="hsl(${hue + 15} 30% 18% / 0.95)"/>`,
		`<path d="M0 790 L180 730 L360 790 L540 720 L600 760 L600 900 L0 900 Z" fill="hsl(${hue + 25} 25% 12% / 0.97)"/>`,
		text,
		"</svg>",
	].join("");
}

function wrapTitle(title: string): readonly string[] {
	const chars = Array.from(title);
	if (chars.length <= MAX_LINE_CHARS * MAX_LINES) {
		const lines: string[] = [];
		for (let index = 0; index < chars.length; index += MAX_LINE_CHARS) {
			lines.push(chars.slice(index, index + MAX_LINE_CHARS).join(""));
		}
		return lines;
	}
	return [
		chars.slice(0, MAX_LINE_CHARS).join(""),
		chars.slice(MAX_LINE_CHARS, MAX_LINE_CHARS * 2).join(""),
		`${chars.slice(MAX_LINE_CHARS * 2, MAX_LINE_CHARS * 3 - 1).join("")}…`,
	];
}

function hashTitle(title: string): number {
	let hash = 0x811c9dc5;
	for (const char of title) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash >>> 0;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}
