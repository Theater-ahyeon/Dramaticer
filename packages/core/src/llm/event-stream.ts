export interface EventStream<TEvent, TResult> extends AsyncIterable<TEvent> {
	result(): Promise<TResult>;
}

interface Waiter<TEvent> {
	readonly resolve: (value: IteratorResult<TEvent>) => void;
	readonly reject: (error: unknown) => void;
}

/**
 * 把“开始生成并推送事件”的函数包装成可迭代对象。
 *
 * 生成立即开始，事件先进入队列；只调用 result() 时可以丢弃事件。
 * 生成失败时，正在等待的迭代器与后续 next() 都会抛出同一个错误。
 */
export function createEventStream<TEvent, TResult>(
	start: (emit: (event: TEvent) => void) => Promise<TResult>,
): EventStream<TEvent, TResult> {
	const queue: TEvent[] = [];
	const waiters: Waiter<TEvent>[] = [];
	let ended = false;
	let failed = false;
	let failure: unknown;

	const resolveNext = (): void => {
		const waiter = waiters.shift();
		if (!waiter) return;
		if (failed) {
			waiter.reject(failure);
			return;
		}
		waiter.resolve({ value: undefined as never, done: true });
	};

	const settle = (error: unknown, hasError: boolean): void => {
		ended = true;
		failed = hasError;
		failure = error;
		while (waiters.length > 0) resolveNext();
	};

	const result = start((event) => {
		if (ended) return;
		const waiter = waiters.shift();
		if (waiter) waiter.resolve({ value: event, done: false });
		else queue.push(event);
	}).then(
		(value) => {
			settle(undefined, false);
			return value;
		},
		(error: unknown) => {
			settle(error, true);
			throw error;
		},
	);
	// 只消费事件的调用方不会读取 result()，避免未处理的 rejection。
	void result.catch(() => undefined);

	const iterator: AsyncIterator<TEvent> = {
		next(): Promise<IteratorResult<TEvent>> {
			const event = queue.shift();
			if (event !== undefined) {
				return Promise.resolve({ value: event, done: false });
			}
			if (ended) {
				if (failed) return Promise.reject(failure);
				return Promise.resolve({ value: undefined as never, done: true });
			}
			const { promise, resolve, reject } =
				Promise.withResolvers<IteratorResult<TEvent>>();
			waiters.push({ resolve, reject });
			return promise;
		},
		return(): Promise<IteratorResult<TEvent>> {
			settle(undefined, false);
			return Promise.resolve({ value: undefined as never, done: true });
		},
	};

	return {
		[Symbol.asyncIterator]: () => iterator,
		result: () => result,
	};
}
