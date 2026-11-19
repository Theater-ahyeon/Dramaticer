import {
	AdditiveBlending,
	BackSide,
	BufferAttribute,
	BufferGeometry,
	CanvasTexture,
	Color,
	ColorManagement,
	ConeGeometry,
	CylinderGeometry,
	DoubleSide,
	Group,
	Mesh,
	MeshBasicMaterial,
	NormalBlending,
	PerspectiveCamera,
	Plane,
	PlaneGeometry,
	Points,
	Raycaster,
	Scene,
	ShaderMaterial,
	SphereGeometry,
	Sprite,
	SpriteMaterial,
	Vector2,
	Vector3,
	WebGLRenderer,
} from "three";
import { type RouteName, reducedMotion, stage } from "./stage";

/** 灯塔的位置；海面、光束与镜头都围着它摆。 */
const LIGHT = new Vector3(14, 0, -46);
const LAMP_Y = 5.4;

interface Pose {
	readonly pos: readonly [number, number, number];
	readonly look: readonly [number, number, number];
	/** 夜色下场景的整体亮度；读正文的页面压暗一些。 */
	readonly dim: number;
}

/** 每个页面一个机位，换页时镜头滑过去。 */
const POSES: Record<RouteName, Pose> = {
	library: { pos: [0, 4.2, 16], look: [5, 6.5, -40], dim: 0.88 },
	play: { pos: [-11, 2.6, 11], look: [12, 5, -46], dim: 0.62 },
	memory: { pos: [3, 9, 6], look: [5, 0.5, -30], dim: 0.85 },
	outline: { pos: [2, 30, -6], look: [9, 0, -40], dim: 0.85 },
	lore: { pos: [27, 3.6, -14], look: [9, 5.5, -46], dim: 0.8 },
	prefs: { pos: [7, 7.2, -27], look: [14, 5.2, -46], dim: 0.78 },
	classic: { pos: [-15, 5.5, 14], look: [9, 5, -40], dim: 0.6 },
	login: { pos: [-3, 3.4, 20], look: [9, 8, -46], dim: 1 },
};

/** 天空与水面共用：噪声、波浪、整片天空的颜色。水面的倒影调的是同一个 skyColor。 */
const COMMON = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uDim;
uniform vec3 uOrb;
const float PI = 3.14159265;
const float TAU = 6.2831853;

float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float hash31(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.yzx + 33.33);
	return fract((p.x + p.y) * p.z);
}
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
		mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
		f.y
	);
}
float fbm(vec2 p) {
	float a = 0.5;
	float s = 0.0;
	for (int i = 0; i < 4; i++) {
		s += a * noise(p);
		p = p * 2.03 + 17.0;
		a *= 0.5;
	}
	return s;
}
float fbmLow(vec2 p) {
	return noise(p) * 0.65 + noise(p * 2.1 + 9.0) * 0.35;
}

float waterHeight(vec2 p, out vec2 g) {
	float t = uTime;
	float a1 = p.x * 0.21 + p.y * 0.06 + t * 0.7;
	float a2 = p.x * 0.05 - p.y * 0.3 + t * 0.9;
	float a3 = (p.x + p.y) * 0.52 + t * 1.3;
	float a4 = p.x * 1.1 - p.y * 0.8 + t * 1.9;
	g = vec2(0.21, 0.06) * cos(a1) * 0.55
		+ vec2(0.05, -0.3) * cos(a2) * 0.42
		+ vec2(0.52, 0.52) * cos(a3) * 0.15
		+ vec2(1.1, -0.8) * cos(a4) * 0.045;
	return sin(a1) * 0.55 + sin(a2) * 0.42 + sin(a3) * 0.15 + sin(a4) * 0.045;
}

float aurora(vec3 d, float detail) {
	vec2 p = d.xz / (d.y + 0.22);
	float a = 0.0;
	for (int i = 0; i < 3; i++) {
		float fi = float(i);
		vec2 q = vec2(p.x * 0.45 + fi * 3.7 + uTime * 0.02, p.y * 0.3 - uTime * 0.013);
		float w = detail > 0.5 ? fbm(q) : fbmLow(q);
		float band = clamp(1.0 - abs(p.y * 0.5 + 1.35 - fi * 0.55 + (w - 0.5) * 2.6), 0.0, 1.0);
		float rays = 0.5 + 0.5 * sin(p.x * 7.0 + w * 16.0 + uTime * 0.3 + fi * 2.0);
		a += band * band * (0.4 + 0.6 * rays) * (1.0 - fi * 0.22);
	}
	return a * smoothstep(0.03, 0.3, d.y) * smoothstep(0.98, 0.5, d.y);
}

