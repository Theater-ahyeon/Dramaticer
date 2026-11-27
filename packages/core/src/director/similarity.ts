/** 楼层向量取全部块向量的平均值；相似度评测复用同一口径。 */
export function meanVector(
	vectors: readonly (readonly number[])[],
	label: string,
): number[] {
	const first = vectors[0];
	if (first === undefined) {
		throw new Error(`${label} 没有块向量`);
	}
	const dimensions = first.length;
	if (dimensions === 0) {
		throw new Error(`${label} 的块向量维度不能为 0`);
	}
	const total = new Array<number>(dimensions).fill(0);
	for (const vector of vectors) {
		if (vector.length !== dimensions) {
			throw new Error(
				`${label} 的块向量维度不一致：${dimensions} 与 ${vector.length}`,
			);
		}
		for (let index = 0; index < dimensions; index += 1) {
			total[index] += vector[index];
		}
	}
	for (let index = 0; index < dimensions; index += 1) {
		total[index] /= vectors.length;
	}
	return total;
}

/** 相邻楼层相似度与重复度评测共用的余弦计算。 */
export function cosineSimilarity(
	left: readonly number[],
	right: readonly number[],
): number {
	if (left.length !== right.length) {
		throw new Error(`向量维度不一致：${left.length} 与 ${right.length}`);
	}
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (let index = 0; index < left.length; index += 1) {
		const a = left[index];
		const b = right[index];
		dot += a * b;
		leftNorm += a * a;
		rightNorm += b * b;
	}
	if (leftNorm === 0 || rightNorm === 0) {
		throw new Error("楼层向量是零向量，无法计算余弦相似度");
	}
	return dot / Math.sqrt(leftNorm * rightNorm);
}
