import { describe, expect, it } from 'vitest';
import {
	checkBrackets,
	expand,
	type GenerateOptions,
	generate,
	generateTraced,
	type NodeKind,
} from './generate';
import { Random } from './random';
import { DEFAULT_TREEDEF, type TreeDef } from './treedef';

/** A treedef with every optional node and rule cleared */
function tree(def: Partial<TreeDef>): TreeDef {
	return {
		...DEFAULT_TREEDEF,
		trunk: 'x:trunk',
		leaves: 'x:leaves',
		leaves2: '',
		fruit: '',
		angle: 90,
		seed: 1,
		...def,
	};
}

/** No angle wobble, so shapes are exact */
const exact: GenerateOptions = { turnJitter: () => 0 };

/** "x,y,z:kind" strings, sorted, for easy comparison */
function nodes(
	def: Partial<TreeDef>,
	options: GenerateOptions = exact,
): string[] {
	const { voxels } = generate(tree(def), options);
	const out: string[] = [];
	for (const [kind, data] of Object.entries(voxels)) {
		for (let i = 0; i < data.length; i += 3)
			out.push(`${data[i]},${data[i + 1]},${data[i + 2]}:${kind}`);
	}
	return out.sort();
}

function count(
	def: Partial<TreeDef>,
	kind: NodeKind,
	options: GenerateOptions = exact,
) {
	return generate(tree(def), options).voxels[kind].length / 3;
}

describe('expand', () => {
	const run = (def: Partial<TreeDef>, iterations: number, maxLength = 1e6) =>
		expand(tree(def), iterations, new Random(1), maxLength);

	it('replaces uppercase rule letters every time', () => {
		expect(run({ axiom: 'A', rules_a: 'FA' }, 4).program).toBe('FFFFA');
		expect(run({ axiom: 'AB', rules_a: 'F', rules_b: 'T' }, 2).program).toBe(
			'FT',
		);
	});

	it('copies other symbols unchanged', () => {
		expect(run({ axiom: 'F[+G]-^&/*Tf', rules_a: 'X' }, 3).program).toBe(
			'F[+G]-^&/*Tf',
		);
	});

	it('drops a lowercase rule letter that fails its roll (it never expands later)', () => {
		const { program } = run({ axiom: 'd'.repeat(2_000), rules_d: 'F' }, 5);
		// d expands 60% of the time; failed ones vanish rather than retrying
		expect(program).toMatch(/^F*$/);
		expect(program.length).toBeGreaterThan(1_050);
		expect(program.length).toBeLessThan(1_350);
	});

	it('flags truncation when the result would get too long', () => {
		const result = run({ axiom: 'A', rules_a: 'AA' }, 30, 1_000);
		expect(result.truncated).toBe(true);
		expect(result.program.length).toBeLessThanOrEqual(1_000);
	});

	it('records where each symbol came from', () => {
		const exp = run({ axiom: 'FA', rules_a: 'TB', rules_b: 'f' }, 2);
		expect(exp.program).toBe('FTf');
		// F from axiom col 0; T from rules_a col 0; f from rules_b col 0
		expect([...exp.symField]).toEqual([0, 1, 2]);
		expect([...exp.symIndex]).toEqual([0, 0, 0]);
		// f came through B (rules_a col 1), which came through A (axiom col 1)
		const inst = exp.symInst[2];
		expect([exp.instField[inst], exp.instIndex[inst]]).toEqual([1, 1]);
		const parent = exp.instParent[inst];
		expect([exp.instField[parent], exp.instIndex[parent]]).toEqual([0, 1]);
		expect(exp.instParent[parent]).toBe(-1);
	});
});

describe('checkBrackets', () => {
	it('accepts balanced brackets', () => {
		expect(checkBrackets('F[+F[-F]]F', 'axiom')).toEqual([]);
	});

	it('errors on a closing bracket with no opening one', () => {
		const [d] = checkBrackets('F]F', 'rules_a');
		expect(d.level).toBe('error');
		expect(d.message).toContain('column 2');
	});

	it('warns about unclosed brackets', () => {
		const [d] = checkBrackets('[[F]', 'axiom');
		expect(d.level).toBe('warning');
		expect(d.message).toContain('1 unclosed');
	});
});

