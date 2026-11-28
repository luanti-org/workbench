/** Start the tree generator worker (worker.ts) */
export function createGeneratorWorker(): Worker {
	return new Worker(new URL('./worker.ts', import.meta.url), {
		type: 'module',
	});
}
