export type TrunkType = 'single' | 'double' | 'crossed';

export interface TreeDef {
	axiom: string;
	rules_a: string;
	rules_b: string;
	rules_c: string;
	rules_d: string;
	trunk: string;
	leaves: string;
	leaves2: string;
	/** 0–100: chance to replace leaves with leaves2 */
	leaves2_chance: number;
	/** degrees */
	angle: number;
	/** 2–32767, usually 2–5 */
	iterations: number;
	/** 0–32767, usually 0–3 */
	random_level: number;
	trunk_type: TrunkType;
	thin_branches: boolean;
	fruit: string;
	/** 0–100: chance to replace leaves with fruit */
	fruit_chance: number;
	/** undefined → a random seed is picked */
	seed?: number;
}

export const TRUNK_TYPES: readonly TrunkType[] = [
	'single',
	'double',
	'crossed',
];

export const DEFAULT_TREEDEF: TreeDef = {
	axiom: '',
	rules_a: '',
	rules_b: '',
	rules_c: '',
	rules_d: '',
	trunk: 'default:tree',
	leaves: 'default:leaves',
	leaves2: '',
	leaves2_chance: 0,
	angle: 30,
	iterations: 2,
	random_level: 0,
	trunk_type: 'single',
	thin_branches: false,
	fruit: '',
	fruit_chance: 0,
	seed: undefined,
};