describe('generate: drawing', () => {
	it('draws a vertical trunk from the origin, placing before moving', () => {
		expect(nodes({ axiom: 'FFF' })).toEqual([
			'0,0,0:trunk',
			'0,1,0:trunk',
			'0,2,0:trunk',
		]);
	});

	it('G moves without drawing', () => {
		expect(nodes({ axiom: 'TGT' })).toEqual(['0,0,0:trunk', '0,2,0:trunk']);
	});

	it('f draws leaves and R draws fruit', () => {
		expect(nodes({ axiom: 'fR', fruit: 'x:fruit' })).toEqual([
			'0,0,0:leaves',
			'0,1,0:fruit',
		]);
	});

	it('R draws nothing without a fruit node', () => {
		expect(nodes({ axiom: 'R' })).toEqual([]);
	});

	it('ignores unknown symbols but warns about them', () => {
		const result = generate(tree({ axiom: 'FxF' }), exact);
		expect(result.nodeCount).toBe(2);
		expect(
			result.diagnostics.some((d) => d.message.includes('unknown symbols')),
		).toBe(true);
	});

	it('stops at a closing bracket with nothing to close', () => {
		const result = generate(tree({ axiom: 'F]FFF' }), exact);
		expect(result.nodeCount).toBe(1);
		expect(result.diagnostics.some((d) => d.level === 'error')).toBe(true);
	});

	it('returns to the saved position after a branch', () => {
		// The branch starts at height 2; after it, drawing resumes from height 2
		expect(nodes({ axiom: 'TT[&TT]TT' })).toEqual(
			['0,0,0', '0,1,0', '0,2,0', '0,2,-1', '0,3,0']
				.map((p) => `${p}:trunk`)
				.sort(),
		);
	});
});

describe('generate: turns match the engine', () => {
	// Positions recorded from core.spawn_tree in a headless server (angle 90)
	const cases: [string, string[]][] = [
		['TT+TT', ['0,0,0', '0,1,0', '0,2,0', '-1,2,0']],
		['TT-TT', ['0,0,0', '0,1,0', '0,2,0', '1,2,0']],
		['TT/&TT', ['0,0,0', '0,1,0', '0,2,0', '1,2,0']],
		['TT*&TT', ['0,0,0', '0,1,0', '0,2,0', '-1,2,0']],
		['TT&+TT', ['0,0,0', '0,1,0', '0,2,0', '-1,2,0']],
	];
	for (const [axiom, expected] of cases) {
		it(axiom, () => {
			expect(nodes({ axiom })).toEqual(
				expected.map((p) => `${p}:trunk`).sort(),
			);
		});
	}

	it('pitches then returns with ^', () => {
		expect(nodes({ axiom: 'T&^TT' })).toEqual([
			'0,0,0:trunk',
			'0,1,0:trunk',
			'0,2,0:trunk',
		]);
	});

	it('adds the per-tree wobble to every turn', () => {
		// 45° + 45° wobble = a full right angle, so this matches the 90° case
		const wobbled = nodes(
			{ axiom: 'TT+TT', angle: 45 },
			{ turnJitter: () => 45 },
		);
		expect(wobbled).toEqual(nodes({ axiom: 'TT+TT', angle: 90 }));
	});
});

describe('generate: trunk types and thin branches', () => {
	it('uses the trunk_type footprint', () => {
		expect(count({ axiom: 'TTT', trunk_type: 'single' }, 'trunk')).toBe(3);
		expect(count({ axiom: 'TTT', trunk_type: 'double' }, 'trunk')).toBe(12);
		expect(count({ axiom: 'TTT', trunk_type: 'crossed' }, 'trunk')).toBe(15);
	});

	it('with thin_branches, T is always 1 node, even on the main trunk', () => {
		expect(
			count(
				{ axiom: 'TTT', trunk_type: 'double', thin_branches: true },
				'trunk',
			),
		).toBe(3);
	});

	it('with thin_branches, F keeps the footprint outside brackets and is thin inside', () => {
		expect(
			count(
				{ axiom: 'FFF', trunk_type: 'double', thin_branches: true },
				'trunk',
			),
		).toBe(12);
		expect(
			count(
				{ axiom: '[FFF]', trunk_type: 'double', thin_branches: true },
				'trunk',
			),
		).toBe(3);
	});
});