vec3 orbColor() {
	return mix(vec3(1.0, 0.8, 0.52), vec3(0.84, 0.91, 1.0), uNight);
}

vec3 skyColor(vec3 d, float detail) {
	float h = max(d.y, 0.0);
	vec3 night = mix(vec3(0.04, 0.085, 0.15), vec3(0.006, 0.012, 0.036), pow(h, 0.42));
	vec3 day = mix(vec3(1.0, 0.85, 0.7), vec3(0.5, 0.68, 0.88), pow(h, 0.5));
	vec3 col = mix(day, night, uNight);
	float m = max(dot(d, uOrb), 0.0);
	vec3 orb = orbColor();
	col += orb * (pow(m, mix(14.0, 90.0, uNight)) * mix(0.6, 0.16, uNight) + pow(m, 900.0) * mix(0.6, 0.22, uNight));

	vec2 cp = d.xz * 2.2 / (d.y + 0.35) + vec2(uTime * 0.008, 0.0);
	float c = detail > 0.5 ? fbm(cp) : fbmLow(cp);
	float cloud = smoothstep(0.48, 0.86, c) * smoothstep(0.0, 0.16, d.y) * smoothstep(0.75, 0.25, d.y);
	vec3 cloudCol = mix(vec3(1.0, 0.94, 0.88), vec3(0.09, 0.15, 0.25), uNight) + orb * pow(m, 6.0) * 0.4;

	if (detail > 0.5) {
		col = mix(col, orb * 1.2, smoothstep(mix(0.99962, 0.9998, uNight), mix(0.99975, 0.99987, uNight), m));
		vec3 sp = d * 190.0;
		vec3 id = floor(sp);
		float r = hash31(id);
		float twinkle = 0.55 + 0.45 * sin(uTime * (1.0 + r * 3.0) + r * 100.0);
		float star = step(0.987, r) * smoothstep(0.24, 0.0, length(fract(sp) - 0.5)) * twinkle;
		col += vec3(0.85, 0.92, 1.0) * star * uNight * smoothstep(0.0, 0.14, d.y) * (1.0 - cloud) * 1.5;
	}
	col = mix(col, cloudCol, cloud * mix(0.6, 0.42, uNight));

	float au = aurora(d, detail) * uNight;
	col += mix(vec3(0.08, 0.95, 0.6), vec3(0.52, 0.3, 1.0), smoothstep(0.12, 0.62, d.y)) * au * 0.55;

	vec3 haze = mix(vec3(1.0, 0.9, 0.8), vec3(0.06, 0.12, 0.19), uNight);
	return mix(col, haze, pow(1.0 - h, 14.0) * 0.75);
}

vec3 grade(vec3 col) {
	return col * mix(1.0, uDim, uNight);
}
`;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = position;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uMeteorA;
uniform vec3 uMeteorB;
uniform float uMeteorT;
varying vec3 vDir;

void main() {
	vec3 d = normalize(vDir);
	vec3 col = skyColor(d, 1.0);

	if (uMeteorT > 0.0) {
		vec3 head = normalize(mix(uMeteorA, uMeteorB, uMeteorT));
		vec3 tail = normalize(mix(uMeteorA, uMeteorB, max(uMeteorT - 0.3, 0.0)));
		vec3 ab = head - tail;
		float along = clamp(dot(d - tail, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
		float dist = length(d - (tail + ab * along));
		col += vec3(1.0, 0.95, 0.85) * smoothstep(0.0035, 0.0, dist) * along * along * uNight * sin(uMeteorT * PI) * 1.6;
	}

	// 远山：两层剪影，近的更深。
	float az = atan(d.z, d.x);
	float far = 0.016 + 0.05 * fbm(vec2(az * 5.0, 1.0));
	float near = 0.006 + 0.034 * fbm(vec2(az * 9.0 + 4.0, 7.0));
	col = mix(col, mix(vec3(0.66, 0.72, 0.8), vec3(0.035, 0.07, 0.115), uNight), smoothstep(far + 0.003, far, d.y));
	col = mix(col, mix(vec3(0.5, 0.58, 0.68), vec3(0.018, 0.038, 0.066), uNight), smoothstep(near + 0.003, near, d.y));

	gl_FragColor = vec4(grade(col), 1.0);
}
`;

