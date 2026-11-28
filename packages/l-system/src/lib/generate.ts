import { Random, randomSeed } from './random';
import type { TreeDef } from './treedef';

export type NodeKind = 'trunk' | 'leaves' | 'leaves2' | 'fruit';
export const NODE_KINDS: readonly NodeKind[] = [
	'trunk',
	'leaves',
	'leaves2',
	'fruit',
];

export interface GenerateOptions {
	/** Stop expanding once the string would exceed this length */
	maxLength?: number;
	/** Stop drawing after this many voxels */
	maxNodes?: number;
	/**
	 * Extra degrees added to every turn's angle, picked once per tree.
	 * Defaults to the in-game behaviour: 0 or 1, at random.
	 */
	turnJitter?: (rng: Random) => number;
}

export interface Diagnostic {
	level: 'error' | 'warning';
	message: string;
}

/** The text fields a symbol can come from, in the order used by traces */
export const SOURCE_FIELDS = [
	'axiom',
	'rules_a',
	'rules_b',
	'rules_c',
	'rules_d',
] as const;
export type SourceField = (typeof SOURCE_FIELDS)[number];

/** A character in one of the source fields */
export interface SourceRef {
	field: SourceField;
	index: number;
}

export interface GenerateResult {
	/** Flat xyz triples per kind */
	voxels: Record<NodeKind, Int32Array>;
	/** The seed actually used (randomly picked if the treedef has none) */
	seed: number;
	/** Iteration count after random_level was applied */
	iterations: number;
	expandedLength: number;
	nodeCount: number;
	bounds: { min: [number, number, number]; max: [number, number, number] };
	diagnostics: Diagnostic[];
}

type Vec3 = [number, number, number];

const DEFAULTS: Required<Omit<GenerateOptions, 'turnJitter'>> = {
	maxLength: 2_000_000,
	maxNodes: 400_000,
};

const RULE_CHANCE: Record<string, number> = { a: 90, b: 80, c: 70, d: 60 };

export function checkBrackets(source: string, label: string): Diagnostic[] {
	let depth = 0;
	for (let i = 0; i < source.length; i++) {
		if (source[i] === '[') depth++;
		else if (source[i] === ']') {
			depth--;
			if (depth < 0) {
				return [
					{
						level: 'error',
						message: `${label}: ']' at column ${i + 1} has no matching '['`,
					},
				];
			}
		}
	}
	return depth > 0
		? [{ level: 'warning', message: `${label}: ${depth} unclosed '['` }]
		: [];
}

