import { performance } from "node:perf_hooks";
import {
	CordisKernel,
	LiteKernel,
	createBlockPlugin,
	createDirectorPlugin,
	createScenePlugin,
	weatherServicePlugin,
} from "../dist/index.js";

const WARMUP = 20;
const RUNS = 200;

function stack() {
	return [
		weatherServicePlugin,
		createScenePlugin(),
		createDirectorPlugin(),
		createBlockPlugin(),
	];
}

async function cycle(Kernel) {
	const kernel = new Kernel();
	for (const definition of stack()) await kernel.load(definition);
	const snapshot = kernel.snapshot();
	if (snapshot.plugins.some((status) => status.state !== "active")) {
		throw new Error(`装载后不是全部 active：${JSON.stringify(snapshot.plugins)}`);
	}
	const slot = await kernel.runSlot({
		slot: "scene",
		storyId: "story-1",
		nodeId: null,
		switches: {},
		state: null,
	});
	if (slot.length !== 1) throw new Error(`槽位结果数量异常：${slot.length}`);
	await kernel.dispose();
}

async function bench(Kernel) {
	for (let i = 0; i < WARMUP; i += 1) await cycle(Kernel);
	const samples = [];
	for (let i = 0; i < RUNS; i += 1) {
		const start = performance.now();
		await cycle(Kernel);
		samples.push(performance.now() - start);
	}
	samples.sort((a, b) => a - b);
	const at = (q) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))];
	return {
		runs: RUNS,
		medianMs: Number(at(0.5).toFixed(3)),
		p90Ms: Number(at(0.9).toFixed(3)),
		minMs: Number(samples[0].toFixed(3)),
		maxMs: Number(samples[samples.length - 1].toFixed(3)),
	};
}

const result = {
	cycle: "新建内核 → 装载 weather 服务 + scene 槽位 + Director 机制 + 块类型 → 取一次 scene 槽位 → 关闭",
	warmup: WARMUP,
	cordis: await bench(CordisKernel),
	lite: await bench(LiteKernel),
};
console.log(JSON.stringify(result, null, 2));