const WATER_VERTEX = /* glsl */ `
${COMMON}
uniform float uSwell;
uniform float uPulse;
uniform float uPulseAmp;
uniform vec3 uPulseOrigin;
varying vec3 vWorld;

void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	vec2 g;
	float ringDist = distance(world.xz, uPulseOrigin.xz) - uPulse;
	world.y = waterHeight(world.xz, g) * uSwell + exp(-ringDist * ringDist * 0.09) * uPulseAmp * 1.2;
	vWorld = world.xyz;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WATER_FRAGMENT = /* glsl */ `
${COMMON}
uniform float uSwell;
uniform float uBeam;
uniform float uPulse;
uniform float uPulseAmp;
uniform float uCursorAmp;
uniform vec3 uLight;
uniform vec3 uLamp;
uniform vec3 uCursor;
uniform vec3 uPulseOrigin;
uniform vec3 uGold;
uniform vec3 uTide;
varying vec3 vWorld;

void main() {
	vec2 p = vWorld.xz;
	vec3 toEye = cameraPosition - vWorld;
	float dist = length(toEye);
	vec3 V = toEye / dist;

	vec2 g;
	float h = waterHeight(p, g);
	g *= uSwell;
	// 细碎的波纹只在近处算，远处会闪。
	float att = exp(-dist * 0.014);
	vec2 q = p * 0.9 + vec2(uTime * 0.35, uTime * 0.22);
	float n0 = noise(q);
	g += vec2(noise(q + vec2(0.35, 0.0)) - n0, noise(q + vec2(0.0, 0.35)) - n0) * 1.15 * att;
	vec2 q2 = p * 2.7 - vec2(uTime * 0.5, -uTime * 0.3);
	float n1 = noise(q2);
	g += vec2(noise(q2 + vec2(0.3, 0.0)) - n1, noise(q2 + vec2(0.0, 0.3)) - n1) * 0.5 * att * att;
	vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

	float ndv = max(dot(N, V), 0.0);
	float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
	vec3 R = reflect(-V, N);
	R.y = abs(R.y) + 0.02;
	R = normalize(R);

	vec3 deep = mix(vec3(0.27, 0.45, 0.54), vec3(0.005, 0.016, 0.03), uNight);
	vec3 col = mix(deep, skyColor(R, 0.0), fres);
	col += uTide * smoothstep(0.3, 1.2, h) * mix(0.05, 0.035, uNight);

	// 月亮或太阳在水面上拉出的一条碎光。
	col += orbColor() * pow(max(dot(R, uOrb), 0.0), 320.0) * mix(1.0, 1.3, uNight);

	// 灯塔：扫过水面的光束、灯室的倒影、塔脚的一圈暖光。
	vec2 toPoint = p - uLight.xz;
	float away = length(toPoint);
	float angle = atan(toPoint.y, toPoint.x);
	float front = abs(mod(angle - uBeam + PI, TAU) - PI);
	float back = abs(mod(angle - uBeam, TAU) - PI);
	float beam = smoothstep(0.17, 0.0, front) * exp(-away * 0.012)
		+ smoothstep(0.12, 0.0, back) * exp(-away * 0.025) * 0.5;
	col += uGold * beam * (0.3 + 1.3 * pow(1.0 - ndv, 2.0));
	vec3 L = normalize(uLamp - vWorld);
	col += uGold * pow(max(dot(reflect(-L, N), V), 0.0), 90.0) * 1.6 * exp(-away * 0.012);
	col += uGold * exp(-away * away * 0.004) * 0.22;

	// 指针照亮的水面与荡开的光圈。
	float cursorDist = distance(p, uCursor.xz);
	col += mix(uTide, uGold, 0.35) * exp(-cursorDist * cursorDist * 0.05) * uCursorAmp * 0.3;
	float ringDist = distance(p, uPulseOrigin.xz) - uPulse;
	col += uGold * exp(-ringDist * ringDist * 0.12) * uPulseAmp * 0.55;

	vec3 horizon = skyColor(normalize(vec3(-V.x, 0.012, -V.z)), 0.0);
	col = mix(col, horizon, smoothstep(40.0, 340.0, dist));
	gl_FragColor = vec4(grade(col), 1.0);
}
`;

const SPARK_VERTEX = /* glsl */ `
${COMMON}
uniform float uSwell;
uniform float uBeam;
uniform float uPulse;
uniform float uPulseAmp;
uniform float uCursorAmp;
uniform float uDpr;
uniform vec3 uLight;
uniform vec3 uCursor;
uniform vec3 uPulseOrigin;
varying float vGlow;
varying float vFog;