const VALID = /^[GFfTRABCDabcd+\-&^/*[\]]*$/;

function checkSymbols(source: string, label: string): Diagnostic[] {
	if (VALID.test(source)) return [];
	const bad = [
		...new Set(source.replace(/[GFfTRABCDabcd+\-&^/*[\]]/g, '')),
	].join(' ');
	return [
		{
			level: 'warning',
			message: `${label}: unknown symbols are ignored: ${bad}`,
		},
	];
}

/**
 * Rewrites the axiom `iterations` times, and records where each symbol of the
 * result came from so the preview can link blocks back to the text.
 */
export interface Expansion {
	program: string;
	truncated: boolean;
	/** Per symbol: source field (index into SOURCE_FIELDS) and column */
	symField: Uint8Array;
	symIndex: Int32Array;
	/** Per symbol: the rule expansion it belongs to, or -1 if from the axiom */
	symInst: Int32Array;
	/** Per rule expansion: the rule letter that was expanded, and its parent */
	instField: Uint8Array;
	instIndex: Int32Array;
	instParent: Int32Array;
}

const RULE_FIELD: Record<string, number> = { A: 1, B: 2, C: 3, D: 4 };

export function expand(
	def: TreeDef,
	iterations: number,
	rng: Random,
	maxLength: number,
): Expansion {
	const rules: Record<string, string> = {
		A: def.rules_a,
		B: def.rules_b,
		C: def.rules_c,
		D: def.rules_d,
	};
	let current = def.axiom;
	let field: number[] = new Array(current.length).fill(0);
	let index: number[] = Array.from(current, (_, i) => i);
	let inst: number[] = new Array(current.length).fill(-1);
	const instField: number[] = [];
	const instIndex: number[] = [];
	const instParent: number[] = [];
	let truncated = false;

	for (let i = 0; i < iterations && !truncated; i++) {
		const parts: string[] = [];
		const nextField: number[] = [];
		const nextIndex: number[] = [];
		const nextInst: number[] = [];
		for (let k = 0; k < current.length; k++) {
			const ch = current[k];
			const upper = ch.toUpperCase();
			if (upper in rules) {
				const chance = RULE_CHANCE[ch];
				// In-game, a lowercase rule that fails its roll never expands in a
				// later iteration either, so drop it.
				if (chance === undefined || rng.chance(chance)) {
					const id = instField.length;
					instField.push(field[k]);
					instIndex.push(index[k]);
					instParent.push(inst[k]);
					const rule = rules[upper];
					parts.push(rule);
					for (let j = 0; j < rule.length; j++) {
						nextField.push(RULE_FIELD[upper]);
						nextIndex.push(j);
						nextInst.push(id);
					}
				}
			} else {
				parts.push(ch);
				nextField.push(field[k]);
				nextIndex.push(index[k]);
				nextInst.push(inst[k]);
			}
			if (nextField.length > maxLength) {
				truncated = true;
				break;
			}
		}
		if (truncated) break;
		current = parts.join('');
		field = nextField;
		index = nextIndex;
		inst = nextInst;
	}
	return {
		program: current,
		truncated,
		symField: Uint8Array.from(field),
		symIndex: Int32Array.from(index),
		symInst: Int32Array.from(inst),
		instField: Uint8Array.from(instField),
		instIndex: Int32Array.from(instIndex),
		instParent: Int32Array.from(instParent),
	};
}

/**
 * Turtle math is done in 32-bit floats: with common angles like 30° many
 * positions land on exactly .5, and the engine's output near those boundaries
 * matches f32 arithmetic much better than f64.
 */
const F = Math.fround;

/** Round half away from zero (JS Math.round rounds -2.5 to -2) */
const roundCoord = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

function rotate(v: Vec3, k: Vec3, cos: number, sin: number): Vec3 {
	// Rodrigues' rotation formula, k must be unit length
	const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
	const cx = k[1] * v[2] - k[2] * v[1];
	const cy = k[2] * v[0] - k[0] * v[2];
	const cz = k[0] * v[1] - k[1] * v[0];
	return [
		F(v[0] * cos + cx * sin + k[0] * dot * (1 - cos)),
		F(v[1] * cos + cy * sin + k[1] * dot * (1 - cos)),
		F(v[2] * cos + cz * sin + k[2] * dot * (1 - cos)),
	];
}

const FOOTPRINT: Record<TreeDef['trunk_type'], [number, number][]> = {
	single: [[0, 0]],
	double: [
		[0, 0],
		[1, 0],
		[0, 1],
		[1, 1],
	],
	crossed: [
		[0, 0],
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	],
};

type Axis = 'h' | 'l' | 'u';

/**
 * [rotation axis, the two turtle vectors that rotate, direction].
 * Directions were checked against the engine's output with test trees.
 */
const ROTATIONS: Record<string, [Axis, Axis, Axis, 1 | -1]> = {
	'+': ['u', 'h', 'l', 1], // yaw right
	'-': ['u', 'h', 'l', -1], // yaw left
	'&': ['l', 'h', 'u', 1], // pitch down
	'^': ['l', 'h', 'u', -1], // pitch up
	'/': ['h', 'l', 'u', -1], // roll right
	'*': ['h', 'l', 'u', 1], // roll left
};

/**
 * Leaves grown by each F inside a branch: a world-aligned pattern on the
 * layers above and below the node. Fill rates were measured in-game: inner
 * cells ~96%, outer ~80%, or every cell when fruit is enabled.
 */
const LEAF_CELLS: { dx: number; dy: number; dz: number; chance: number }[] = [];
for (const dy of [-1, 1])
	for (let dx = -2; dx <= 2; dx++)
		for (let dz = -2; dz <= 2; dz++) {
			const d = Math.abs(dx) + Math.abs(dz);
			if (d === 1) LEAF_CELLS.push({ dx, dy, dz, chance: 96 });
			else if (d === 3) LEAF_CELLS.push({ dx, dy, dz, chance: 80 });
		}

interface Turtle {
	pos: Vec3;
	h: Vec3; // heading
	l: Vec3; // left
	u: Vec3; // up
}

export function generate(
	def: TreeDef,
	options: GenerateOptions = {},
): GenerateResult {
	return generateTraced(def, options).result;
}

/** Like generate, but also returns a Trace linking blocks to source text */
export function generateTraced(
	def: TreeDef,
	options: GenerateOptions = {},
): { result: GenerateResult; trace: Trace } {
	const opts = { ...DEFAULTS, ...options };
	const diagnostics: Diagnostic[] = [];

	const sources: [string, string][] = [
		[def.axiom, 'axiom'],
		[def.rules_a, 'rules_a'],
		[def.rules_b, 'rules_b'],
		[def.rules_c, 'rules_c'],
		[def.rules_d, 'rules_d'],
	];
	for (const [src, label] of sources) {
		diagnostics.push(...checkBrackets(src, label), ...checkSymbols(src, label));
	}
	if (!def.axiom)
		diagnostics.push({ level: 'warning', message: 'axiom is empty' });
	if (!def.trunk)
		diagnostics.push({ level: 'warning', message: 'trunk node name is empty' });
	if (!def.leaves)
		diagnostics.push({
			level: 'warning',
			message: 'leaves node name is empty',
		});

	const seed = def.seed ?? randomSeed();
	const rng = new Random(seed);

	const baseIterations = Math.max(
		2,
		Math.min(32767, Math.trunc(def.iterations)),
	);
	const randomLevel = Math.max(
		0,
		Math.min(32767, Math.trunc(def.random_level)),
	);
	const iterations = Math.max(2, baseIterations - rng.range(0, randomLevel));

	const expansion = expand(def, iterations, rng, opts.maxLength);
	const { program, truncated } = expansion;
	if (truncated) {
		diagnostics.push({
			level: 'warning',
			message: `Expanded string exceeded ${opts.maxLength.toLocaleString()} symbols; stopped expanding early`,
		});
	}

	/** Voxel key -> [kind, index of the symbol that placed it] */
	const grid = new Map<string, [NodeKind, number]>();
	let nodeLimitHit = false;
	let sym = 0;

	const place = (x: number, y: number, z: number, kind: NodeKind) => {
		const key = `${x},${y},${z}`;
		const existing = grid.get(key);
		if (existing === undefined) {
			if (grid.size >= opts.maxNodes) {
				nodeLimitHit = true;
				return;
			}
			grid.set(key, [kind, sym]);
		} else if (existing[0] !== 'trunk' || kind === 'trunk') {
			// Measured in-game: later leaves/fruit replace earlier ones, but
			// nothing replaces trunk.
			grid.set(key, [kind, sym]);
		}
	};

	const leafKind = (): NodeKind | null => {
		if (def.leaves2 && rng.chance(def.leaves2_chance)) return 'leaves2';
		return def.leaves ? 'leaves' : null;
	};
	const hasFruit = Boolean(def.fruit) && def.fruit_chance > 0;

	// Measured in-game: every turn in a tree is either exactly `angle` or
	// `angle` + 1°, chosen once per tree.
	const jitter = opts.turnJitter ? opts.turnJitter(rng) : rng.range(0, 1);

	let t: Turtle = { pos: [0, 0, 0], h: [0, 1, 0], l: [-1, 0, 0], u: [0, 0, 1] };
	const stack: Turtle[] = [];

	for (let i = 0; i < program.length && !nodeLimitHit; i++) {
		const ch = program[i];
		sym = i;
		const x = roundCoord(t.pos[0]);
		const y = roundCoord(t.pos[1]);
		const z = roundCoord(t.pos[2]);
		let move = false;

		switch (ch) {
			case 'G':
				move = true;
				break;
			case 'F':
			case 'T': {
				const isBranch = stack.length > 0;
				// Measured in-game: with thin_branches, T is always 1 node (even on
				// the main trunk) and so is F inside brackets; F outside keeps the
				// trunk_type footprint.
				const thin = def.thin_branches && (ch === 'T' || isBranch);
				const footprint = thin ? FOOTPRINT.single : FOOTPRINT[def.trunk_type];
				for (const [dx, dz] of footprint) place(x + dx, y, z + dz, 'trunk');
				if (ch === 'F' && isBranch) {
					for (const { dx, dy, dz, chance } of LEAF_CELLS) {
						let kind: NodeKind | null;
						if (hasFruit) {
							kind = rng.chance(def.fruit_chance) ? 'fruit' : leafKind();
						} else {
							kind = rng.chance(chance) ? leafKind() : null;
						}
						if (kind) place(x + dx, y + dy, z + dz, kind);
					}
				}
				move = true;
				break;
			}
			case 'f': {
				const kind = leafKind();
				if (kind) place(x, y, z, kind);
				move = true;
				break;
			}
			case 'R':
				if (def.fruit) place(x, y, z, 'fruit');
				move = true;
				break;
			case '+':
			case '-':
			case '&':
			case '^':
			case '/':
			case '*': {
				const [axis, a, b, sign] = ROTATIONS[ch];
				const deg = sign * (def.angle + jitter);
				const angle = (deg * Math.PI) / 180;
				const cos = F(Math.cos(F(angle)));
				const s = F(Math.sin(F(angle)));
				t = {
					...t,
					[a]: rotate(t[a], t[axis], cos, s),
					[b]: rotate(t[b], t[axis], cos, s),
				};
				break;
			}
			case '[':
				stack.push(t);
				break;
			case ']': {
				const popped = stack.pop();
				if (!popped) {
					// Already reported by checkBrackets; stop like a parse error would.
					i = program.length;
					break;
				}
				t = popped;
				break;
			}
		}

		if (move) {
			t = {
				...t,
				pos: [F(t.pos[0] + t.h[0]), F(t.pos[1] + t.h[1]), F(t.pos[2] + t.h[2])],
			};
		}
	}

	if (nodeLimitHit) {
		diagnostics.push({
			level: 'warning',
			message: `Stopped drawing at ${opts.maxNodes.toLocaleString()} nodes`,
		});
	}

	const buckets: Record<NodeKind, number[]> = {
		trunk: [],
		leaves: [],
		leaves2: [],
		fruit: [],
	};
	const symbols: Record<NodeKind, number[]> = {
		trunk: [],
		leaves: [],
		leaves2: [],
		fruit: [],
	};
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const [key, [kind, placedBy]] of grid) {
		const p = key.split(',').map(Number) as Vec3;
		buckets[kind].push(p[0], p[1], p[2]);
		symbols[kind].push(placedBy);
		for (let a = 0; a < 3; a++) {
			if (p[a] < min[a]) min[a] = p[a];
			if (p[a] > max[a]) max[a] = p[a];
		}
	}
	if (grid.size === 0) {
		min.fill(0);
		max.fill(0);
	}

	const result: GenerateResult = {
		voxels: {
			trunk: Int32Array.from(buckets.trunk),
			leaves: Int32Array.from(buckets.leaves),
			leaves2: Int32Array.from(buckets.leaves2),
			fruit: Int32Array.from(buckets.fruit),
		},
		seed,
		iterations,
		expandedLength: program.length,
		nodeCount: grid.size,
		bounds: { min, max },
		diagnostics,
	};
	const voxelSymbols = Object.fromEntries(
		NODE_KINDS.map((k) => [k, Int32Array.from(symbols[k])]),
	) as Record<NodeKind, Int32Array>;
	return { result, trace: new Trace(expansion, voxelSymbols) };
}

