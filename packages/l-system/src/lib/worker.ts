/// <reference lib="webworker" />
import {
	type GenerateOptions,
	type GenerateResult,
	generateTraced,
	type NodeKind,
	type PickInfo,
	type SourceField,
	type Trace,
} from './generate';
import type { TreeDef } from './treedef';

export type WorkerRequest =
	| { type: 'generate'; id: number; def: TreeDef; options: GenerateOptions }
	| {
			type: 'blocksFrom';
			id: number;
			field: SourceField;
			from: number;
			to: number;
	  }
	| { type: 'pick'; id: number; kind: NodeKind; index: number };

export type WorkerResponse =
	| { type: 'generate'; id: number; result?: GenerateResult; error?: string }
	| {
			type: 'blocksFrom';
			id: number;
			/** Generation the blocks belong to */
			generation: number;
			blocks: Record<NodeKind, Int32Array>;
	  }
	| { type: 'pick'; id: number; generation: number; info: PickInfo | null };

/** The last generated tree, kept so the page can ask where blocks came from */
let last: { generation: number; trace: Trace } | null = null;

function reply(message: WorkerResponse, transfer: Transferable[] = []) {
	self.postMessage(message, { transfer });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const req = event.data;
	switch (req.type) {
		case 'generate': {
			try {
				const { result, trace } = generateTraced(req.def, req.options);
				last = { generation: req.id, trace };
				const buffers = Object.values(result.voxels).map((a) => a.buffer);
				reply({ type: 'generate', id: req.id, result }, buffers);
			} catch (err) {
				reply({
					type: 'generate',
					id: req.id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			break;
		}
		case 'blocksFrom': {
			if (!last) return;
			const blocks = last.trace.blocksFrom(req.field, req.from, req.to);
			reply(
				{ type: 'blocksFrom', id: req.id, generation: last.generation, blocks },
				Object.values(blocks).map((a) => a.buffer),
			);
			break;
		}
		case 'pick': {
			if (!last) return;
			reply({
				type: 'pick',
				id: req.id,
				generation: last.generation,
				info: last.trace.pick(req.kind, req.index),
			});
			break;
		}
	}
};