void main() {
	vec3 p = position;
	vec2 g;
	float ringDist = distance(p.xz, uPulseOrigin.xz) - uPulse;
	float ring = exp(-ringDist * ringDist * 0.09) * uPulseAmp;
	float h = waterHeight(p.xz, g);
	p.y = h * uSwell + ring * 1.2 + 0.06;

	vec2 toPoint = p.xz - uLight.xz;
	float away = length(toPoint);
	float front = abs(mod(atan(toPoint.y, toPoint.x) - uBeam + PI, TAU) - PI);
	float beam = smoothstep(0.2, 0.0, front) * exp(-away * 0.016);
	float cursorDist = distance(p.xz, uCursor.xz);
	float cursor = exp(-cursorDist * cursorDist * 0.045) * uCursorAmp;
	vGlow = beam + ring + cursor + smoothstep(0.7, 1.15, h) * 0.25;

	vec4 mv = modelViewMatrix * vec4(p, 1.0);
	gl_Position = projectionMatrix * mv;
	gl_PointSize = clamp((1.4 + vGlow * 3.0) * uDpr * (26.0 / -mv.z), 1.0, 12.0 * uDpr);
	vFog = smoothstep(100.0, 10.0, -mv.z);
}
`;

const SPARK_FRAGMENT = /* glsl */ `
uniform vec3 uGold;
uniform float uOpacity;
varying float vGlow;
varying float vFog;

void main() {
	float d = length(gl_PointCoord - 0.5);
	gl_FragColor = vec4(uGold, smoothstep(0.5, 0.05, d) * vFog * vGlow * uOpacity);
}
`;

const DUST_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uDpr;
attribute float aSeed;
varying float vAlpha;

void main() {
	vec3 p = position;
	p.y = mod(p.y + uTime * (0.08 + aSeed * 0.22), 22.0) + 0.5;
	p.x += sin(uTime * 0.21 + aSeed * 40.0) * 1.4;
	p.z += cos(uTime * 0.17 + aSeed * 23.0) * 1.1;
	vec4 mv = modelViewMatrix * vec4(p, 1.0);
	gl_Position = projectionMatrix * mv;
	float twinkle = 0.5 + 0.5 * sin(uTime * (0.7 + aSeed * 2.2) + aSeed * 90.0);
	gl_PointSize = clamp((1.2 + aSeed * 2.6) * uDpr * (30.0 / -mv.z), 1.0, 8.0 * uDpr);
	vAlpha = twinkle * smoothstep(90.0, 14.0, -mv.z) * smoothstep(0.5, 3.0, p.y) * smoothstep(22.0, 12.0, p.y);
}
`;

const DUST_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;

void main() {
	float d = length(gl_PointCoord - 0.5);
	gl_FragColor = vec4(uColor, smoothstep(0.5, 0.0, d) * vAlpha * uOpacity);
}
`;

const BEAM_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vFacing;

void main() {
	vUv = uv;
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
	gl_Position = projectionMatrix * mv;
}
`;

const BEAM_FRAGMENT = /* glsl */ `
uniform vec3 uGold;
uniform float uOpacity;
varying vec2 vUv;
varying float vFacing;

void main() {
	float along = pow(vUv.y, 1.7);
	float soft = mix(0.2, 1.0, vFacing);
	gl_FragColor = vec4(uGold, along * soft * uOpacity);
}
`;

function glowTexture(): CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const context = canvas.getContext("2d");
	if (context !== null) {
		const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
		gradient.addColorStop(0, "rgba(255,255,255,1)");
		gradient.addColorStop(0.18, "rgba(255,255,255,0.55)");
		gradient.addColorStop(0.5, "rgba(255,255,255,0.12)");
		gradient.addColorStop(1, "rgba(255,255,255,0)");
		context.fillStyle = gradient;
		context.fillRect(0, 0, 128, 128);
	}
	return new CanvasTexture(canvas);
}

function cssColor(name: string, fallback: string): Color {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
	try {
		return new Color(value === "" ? fallback : value);
	} catch {
		return new Color(fallback);
	}
}

/** 没有显卡、靠 CPU 画 WebGL 的环境（无头浏览器、远程桌面）：整屏着色器会把页面拖垮。 */
function softwareRendered(renderer: WebGLRenderer): boolean {
	const gl = renderer.getContext();
	const info = gl.getExtension("WEBGL_debug_renderer_info");
	if (info === null) return false;
	const name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
	return /swiftshader|llvmpipe|software|basic render/i.test(name);
}