export interface PickInfo {
	/** The symbol that placed the block */
	symbol: string;
	/** Where that symbol is in the text, then the rule letters it came through */
	chain: SourceRef[];
}

/** Links the blocks of a generated tree back to the source text */
export class Trace {
	constructor(
		private readonly exp: Expansion,
		private readonly voxelSymbols: Record<NodeKind, Int32Array>,
	) {}

	blocksFrom(
		field: SourceField,
		from: number,
		to: number,
	): Record<NodeKind, Int32Array> {
		const f = SOURCE_FIELDS.indexOf(field);
		const { symField, symIndex, symInst, instField, instIndex, instParent } =
			this.exp;
		const inRange = (fi: number, ix: number) =>
			fi === f && ix >= from && ix < to;
		// Parents are always created before their children
		const instMatch = new Uint8Array(instField.length);
		for (let i = 0; i < instField.length; i++) {
			const parent = instParent[i];
			instMatch[i] =
				inRange(instField[i], instIndex[i]) ||
				(parent >= 0 && instMatch[parent])
					? 1
					: 0;
		}
		const symMatch = (s: number) =>
			inRange(symField[s], symIndex[s]) ||
			(symInst[s] >= 0 && instMatch[symInst[s]] === 1);

		const out = {} as Record<NodeKind, Int32Array>;
		for (const kind of NODE_KINDS) {
			const syms = this.voxelSymbols[kind];
			const hits: number[] = [];
			for (let v = 0; v < syms.length; v++) if (symMatch(syms[v])) hits.push(v);
			out[kind] = Int32Array.from(hits);
		}
		return out;
	}

	/** Where the block at `index` of `kind`'s voxel list came from */
	pick(kind: NodeKind, index: number): PickInfo | null {
		const s = this.voxelSymbols[kind][index];
		if (s === undefined) return null;
		const { symField, symIndex, symInst, instField, instIndex, instParent } =
			this.exp;
		const chain: SourceRef[] = [
			{ field: SOURCE_FIELDS[symField[s]], index: symIndex[s] },
		];
		for (let i = symInst[s]; i >= 0; i = instParent[i]) {
			chain.push({ field: SOURCE_FIELDS[instField[i]], index: instIndex[i] });
		}
		return { symbol: this.exp.program[s], chain };
	}
}