describe('generate: leaves around F', () => {
	const offsets = (def: Partial<TreeDef>, kind: NodeKind) => {
		const data = generate(tree(def), exact).voxels[kind];
		const out: [number, number, number][] = [];
		for (let i = 0; i < data.length; i += 3)
			out.push([data[i], data[i + 1] - 5, data[i + 2]]);
		return out;
	};

	it('F outside brackets grows no leaves', () => {
		expect(count({ axiom: 'FFFFF' }, 'leaves')).toBe(0);
	});

	it('F inside brackets grows leaves only in the measured pattern', () => {
		for (let seed = 1; seed <= 20; seed++) {
			for (const [dx, dy, dz] of offsets(
				{ axiom: 'TTTTT[F]', seed },
				'leaves',
			)) {
				expect(Math.abs(dy)).toBe(1);
				expect([1, 3]).toContain(Math.abs(dx) + Math.abs(dz));
				expect(Math.abs(dx)).toBeLessThanOrEqual(2);
				expect(Math.abs(dz)).toBeLessThanOrEqual(2);
			}
		}
	});

	it('fills about 86% of the 24 cells on average', () => {
		let total = 0;
		for (let seed = 1; seed <= 200; seed++)
			total += count({ axiom: 'TTTTT[F]', seed }, 'leaves');
		const mean = total / 200;
		expect(mean).toBeGreaterThan(19.5);
		expect(mean).toBeLessThan(21.5);
	});

	it('with fruit enabled, fills every cell with fruit or leaves', () => {
		const result = generate(
			tree({ axiom: 'TTTTT[F]', fruit: 'x:fruit', fruit_chance: 50 }),
			exact,
		);
		expect(
			result.voxels.fruit.length / 3 + result.voxels.leaves.length / 3,
		).toBe(24);
		expect(
			count(
				{ axiom: 'TTTTT[F]', fruit: 'x:fruit', fruit_chance: 100 },
				'fruit',
			),
		).toBe(24);
	});

	it('fruit_chance does not apply to f', () => {
		expect(
			count(
				{ axiom: 'f'.repeat(20), fruit: 'x:fruit', fruit_chance: 100 },
				'fruit',
			),
		).toBe(0);
	});

	it('leaves2_chance applies to F leaves and to f', () => {
		expect(
			count(
				{ axiom: 'TTTTT[F]', leaves2: 'x:l2', leaves2_chance: 100 },
				'leaves',
			),
		).toBe(0);
		expect(
			count({ axiom: 'fff', leaves2: 'x:l2', leaves2_chance: 100 }, 'leaves2'),
		).toBe(3);
	});

	it('leaves never replace trunk', () => {
		const result = generate(
			tree({ axiom: 'TTTTT[F]', trunk_type: 'crossed' }),
			exact,
		);
		expect(result.voxels.trunk.length / 3).toBe(30);
	});

	it('later leaves replace earlier fruit', () => {
		// R draws inside a branch, then f draws on the same spot after it
		expect(nodes({ axiom: '[R]f', fruit: 'x:fruit' })).toEqual([
			'0,0,0:leaves',
		]);
	});
});

describe('generate: iterations and randomness', () => {
	it('never uses fewer than 2 iterations', () => {
		for (let seed = 1; seed <= 20; seed++) {
			const r = generate(
				tree({
					axiom: 'A',
					rules_a: 'TA',
					iterations: 3,
					random_level: 10,
					seed,
				}),
				exact,
			);
			expect(r.iterations).toBeGreaterThanOrEqual(2);
			expect(r.iterations).toBeLessThanOrEqual(3);
		}
	});

	it('is repeatable for a seed', () => {
		const def = {
			axiom: 'TT[&FF]a',
			rules_a: '[+FF]',
			fruit: 'x:fruit',
			fruit_chance: 20,
			seed: 99,
		};
		expect(nodes(def, {})).toEqual(nodes(def, {}));
	});

	it('picks a seed when none is given, and reports it', () => {
		const result = generate(tree({ axiom: 'F', seed: undefined }));
		expect(Number.isInteger(result.seed)).toBe(true);
	});

	it('stops drawing at maxNodes and warns', () => {
		const result = generate(tree({ axiom: 'F'.repeat(100) }), {
			...exact,
			maxNodes: 10,
		});
		expect(result.nodeCount).toBe(10);
		expect(
			result.diagnostics.some((d) => d.message.includes('Stopped drawing')),
		).toBe(true);
	});

	it('reports bounds', () => {
		const { bounds } = generate(tree({ axiom: 'TT+TT' }), exact);
		expect(bounds).toEqual({ min: [-1, 0, 0], max: [0, 2, 0] });
	});
});

describe('Trace', () => {
	const def = tree({ axiom: 'FFA', rules_a: '[&FF]', angle: 90 });

	it('finds the blocks drawn by a symbol, directly or through a rule letter', () => {
		const { result, trace } = generateTraced(def, exact);
		const all = trace.blocksFrom('axiom', 0, 3);
		expect(all.trunk.length).toBe(result.voxels.trunk.length / 3);
		expect(all.leaves.length).toBe(result.voxels.leaves.length / 3);

		// The first F of the axiom draws exactly one trunk block
		expect(trace.blocksFrom('axiom', 0, 1).trunk.length).toBe(1);
		expect(trace.blocksFrom('axiom', 0, 1).leaves.length).toBe(0);

		// The A draws the branch: two trunk blocks plus all the leaves
		const fromA = trace.blocksFrom('axiom', 2, 3);
		expect(fromA.trunk.length).toBe(2);
		expect(fromA.leaves.length).toBe(all.leaves.length);
		expect(trace.blocksFrom('rules_a', 2, 4).trunk.length).toBe(2);
	});

	it('picks a block back to its symbol and the rule letters it came through', () => {
		const { result, trace } = generateTraced(def, exact);
		expect(trace.pick('trunk', 0)?.chain[0].field).toBeDefined();
		const leaf = trace.pick('leaves', 0);
		expect(leaf?.symbol).toBe('F');
		expect(leaf?.chain[0].field).toBe('rules_a');
		expect(leaf?.chain[1]).toEqual({ field: 'axiom', index: 2 });
		expect(trace.pick('leaves', result.voxels.leaves.length)).toBeNull();
	});

	it('does not change the generated tree', () => {
		const { result } = generateTraced(def, exact);
		expect(result).toEqual(generate(def, exact));
	});
});