const NIGHT_ORB = new Vector3(-0.42, 0.36, -0.83).normalize();
const DAY_ORB = new Vector3(-0.42, 0.075, -0.9).normalize();

/** 把雾港挂到画布上；返回卸载函数。创建不了 WebGL 时抛错，由调用方退回纯 CSS 背景。 */
export function mountScene(canvas: HTMLCanvasElement): () => void {
	// 着色器里直接写显示用的颜色，不让 three 再做一次色彩空间换算。
	ColorManagement.enabled = false;
	const renderer = new WebGLRenderer({
		canvas,
		antialias: false,
		powerPreference: "high-performance",
	});
	const small = window.innerWidth < 760;
	let ratio = Math.min(window.devicePixelRatio || 1, 1.5);
	renderer.setPixelRatio(ratio);

	const scene = new Scene();
	const camera = new PerspectiveCamera(52, 1, 0.1, 1600);
	const start = POSES[stage.route];
	camera.position.set(...start.pos);
	const look = new Vector3(...start.look);

	// 天空、水面、水面上的光点共用这些量，保证倒影和本体对得上。
	const shared = {
		uTime: { value: 0 },
		uNight: { value: 1 },
		uDim: { value: start.dim },
		uOrb: { value: NIGHT_ORB.clone() },
		uSwell: { value: 1 },
		uBeam: { value: 2.4 },
		uPulse: { value: 0 },
		uPulseAmp: { value: 0 },
		uCursorAmp: { value: 0 },
		uLight: { value: LIGHT },
		uLamp: { value: new Vector3(LIGHT.x, LAMP_Y, LIGHT.z) },
		uCursor: { value: new Vector3(0, 0, -20) },
		uPulseOrigin: { value: new Vector3(0, 0, -10) },
		uGold: { value: new Color() },
		uTide: { value: new Color() },
		uDpr: { value: ratio },
	};
	const meteor = {
		uMeteorA: { value: new Vector3(0, 1, 0) },
		uMeteorB: { value: new Vector3(0, 1, 0) },
		uMeteorT: { value: -1 },
	};

	const skyGeometry = new SphereGeometry(900, 48, 24);
	const skyMaterial = new ShaderMaterial({
		vertexShader: SKY_VERTEX,
		fragmentShader: SKY_FRAGMENT,
		side: BackSide,
		depthWrite: false,
		uniforms: { ...shared, ...meteor },
	});
	const sky = new Mesh(skyGeometry, skyMaterial);
	sky.frustumCulled = false;
	sky.renderOrder = -2;
	scene.add(sky);

	const segments = small ? 150 : 240;
	const waterGeometry = new PlaneGeometry(900, 900, segments, segments);
	waterGeometry.rotateX(-Math.PI / 2);
	const waterMaterial = new ShaderMaterial({
		vertexShader: WATER_VERTEX,
		fragmentShader: WATER_FRAGMENT,
		uniforms: shared,
	});
	const water = new Mesh(waterGeometry, waterMaterial);
	water.position.set(LIGHT.x * 0.4, 0, -330);
	water.frustumCulled = false;
	water.renderOrder = -1;
	scene.add(water);

	// 水面上的光点：平时几乎看不见，被光束、指针或光圈扫到才亮。
	const columns = small ? 110 : 170;
	const rows = small ? 90 : 140;
	const sparkPositions = new Float32Array(columns * rows * 3);
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const index = (row * columns + column) * 3;
			sparkPositions[index] =
				(column / (columns - 1) - 0.5) * 190 + LIGHT.x * 0.4;
			sparkPositions[index + 1] = 0;
			sparkPositions[index + 2] = 26 - (row / (rows - 1)) * 150;
		}
	}
	const sparkGeometry = new BufferGeometry();
	sparkGeometry.setAttribute(
		"position",
		new BufferAttribute(sparkPositions, 3),
	);
	const sparkOpacity = { value: 1 };
	const sparkMaterial = new ShaderMaterial({
		vertexShader: SPARK_VERTEX,
		fragmentShader: SPARK_FRAGMENT,
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending,
		uniforms: { ...shared, uOpacity: sparkOpacity },
	});
	const sparks = new Points(sparkGeometry, sparkMaterial);
	sparks.frustumCulled = false;
	scene.add(sparks);

	// 贴着水面飘的萤火。
	const dustCount = small ? 260 : 620;
	const dustPositions = new Float32Array(dustCount * 3);
	const dustSeeds = new Float32Array(dustCount);
	for (let index = 0; index < dustCount; index += 1) {
		dustPositions[index * 3] = (Math.random() - 0.5) * 150 + LIGHT.x * 0.4;
		dustPositions[index * 3 + 1] = Math.random() * 22;
		dustPositions[index * 3 + 2] = 20 - Math.random() * 110;
		dustSeeds[index] = Math.random();
	}
	const dustGeometry = new BufferGeometry();
	dustGeometry.setAttribute("position", new BufferAttribute(dustPositions, 3));
	dustGeometry.setAttribute("aSeed", new BufferAttribute(dustSeeds, 1));
	const dustColor = { value: new Color() };
	const dustOpacity = { value: 1 };
	const dustMaterial = new ShaderMaterial({
		vertexShader: DUST_VERTEX,
		fragmentShader: DUST_FRAGMENT,
		transparent: true,
		depthWrite: false,
		uniforms: {
			uTime: shared.uTime,
			uDpr: shared.uDpr,
			uColor: dustColor,
			uOpacity: dustOpacity,
		},
	});
	const dust = new Points(dustGeometry, dustMaterial);
	dust.frustumCulled = false;
	scene.add(dust);

	// 灯塔：礁石、三段塔身、回廊、灯室、塔顶。
	const stoneMaterial = new MeshBasicMaterial();
	const bandMaterial = new MeshBasicMaterial();
	const windowMaterial = new MeshBasicMaterial();
	const tower = new Group();
	const towerMeshes: Mesh[] = [];
	const part = (mesh: Mesh, y: number) => {
		mesh.position.y = y;
		tower.add(mesh);
		towerMeshes.push(mesh);
	};
	part(new Mesh(new ConeGeometry(2.8, 1.5, 7), stoneMaterial), 0.3);
	part(new Mesh(new CylinderGeometry(0.52, 0.64, 1.6, 16), stoneMaterial), 1.6);
	part(new Mesh(new CylinderGeometry(0.43, 0.52, 1.5, 16), bandMaterial), 3.15);
	part(
		new Mesh(new CylinderGeometry(0.36, 0.43, 1.1, 16), stoneMaterial),
		4.45,
	);
	part(new Mesh(new CylinderGeometry(0.6, 0.6, 0.12, 16), stoneMaterial), 5.05);
	part(new Mesh(new CylinderGeometry(0.3, 0.3, 0.62, 12), windowMaterial), 5.4);
	part(new Mesh(new ConeGeometry(0.48, 0.62, 16), stoneMaterial), 6.02);
	tower.position.copy(LIGHT);
	scene.add(tower);

	// 光束：两支方向相反的光锥，绕着灯室转。
	const beamOpacity = { value: 0.3 };
	const beamMaterial = new ShaderMaterial({
		vertexShader: BEAM_VERTEX,
		fragmentShader: BEAM_FRAGMENT,
		transparent: true,
		depthWrite: false,
		side: DoubleSide,
		uniforms: { uGold: shared.uGold, uOpacity: beamOpacity },
	});
	const coneGeometry = new ConeGeometry(8, 130, 40, 1, true);
	coneGeometry.translate(0, -65, 0);
	coneGeometry.rotateZ(Math.PI / 2);
	const beams = new Group();
	const frontBeam = new Mesh(coneGeometry, beamMaterial);
	const backBeam = new Mesh(coneGeometry, beamMaterial);
	backBeam.rotation.y = Math.PI;
	backBeam.scale.set(0.5, 0.6, 0.6);
	beams.add(frontBeam, backBeam);
	beams.position.set(LIGHT.x, LAMP_Y, LIGHT.z);
	scene.add(beams);

	const glow = glowTexture();
	const lampMaterial = new SpriteMaterial({
		map: glow,
		transparent: true,
		depthWrite: false,
	});
	const lamp = new Sprite(lampMaterial);
	lamp.position.set(LIGHT.x, LAMP_Y, LIGHT.z);
	scene.add(lamp);

	let nightTarget = 1;
	const paint = () => {
		const gold = cssColor("--gold", "#e6b450");
		const dark = getComputedStyle(
			document.documentElement,
		).colorScheme.includes("dark");
		nightTarget = dark ? 1 : 0;
		shared.uGold.value.copy(dark ? gold : new Color("#ffcf7a"));
		shared.uTide.value.copy(cssColor("--teal", "#62c8be"));
		const blending = dark ? AdditiveBlending : NormalBlending;
		for (const material of [beamMaterial, dustMaterial, lampMaterial]) {
			material.blending = blending;
			material.needsUpdate = true;
		}
		lampMaterial.color.copy(dark ? gold : new Color("#fff1cf"));
		dustColor.value.copy(new Color(dark ? "#ffd98a" : "#ffffff"));
		stoneMaterial.color.copy(new Color(dark ? "#0e1a27" : "#f3f1ec"));
		bandMaterial.color.copy(new Color(dark ? "#1c2a3b" : "#b9503f"));
		windowMaterial.color.copy(dark ? gold : new Color("#ffe9b8"));
	};
	paint();
	shared.uNight.value = nightTarget;

	const themeWatch = new MutationObserver(paint);
	themeWatch.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	const scheme = window.matchMedia("(prefers-color-scheme: dark)");
	scheme.addEventListener("change", paint);

	const resize = () => {
		const width = window.innerWidth;
		const height = window.innerHeight;
		renderer.setSize(width, height, false);
		camera.aspect = width / Math.max(height, 1);
		// 竖屏时把视角放宽，灯塔才不会出画。
		camera.fov = camera.aspect < 0.8 ? 74 : 52;
		camera.updateProjectionMatrix();
	};
	resize();

	const pointer = new Vector2(0, 0);
	let pointerSeen = false;
	const onPointer = (event: PointerEvent) => {
		pointer.set(
			(event.clientX / window.innerWidth) * 2 - 1,
			-(event.clientY / window.innerHeight) * 2 + 1,
		);
		pointerSeen = true;
	};
	window.addEventListener("pointermove", onPointer, { passive: true });

	const raycaster = new Raycaster();
	const surface = new Plane(new Vector3(0, 1, 0), 0);
	const hit = new Vector3();
	const target = new Vector3();
	const lookTarget = new Vector3();
	const eye = new Vector3(...start.pos);
	const toCamera = new Vector3();
	const streak = new Vector3();
	let time = 0;
	let last = performance.now();
	let frame = 0;
	let meteorIn = 5 + Math.random() * 6;
	let slowFrames = 0;
	let frames = 0;
	const still =
		reducedMotion() || navigator.webdriver || softwareRendered(renderer);

	const renderFrame = (dt: number) => {
		const pose = POSES[stage.route];
		const jump = dt === 0;
		const ease = jump ? 1 : 1 - Math.exp(-dt * 1.9);
		const slow = jump ? 1 : 1 - Math.exp(-dt * 1.2);
		time += dt;
		shared.uTime.value = time;

		target.set(...pose.pos);
		lookTarget.set(...pose.look);
		eye.lerp(target, ease);
		look.lerp(lookTarget, ease);
		shared.uDim.value += (pose.dim - shared.uDim.value) * slow;

		// 换主题不是切换，是一次日出或日落。
		shared.uNight.value +=
			(nightTarget - shared.uNight.value) *
			(jump ? 1 : 1 - Math.exp(-dt * 1.6));
		const night = shared.uNight.value;
		shared.uOrb.value.copy(DAY_ORB).lerp(NIGHT_ORB, night).normalize();
		const dark = night > 0.5;

		const scroll = Math.min(window.scrollY, 1400) / 1400;
		camera.position.set(
			eye.x + pointer.x * 1.3,
			Math.max(1.4, eye.y + pointer.y * 0.5 - scroll * 0.9),
			eye.z,
		);
		camera.lookAt(look);
		sky.position.copy(camera.position);

		shared.uSwell.value +=
			((stage.writing ? 1.7 : 1) - shared.uSwell.value) * slow;
		shared.uBeam.value += dt * (stage.writing ? 0.62 : 0.2);
		shared.uPulse.value += dt * 30;
		shared.uPulseAmp.value *= Math.exp(-dt * 0.85);

		if (pointerSeen) {
			raycaster.setFromCamera(pointer, camera);
			const found = raycaster.ray.intersectPlane(surface, hit) !== null;
			if (found) {
				shared.uCursor.value.lerp(hit, jump ? 1 : 1 - Math.exp(-dt * 6));
			}
			shared.uCursorAmp.value +=
				((found ? 1 : 0) - shared.uCursorAmp.value) * slow;
		}

		// 流星：夜里隔一阵划过一颗。
		if (meteor.uMeteorT.value >= 0) {
			meteor.uMeteorT.value += dt * 1.1;
			if (meteor.uMeteorT.value > 1) meteor.uMeteorT.value = -1;
		} else {
			meteorIn -= dt;
			if (meteorIn < 0 && dark) {
				meteorIn = 7 + Math.random() * 11;
				meteor.uMeteorA.value
					.set((Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 0.35, -1)
					.normalize();
				streak.set(Math.random() > 0.5 ? 0.34 : -0.34, -0.2, 0);
				meteor.uMeteorB.value
					.copy(meteor.uMeteorA.value)
					.add(streak)
					.normalize();
				meteor.uMeteorT.value = 0;
			}
		}

		// 光束扫过镜头的那一刻，灯室闪一下。
		toCamera.copy(camera.position).sub(lamp.position);
		const facing = Math.cos(
			Math.atan2(toCamera.z, toCamera.x) - shared.uBeam.value,
		);
		const flare = Math.max(0, facing) ** 24;
		const lampSize = 7 + flare * 20 + (stage.writing ? 2 : 0);
		lamp.scale.set(lampSize, lampSize, 1);
		const dim = dark ? shared.uDim.value : 1;
		lampMaterial.opacity = (dark ? 0.9 : 0.7) * Math.min(1, dim + flare * 0.5);
		beamOpacity.value = (dark ? 0.3 : 0.22) * dim * (stage.writing ? 1.5 : 1);
		sparkOpacity.value = (dark ? 0.9 : 0.5) * dim;
		dustOpacity.value = (dark ? 0.75 : 0.5) * dim;
		beams.rotation.y = -shared.uBeam.value;
		renderer.render(scene, camera);
	};

	const loop = (now: number) => {
		frame = requestAnimationFrame(loop);
		const raw = (now - last) / 1000;
		last = now;
		renderFrame(Math.min(raw, 0.05));
		// 机器带不动时逐级降低渲染分辨率，保住流畅。
		frames += 1;
		if (raw > 1 / 38) slowFrames += 1;
		if (frames >= 90) {
			if (slowFrames > 55 && ratio > 0.6) {
				ratio = Math.max(0.6, ratio * 0.8);
				renderer.setPixelRatio(ratio);
				shared.uDpr.value = ratio;
				resize();
			}
			frames = 0;
			slowFrames = 0;
		}
	};

	const offPulse = stage.onPulse((strength) => {
		shared.uPulse.value = 0;
		shared.uPulseAmp.value = Math.min(1.4, strength);
		// 从镜头正前方的水面荡开，玩家一定看得见。
		shared.uPulseOrigin.value.set(
			camera.position.x + (look.x - camera.position.x) * 0.3,
			0,
			camera.position.z + (look.z - camera.position.z) * 0.3,
		);
		if (still) renderFrame(0);
	});

	const onResize = () => {
		resize();
		if (still) renderFrame(0);
	};
	window.addEventListener("resize", onResize);

	const onVisibility = () => {
		if (still) return;
		cancelAnimationFrame(frame);
		if (!document.hidden) {
			last = performance.now();
			frame = requestAnimationFrame(loop);
		}
	};
	document.addEventListener("visibilitychange", onVisibility);

	// 减少动效时不跑循环：只在换页或换主题时重画一张静止的画面。
	let stillTimer: ReturnType<typeof setInterval> | null = null;
	if (still) {
		renderFrame(0);
		let shown = `${stage.route}/${nightTarget}`;
		stillTimer = setInterval(() => {
			const now = `${stage.route}/${nightTarget}`;
			if (now === shown) return;
			shown = now;
			renderFrame(0);
		}, 300);
	} else {
		frame = requestAnimationFrame(loop);
	}

	return () => {
		cancelAnimationFrame(frame);
		if (stillTimer !== null) clearInterval(stillTimer);
		offPulse();
		themeWatch.disconnect();
		scheme.removeEventListener("change", paint);
		window.removeEventListener("pointermove", onPointer);
		window.removeEventListener("resize", onResize);
		document.removeEventListener("visibilitychange", onVisibility);
		for (const geometry of [
			skyGeometry,
			waterGeometry,
			sparkGeometry,
			dustGeometry,
			coneGeometry,
		]) {
			geometry.dispose();
		}
		for (const mesh of towerMeshes) mesh.geometry.dispose();
		for (const material of [
			skyMaterial,
			waterMaterial,
			sparkMaterial,
			dustMaterial,
			beamMaterial,
			stoneMaterial,
			bandMaterial,
			windowMaterial,
			lampMaterial,
		]) {
			material.dispose();
		}
		glow.dispose();
		renderer.dispose();
	};
}
