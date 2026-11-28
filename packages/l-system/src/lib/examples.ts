import type { ParamValues } from './builder';
import { DEFAULT_TREEDEF, type TreeDef } from './treedef';

export type NodeFields = Pick<
	TreeDef,
	'trunk' | 'leaves' | 'leaves2' | 'leaves2_chance' | 'fruit' | 'fruit_chance'
>;

export type Example = { name: string; nodes: NodeFields } & (
	| { template: string; values: ParamValues }
	| { def: TreeDef }
);

const nodes = (
	trunk: string,
	leaves: string,
	extra: Partial<NodeFields> = {},
): NodeFields => ({
	trunk,
	leaves,
	leaves2: '',
	leaves2_chance: 0,
	fruit: '',
	fruit_chance: 0,
	...extra,
});

export const EXAMPLES: Example[] = [
	{
		name: 'Apple tree',
		template: 'broadleaf',
		values: {
			height: 4,
			layers: 2,
			spacing: 1,
			branches: 5,
			length: 4,
			spread: 60,
			droop: 30,
			top: 2,
		},
		nodes: nodes('default:tree', 'default:leaves', {
			fruit: 'default:apple',
			fruit_chance: 8,
		}),
	},
	{
		name: 'Big oak',
		template: 'broadleaf',
		values: {
			height: 6,
			trunk: 'double',
			layers: 3,
			spacing: 2,
			branches: 6,
			length: 6,
			spread: 60,
			droop: 15,
			forks: true,
			top: 3,
			gaps: 'few',
		},
		nodes: nodes('default:tree', 'default:leaves'),
	},
	{
		name: 'Jungle giant',
		template: 'broadleaf',
		values: {
			height: 12,
			trunk: 'crossed',
			layers: 2,
			spacing: 2,
			branches: 6,
			length: 7,
			spread: 75,
			droop: 15,
			top: 2,
		},
		nodes: nodes('default:jungletree', 'default:jungleleaves'),
	},
	{
		name: 'Pine',
		template: 'conifer',
		values: {
			height: 3,
			tiers: 6,
			spacing: 2,
			branches: 5,
			bottom: 5,
			topLength: 1,
			angle: 105,
			spike: 2,
		},
		nodes: nodes('default:pine_tree', 'default:pine_needles'),
	},
	{
		name: 'Aspen',
		template: 'branching',
		values: {
			height: 5,
			levels: 4,
			splits: 2,
			angle: 30,
			length: 3,
			shrink: 80,
			twist: 90,
			leader: true,
			leaves: 'tips',
		},
		nodes: nodes('default:aspen_tree', 'default:aspen_leaves'),
	},
	{
		name: 'Acacia',
		template: 'branching',
		values: {
			height: 4,
			levels: 3,
			splits: 2,
			angle: 60,
			length: 3,
			shrink: 90,
			twist: 90,
			leaves: 'tips',
		},
		nodes: nodes('default:acacia_tree', 'default:acacia_leaves'),
	},
	{
		name: 'Dead tree',
		template: 'dead',
		values: {},
		nodes: nodes('default:tree', 'default:leaves'),
	},
	{
		name: 'Blueberry bush',
		template: 'bush',
		values: { stems: 6, length: 1, spread: 60, centre: 1 },
		nodes: nodes('default:bush_stem', 'default:blueberry_bush_leaves', {
			fruit: 'default:blueberry_bush_leaves_with_berries',
			fruit_chance: 25,
		}),
	},
	{
		name: 'Apple tree',
		def: {
			...DEFAULT_TREEDEF,
			axiom: 'FFFFFAFFBF',
			rules_a: '[&&&FFFFF&&FFFF][&&&++++FFFFF&&FFFF][&&&----FFFFF&&FFFF]',
			rules_b: '[&&&++FFFFF&&FFFF][&&&--FFFFF&&FFFF][&&&------FFFFF&&FFFF]',
			angle: 30,
			iterations: 2,
			random_level: 0,
			trunk_type: 'single',
			thin_branches: true,
		},
		nodes: nodes('default:tree', 'default:leaves', {
			fruit: 'default:apple',
			fruit_chance: 10,
		}),
	},
];
