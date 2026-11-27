import type { TreeDef, TrunkType } from './treedef';

export type ParamValue = number | string | boolean;
export type ParamValues = Record<string, ParamValue>;

interface BaseParam {
	key: string;
	label: string;
	help?: string;
}
export interface RangeParam extends BaseParam {
	type: 'range';
	min: number;
	max: number;
	step: number;
	default: number;
	unit?: string;
}
export interface SelectParam extends BaseParam {
	type: 'select';
	options: { value: string; label: string }[];
	default: string;
}
export interface ToggleParam extends BaseParam {
	type: 'toggle';
	default: boolean;
}
export type Param = RangeParam | SelectParam | ToggleParam;

/** The treedef fields a template controls; node names stay with the user */
export type BuiltFields = Pick<
	TreeDef,
	| 'axiom'
	| 'rules_a'
	| 'rules_b'
	| 'rules_c'
	| 'rules_d'
	| 'angle'
	| 'iterations'
	| 'random_level'
	| 'trunk_type'
	| 'thin_branches'
>;

export interface BuildOutput {
	fields: BuiltFields;
	/** Hints to show next to the builder (e.g. a node name that's needed) */
	notes: string[];
}

export interface Template {
	id: string;
	name: string;
	description: string;
	params: Param[];
	build(values: ParamValues): BuildOutput;
}

/** All turns are multiples of this, so templates can mix angles */
const STEP = 15;

/** Repeat a turn symbol to approximate `degrees` */
function turn(symbol: string, degrees: number): string {
	return symbol.repeat(Math.max(0, Math.round(degrees / STEP)));
}

function around(count: number, body: string, offset = 0): string {
	let out = '[';
	let rolled = 0;
	for (let i = 0; i < count; i++) {
		const target = Math.round((offset + (i * 360) / count) / STEP);
		out += '/'.repeat(Math.max(0, target - rolled));
		rolled = Math.max(rolled, target);
		out += `[${body}]`;
	}
	return `${out}]`;
}

const EMPTY_RULES = { rules_a: '', rules_b: '', rules_c: '', rules_d: '' };

const trunkParam: SelectParam = {
	key: 'trunk',
	label: 'Trunk thickness',
	type: 'select',
	options: [
		{ value: 'single', label: '1 node' },
		{ value: 'double', label: '2×2' },
		{ value: 'crossed', label: 'Cross (3 wide)' },
	],
	default: 'single',
};

const gapsParam: SelectParam = {
	key: 'gaps',
	label: 'Missing branches',
	help: 'Leave out some branches at random, so trees differ.',
	type: 'select',
	options: [
		{ value: 'none', label: 'None' },
		{ value: 'few', label: 'A few (10%)' },
		{ value: 'some', label: 'Some (30%)' },
	],
	default: 'none',
};

function ruleFor(gaps: ParamValue, body: string) {
	if (gaps === 'some')
		return { letter: 'c', rules: { ...EMPTY_RULES, rules_c: body } };
	const letter = gaps === 'few' ? 'a' : 'A';
	return { letter, rules: { ...EMPTY_RULES, rules_a: body } };
}

const num = (v: ParamValue) => Number(v);

