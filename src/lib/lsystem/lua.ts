import {
	DEFAULT_TREEDEF,
	TRUNK_TYPES,
	type TreeDef,
	type TrunkType,
} from './treedef';

const FIELD_ORDER: (keyof TreeDef)[] = [
	'axiom',
	'rules_a',
	'rules_b',
	'rules_c',
	'rules_d',
	'trunk',
	'leaves',
	'leaves2',
	'leaves2_chance',
	'angle',
	'iterations',
	'random_level',
	'trunk_type',
	'thin_branches',
	'fruit',
	'fruit_chance',
	'seed',
];

const STRING_FIELDS = new Set<keyof TreeDef>([
	'axiom',
	'rules_a',
	'rules_b',
	'rules_c',
	'rules_d',
	'trunk',
	'leaves',
	'leaves2',
	'trunk_type',
	'fruit',
]);

function luaString(s: string): string {
	return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/** Serialize as a Lua table, skipping empty/irrelevant optional fields */
export function toLuaTable(def: TreeDef, indent = '\t'): string {
	const lines: string[] = [];
	for (const key of FIELD_ORDER) {
		const value = def[key];
		if (value === undefined || value === '') continue;
		if (key === 'leaves2_chance' && !def.leaves2) continue;
		if (key === 'fruit_chance' && !def.fruit) continue;
		const lua = typeof value === 'string' ? luaString(value) : String(value);
		lines.push(`${indent}${key} = ${lua},`);
	}
	return `{\n${lines.join('\n')}\n${indent.slice(1)}}`;
}

export function toSpawnTreeSnippet(def: TreeDef): string {
	return `local treedef = ${toLuaTable(def)}\n\ncore.spawn_tree(pos, treedef)\n`;
}

export function toDecorationSnippet(def: TreeDef): string {
	return `core.register_decoration({
	deco_type = "lsystem",
	place_on = {"default:dirt_with_grass"},
	sidelen = 16,
	fill_ratio = 0.002,
	treedef = ${toLuaTable(def, '\t\t')},
})
`;
}

export function parseLuaTreedef(source: string): {
	def: TreeDef;
	ignored: string[];
} {
	const def: TreeDef = { ...DEFAULT_TREEDEF, seed: undefined };
	const ignored: string[] = [];
	const known = new Set<string>(FIELD_ORDER);
	const pattern =
		/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[(=*)\[[\s\S]*?\]\3\]|-?\d+(?:\.\d+)?|true|false)/g;

	for (const match of source.matchAll(pattern)) {
		const key = match[1] as keyof TreeDef;
		const raw = match[2];
		if (!known.has(key)) {
			ignored.push(key);
			continue;
		}
		let value: string | number | boolean;
		if (raw.startsWith('[')) {
			// Long string: [[...]] or [==[...]==], where the first newline is skipped
			const level = match[3].length + 2;
			value = raw.slice(level, -level).replace(/^\r?\n/, '');
		} else if (raw.startsWith('"') || raw.startsWith("'"))
			value = raw
				.slice(1, -1)
				.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c));
		else if (raw === 'true' || raw === 'false') value = raw === 'true';
		else value = Number(raw);

		if (STRING_FIELDS.has(key)) {
			if (typeof value !== 'string') continue;
			if (key === 'trunk_type') {
				if (TRUNK_TYPES.includes(value as TrunkType))
					def.trunk_type = value as TrunkType;
			} else {
				(def as unknown as Record<string, unknown>)[key] = value;
			}
		} else if (key === 'thin_branches') {
			def.thin_branches = value === true;
		} else if (typeof value === 'number') {
			(def as unknown as Record<string, unknown>)[key] = Math.trunc(value);
		}
	}
	return { def, ignored: [...new Set(ignored)] };
}
