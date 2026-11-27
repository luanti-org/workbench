import { describe, expect, it } from 'vitest';
import {
	parseLuaTreedef,
	toDecorationSnippet,
	toLuaTable,
	toSpawnTreeSnippet,
} from './lua';
import { DEFAULT_TREEDEF, type TreeDef } from './treedef';

const apple: TreeDef = {
	...DEFAULT_TREEDEF,
	axiom: 'FFFFFAFFBF',
	rules_a: '[&&&FFFFF&&FFFF][&&&++++FFFFF&&FFFF]',
	rules_b: '[&&&++FFFFF&&FFFF]',
	trunk: 'default:tree',
	leaves: 'default:leaves',
	angle: 30,
	iterations: 2,
	random_level: 0,
	trunk_type: 'single',
	thin_branches: true,
	fruit: 'default:apple',
	fruit_chance: 10,
};

describe('toLuaTable', () => {
	it('writes fields in the documented order', () => {
		const lua = toLuaTable(apple);
		const keys = [...lua.matchAll(/^\s*(\w+) =/gm)].map((m) => m[1]);
		expect(keys).toEqual([
			'axiom',
			'rules_a',
			'rules_b',
			'trunk',
			'leaves',
			'angle',
			'iterations',
			'random_level',
			'trunk_type',
			'thin_branches',
			'fruit',
			'fruit_chance',
		]);
	});

	it('leaves out empty strings, unused chances and a missing seed', () => {
		const lua = toLuaTable(apple);
		expect(lua).not.toMatch(/rules_c|rules_d|leaves2|seed/);
		const noFruit = toLuaTable({ ...apple, fruit: '' });
		expect(noFruit).not.toContain('fruit_chance');
	});

	it('includes the seed when set', () => {
		expect(toLuaTable({ ...apple, seed: -5 })).toContain('seed = -5,');
	});

	it('escapes quotes, backslashes and newlines', () => {
		expect(toLuaTable({ ...apple, trunk: 'a"b\\c\nd' })).toContain(
			'trunk = "a\\"b\\\\c\\nd",',
		);
	});
});

describe('snippets', () => {
	it('spawn_tree snippet defines the table and calls core.spawn_tree', () => {
		const lua = toSpawnTreeSnippet(apple);
		expect(lua).toMatch(/^local treedef = \{/);
		expect(lua).toContain('core.spawn_tree(pos, treedef)');
	});

	it('decoration snippet uses the lsystem deco type with a treedef', () => {
		const lua = toDecorationSnippet(apple);
		expect(lua).toContain('deco_type = "lsystem"');
		expect(lua).toMatch(/treedef = \{[\s\S]*axiom = "FFFFFAFFBF"/);
	});
});

describe('parseLuaTreedef', () => {
	it('round-trips an exported treedef', () => {
		const { def } = parseLuaTreedef(toSpawnTreeSnippet(apple));
		expect(def).toEqual({ ...apple, seed: undefined });
	});

	it('reads a decoration snippet too', () => {
		const { def } = parseLuaTreedef(toDecorationSnippet(apple));
		expect(def.axiom).toBe(apple.axiom);
		expect(def.rules_a).toBe(apple.rules_a);
	});

	it('reads long strings, including [=[ ]=] ones that can contain ]]', () => {
		const { def } = parseLuaTreedef(`{
			axiom = [[FF[&F] ]],
			rules_a = [==[[&F[+F]]]==],
			rules_b = [[
F[&F] ]],
		}`);
		expect(def.axiom).toBe('FF[&F] ');
		expect(def.rules_a).toBe('[&F[+F]]');
		// Like Lua, a newline straight after the opening bracket is skipped
		expect(def.rules_b).toBe('F[&F] ');
	});

	it("handles single quotes, escapes and Lua's spacing", () => {
		const { def } = parseLuaTreedef(`{
			axiom='FF\\'F',
			rules_a = [=[[&F][^F]]=],
			leaves="a\\"b",
			angle=-45 , iterations = 3,
			thin_branches=false,
		}`);
		expect(def.axiom).toBe("FF'F");
		expect(def.rules_a).toBe('[&F][^F]');
		expect(def.leaves).toBe('a"b');
		expect(def.angle).toBe(-45);
		expect(def.iterations).toBe(3);
		expect(def.thin_branches).toBe(false);
	});

	it('truncates numbers to integers', () => {
		expect(parseLuaTreedef('{ angle = 22.7 }').def.angle).toBe(22);
	});

	it('reports unknown keys and ignores them', () => {
		const { def, ignored } = parseLuaTreedef(
			'{ axiom = "F", pos = 3, foo = "x" }',
		);
		expect(def.axiom).toBe('F');
		expect(ignored.sort()).toEqual(['foo', 'pos']);
	});

	it('ignores values of the wrong type and invalid trunk types', () => {
		const { def } = parseLuaTreedef(
			'{ axiom = 5, angle = "x", trunk_type = "huge" }',
		);
		expect(def.axiom).toBe(DEFAULT_TREEDEF.axiom);
		expect(def.angle).toBe(DEFAULT_TREEDEF.angle);
		expect(def.trunk_type).toBe(DEFAULT_TREEDEF.trunk_type);
	});

	it('has no seed unless one is given', () => {
		expect(parseLuaTreedef('{ axiom = "F" }').def.seed).toBeUndefined();
		expect(parseLuaTreedef('{ axiom = "F", seed = 12 }').def.seed).toBe(12);
	});
});