export const TEMPLATES: Template[] = [
	{
		id: 'broadleaf',
		name: 'Broadleaf',
		description:
			'A trunk with layers of leafy branches, like an oak or apple tree.',
		params: [
			{
				key: 'height',
				label: 'Trunk height',
				type: 'range',
				min: 1,
				max: 16,
				step: 1,
				default: 5,
				unit: 'nodes',
			},
			trunkParam,
			{
				key: 'layers',
				label: 'Branch layers',
				type: 'range',
				min: 1,
				max: 5,
				step: 1,
				default: 2,
			},
			{
				key: 'spacing',
				label: 'Gap between layers',
				type: 'range',
				min: 1,
				max: 5,
				step: 1,
				default: 2,
				unit: 'nodes',
			},
			{
				key: 'branches',
				label: 'Branches per layer',
				type: 'range',
				min: 1,
				max: 8,
				step: 1,
				default: 4,
			},
			{
				key: 'length',
				label: 'Branch length',
				type: 'range',
				min: 1,
				max: 10,
				step: 1,
				default: 4,
				unit: 'nodes',
			},
			{
				key: 'spread',
				label: 'Branch angle',
				help: 'From straight up (0°) to sideways (90°).',
				type: 'range',
				min: 15,
				max: 90,
				step: 15,
				default: 45,
				unit: '°',
			},
			{
				key: 'droop',
				label: 'Droop',
				help: 'How much the outer half of each branch bends down.',
				type: 'range',
				min: 0,
				max: 90,
				step: 15,
				default: 30,
				unit: '°',
			},
			{
				key: 'forks',
				label: 'Forked branch tips',
				type: 'toggle',
				default: false,
			},
			{
				key: 'top',
				label: 'Top shoot',
				type: 'range',
				min: 0,
				max: 6,
				step: 1,
				default: 2,
				unit: 'nodes',
			},
			gapsParam,
		],
		build(v) {
			const length = num(v.length);
			const inner = Math.ceil(length / 2);
			let branch =
				turn('&', num(v.spread)) +
				'F'.repeat(inner) +
				turn('&', num(v.droop)) +
				'F'.repeat(length - inner);
			if (v.forks) branch += `[${turn('+', 30)}FF][${turn('-', 30)}FF]`;
			const { letter, rules } = ruleFor(v.gaps, branch);

			const layers = num(v.layers);
			const branches = num(v.branches);
			let axiom = 'F'.repeat(num(v.height));
			for (let i = 0; i < layers; i++) {
				// Alternate layers are turned half a step so branches don't stack
				axiom += around(branches, letter, (i % 2) * (180 / branches));
				if (i < layers - 1) axiom += 'F'.repeat(num(v.spacing));
			}
			if (num(v.top) > 0) axiom += `[${'F'.repeat(num(v.top))}]`;

			return {
				fields: {
					axiom,
					...rules,
					angle: STEP,
					iterations: 2,
					random_level: 0,
					trunk_type: v.trunk as TrunkType,
					thin_branches: true,
				},
				notes: [],
			};
		},
	},
	{
		id: 'conifer',
		name: 'Conifer',
		description:
			'Tiers of branches that get shorter towards the top, like a pine or fir.',
		params: [
			{
				key: 'height',
				label: 'Bare trunk',
				type: 'range',
				min: 0,
				max: 10,
				step: 1,
				default: 2,
				unit: 'nodes',
			},
			trunkParam,
			{
				key: 'tiers',
				label: 'Tiers',
				type: 'range',
				min: 1,
				max: 12,
				step: 1,
				default: 5,
			},
			{
				key: 'spacing',
				label: 'Gap between tiers',
				type: 'range',
				min: 1,
				max: 4,
				step: 1,
				default: 2,
				unit: 'nodes',
			},
			{
				key: 'branches',
				label: 'Branches per tier',
				type: 'range',
				min: 2,
				max: 8,
				step: 1,
				default: 4,
			},
			{
				key: 'bottom',
				label: 'Bottom branch length',
				type: 'range',
				min: 1,
				max: 10,
				step: 1,
				default: 5,
				unit: 'nodes',
			},
			{
				key: 'topLength',
				label: 'Top branch length',
				type: 'range',
				min: 1,
				max: 10,
				step: 1,
				default: 1,
				unit: 'nodes',
			},
			{
				key: 'angle',
				label: 'Branch angle',
				help: 'From straight up (0°) through sideways (90°) to drooping.',
				type: 'range',
				min: 45,
				max: 135,
				step: 15,
				default: 90,
				unit: '°',
			},
			{
				key: 'needles',
				label: 'Needles',
				type: 'select',
				options: [
					{ value: 'thin', label: 'Thin (one row of leaves)' },
					{ value: 'full', label: 'Full (leaf clusters)' },
				],
				default: 'thin',
			},
			{
				key: 'spike',
				label: 'Top spike',
				type: 'range',
				min: 0,
				max: 6,
				step: 1,
				default: 2,
				unit: 'nodes',
			},
		],
		build(v) {
			const tiers = num(v.tiers);
			const branches = num(v.branches);
			const leaf = v.needles === 'full' ? 'F' : 'f';
			let axiom = 'F'.repeat(num(v.height));
			for (let i = 0; i < tiers; i++) {
				const t = tiers > 1 ? i / (tiers - 1) : 0;
				const length = Math.max(
					1,
					Math.round(num(v.bottom) + (num(v.topLength) - num(v.bottom)) * t),
				);
				const branch = turn('&', num(v.angle)) + leaf.repeat(length);
				axiom += `F${around(branches, branch, (i % 2) * (180 / branches))}`;
				if (i < tiers - 1) axiom += 'F'.repeat(Math.max(0, num(v.spacing) - 1));
			}
			axiom += 'f'.repeat(num(v.spike));
			return {
				fields: {
					axiom,
					...EMPTY_RULES,
					angle: STEP,
					iterations: 2,
					random_level: 0,
					trunk_type: v.trunk as TrunkType,
					thin_branches: true,
				},
				notes: [],
			};
		},
	},
	{
		id: 'branching',
		name: 'Branching',
		description:
			'Grows by splitting again and again, with each level shorter than the last. Covers many shapes: acacia, birch, shrubs and more.',
		params: [
			{
				key: 'height',
				label: 'Trunk height',
				type: 'range',
				min: 0,
				max: 12,
				step: 1,
				default: 4,
				unit: 'nodes',
			},
			trunkParam,
			{
				key: 'levels',
				label: 'Levels of splitting',
				help: 'How many times branches split. Each level adds a lot of branches.',
				type: 'range',
				min: 1,
				max: 4,
				step: 1,
				default: 3,
			},
			{
				key: 'splits',
				label: 'Branches per split',
				type: 'range',
				min: 2,
				max: 5,
				step: 1,
				default: 3,
			},
			{
				key: 'angle',
				label: 'Split angle',
				help: 'How far each new branch leans away from its parent.',
				type: 'range',
				min: 15,
				max: 90,
				step: 15,
				default: 30,
				unit: '°',
			},
			{
				key: 'length',
				label: 'First branch length',
				type: 'range',
				min: 1,
				max: 8,
				step: 1,
				default: 4,
				unit: 'nodes',
			},
			{
				key: 'shrink',
				label: 'Length at each new level',
				help: 'Compared with the level before.',
				type: 'range',
				min: 40,
				max: 100,
				step: 10,
				default: 70,
				unit: '%',
			},
			{
				key: 'twist',
				label: 'Twist between levels',
				help: 'Turns each level around so branches don’t line up.',
				type: 'range',
				min: 0,
				max: 90,
				step: 15,
				default: 45,
				unit: '°',
			},
			{
				key: 'leader',
				label: 'Keep a central stem growing up',
				type: 'toggle',
				default: false,
			},
			{
				key: 'leaves',
				label: 'Leaves',
				type: 'select',
				options: [
					{ value: 'tips', label: 'On the outer branches' },
					{ value: 'all', label: 'On every branch' },
					{ value: 'none', label: 'None (bare)' },
				],
				default: 'tips',
			},
			{
				key: 'gaps',
				label: 'Missing branches',
				help: 'Leave out some branches at random, more often towards the tips.',
				type: 'toggle',
				default: false,
			},
			{
				key: 'vary',
				label: 'Vary the size between trees',
				help: 'Some trees get one level fewer.',
				type: 'toggle',
				default: false,
			},
		],
		build(v) {
			const levels = num(v.levels);
			const splits = num(v.splits);
			const letters = 'ABCD';
			const rules = { ...EMPTY_RULES };
			// One rules set per level (A, B, C, D), so each level can be shorter.
			// Each expands into a segment plus `splits` branches of the next level.
			for (let k = 0; k < levels; k++) {
				const length = Math.max(
					1,
					Math.round(num(v.length) * (num(v.shrink) / 100) ** k),
				);
				const last = k === levels - 1;
				// Level 1 sits outside any brackets, where F draws trunk without
				// leaves. Deeper levels are inside brackets, where F grows leaves
				// and T draws bare wood.
				const leafy = v.leaves === 'all' || (v.leaves === 'tips' && last);
				const segment = (k === 0 || leafy ? 'F' : 'T').repeat(length);
				let rule = turn('/', num(v.twist)) + segment;
				if (!last) {
					const next = v.gaps ? letters[k + 1].toLowerCase() : letters[k + 1];
					rule += around(splits, turn('&', num(v.angle)) + next);
					if (v.leader) rule += next;
				}
				rules[`rules_${letters[k].toLowerCase()}` as keyof typeof EMPTY_RULES] =
					rule;
			}
			return {
				fields: {
					axiom: `${'F'.repeat(num(v.height))}A`,
					...rules,
					angle: STEP,
					// Each iteration grows one level
					iterations: Math.max(2, levels),
					random_level: v.vary ? 1 : 0,
					trunk_type: v.trunk as TrunkType,
					thin_branches: true,
				},
				notes:
					levels === 1 && v.leaves !== 'none'
						? [
								'With one level there are no side branches, and the trunk never has leaves.',
							]
						: [],
			};
		},
	},
	{
		id: 'dead',
		name: 'Dead tree',
		description: 'A bare, crooked tree with no leaves.',
		params: [
			{
				key: 'height',
				label: 'Trunk height',
				type: 'range',
				min: 2,
				max: 16,
				step: 1,
				default: 6,
				unit: 'nodes',
			},
			trunkParam,
			{
				key: 'layers',
				label: 'Branch layers',
				type: 'range',
				min: 1,
				max: 4,
				step: 1,
				default: 2,
			},
			{
				key: 'spacing',
				label: 'Gap between layers',
				type: 'range',
				min: 1,
				max: 5,
				step: 1,
				default: 2,
				unit: 'nodes',
			},
			{
				key: 'branches',
				label: 'Branches per layer',
				type: 'range',
				min: 1,
				max: 6,
				step: 1,
				default: 3,
			},
			{
				key: 'length',
				label: 'Branch length',
				type: 'range',
				min: 2,
				max: 10,
				step: 1,
				default: 5,
				unit: 'nodes',
			},
			{
				key: 'angle',
				label: 'Branch angle',
				help: 'From straight up (0°) to sideways (90°).',
				type: 'range',
				min: 15,
				max: 90,
				step: 15,
				default: 45,
				unit: '°',
			},
			{
				key: 'crooked',
				label: 'Crookedness',
				help: 'How much branches zig-zag.',
				type: 'range',
				min: 0,
				max: 45,
				step: 15,
				default: 30,
				unit: '°',
			},
			{ key: 'twigs', label: 'Side twigs', type: 'toggle', default: true },
			{
				key: 'stub',
				label: 'Broken top',
				help: 'Length of trunk left above the top branches.',
				type: 'range',
				min: 0,
				max: 4,
				step: 1,
				default: 1,
				unit: 'nodes',
			},
			gapsParam,
		],
		build(v) {
			const length = num(v.length);
			const zig = turn('+', num(v.crooked));
			const zag = turn('-', num(v.crooked));
			// T draws bare wood (F inside brackets would grow leaves)
			let branch = turn('&', num(v.angle));
			for (let i = 0; i < length; i++) {
				branch += 'T';
				if (v.twigs && i === Math.floor(length / 2))
					branch += `[${turn('^', 45)}TT]`;
				if (i < length - 1) branch += i % 2 === 0 ? zig : zag;
			}
			const { letter, rules } = ruleFor(v.gaps, branch);

			const layers = num(v.layers);
			const branches = num(v.branches);
			let axiom = 'F'.repeat(num(v.height));
			for (let i = 0; i < layers; i++) {
				axiom += around(branches, letter, (i % 2) * (180 / branches));
				if (i < layers - 1) axiom += 'F'.repeat(num(v.spacing));
			}
			axiom += 'F'.repeat(num(v.stub));
			return {
				fields: {
					axiom,
					...rules,
					angle: STEP,
					iterations: 2,
					random_level: 0,
					trunk_type: v.trunk as TrunkType,
					thin_branches: true,
				},
				notes: [],
			};
		},
	},
	{
		id: 'bush',
		name: 'Bush',
		description:
			'Short leafy stems spreading out from the ground, with no trunk.',
		params: [
			{
				key: 'stems',
				label: 'Stems',
				type: 'range',
				min: 1,
				max: 12,
				step: 1,
				default: 5,
			},
			{
				key: 'length',
				label: 'Stem length',
				type: 'range',
				min: 1,
				max: 6,
				step: 1,
				default: 2,
				unit: 'nodes',
			},
			{
				key: 'spread',
				label: 'Spread',
				help: 'From straight up (0°) to flat (90°).',
				type: 'range',
				min: 0,
				max: 90,
				step: 15,
				default: 45,
				unit: '°',
			},
			{
				key: 'centre',
				label: 'Centre stem',
				type: 'range',
				min: 0,
				max: 6,
				step: 1,
				default: 1,
				unit: 'nodes',
			},
			gapsParam,
		],
		build(v) {
			const stem = turn('&', num(v.spread)) + 'F'.repeat(num(v.length));
			const { letter, rules } = ruleFor(v.gaps, stem);
			let axiom = around(num(v.stems), letter);
			if (num(v.centre) > 0) axiom += `[${'F'.repeat(num(v.centre))}]`;
			return {
				fields: {
					axiom,
					...rules,
					angle: STEP,
					iterations: 2,
					random_level: 0,
					trunk_type: 'single',
					thin_branches: true,
				},
				notes: [],
			};
		},
	},
];

export function getTemplate(id: string): Template {
	return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

export function defaultValues(template: Template): ParamValues {
	return Object.fromEntries(template.params.map((p) => [p.key, p.default]));
}

/** Fill in missing or invalid values (e.g. from an old share link) */
export function normalizeValues(
	template: Template,
	values: ParamValues,
): ParamValues {
	const out = defaultValues(template);
	for (const p of template.params) {
		const v = values[p.key];
		if (p.type === 'range' && typeof v === 'number' && Number.isFinite(v)) {
			out[p.key] = Math.min(p.max, Math.max(p.min, v));
		} else if (p.type === 'select' && p.options.some((o) => o.value === v)) {
			out[p.key] = v as string;
		} else if (p.type === 'toggle' && typeof v === 'boolean') {
			out[p.key] = v;
		}
	}
	return out;
}
