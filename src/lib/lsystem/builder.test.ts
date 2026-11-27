import { describe, expect, it } from 'vitest';
import {
	type BuiltFields,
	defaultValues,
	getTemplate,
	normalizeValues,
	type Param,
	type ParamValues,
	TEMPLATES,
	type Template,
} from './builder';
import { checkBrackets, generate } from './generate';
import { Random } from './random';
import { DEFAULT_TREEDEF } from './treedef';

const SYMBOLS = /^[GFfTRABCDabcd+\-&^/*[\]]*$/;
const RULE_FIELDS = [
	'axiom',
	'rules_a',
	'rules_b',
	'rules_c',
	'rules_d',
] as const;

/** Every rule field is valid L-system text */
function expectValidRules(fields: BuiltFields) {
	for (const name of RULE_FIELDS) {
		expect(fields[name], name).toMatch(SYMBOLS);
		expect(checkBrackets(fields[name], name), name).toEqual([]);
	}
	expect(fields.iterations).toBeGreaterThanOrEqual(2);
}

function randomValue(p: Param, rng: Random) {
	if (p.type === 'range')
		return p.min + rng.range(0, Math.round((p.max - p.min) / p.step)) * p.step;
	if (p.type === 'select')
		return p.options[rng.range(0, p.options.length - 1)].value;
	return rng.chance(50);
}

function grow(template: Template, values: ParamValues) {
	const { fields } = template.build(values);
	return generate({ ...DEFAULT_TREEDEF, fruit: 'x:fruit', ...fields, seed: 1 });
}

describe('templates', () => {
	it('have unique ids', () => {
		const ids = TEMPLATES.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('have params with valid defaults', () => {
		for (const t of TEMPLATES) {
			for (const p of t.params) {
				if (p.type === 'range') {
					expect(p.default, `${t.id}.${p.key}`).toBeGreaterThanOrEqual(p.min);
					expect(p.default, `${t.id}.${p.key}`).toBeLessThanOrEqual(p.max);
				}
				if (p.type === 'select') {
					expect(
						p.options.map((o) => o.value),
						`${t.id}.${p.key}`,
					).toContain(p.default);
				}
			}
		}
	});

	for (const t of TEMPLATES) {
		describe(t.name, () => {
			it('builds valid rules that grow a tree at its defaults', () => {
				const { fields } = t.build(defaultValues(t));
				expectValidRules(fields);
				const result = grow(t, defaultValues(t));
				expect(result.nodeCount).toBeGreaterThan(0);
				expect(result.voxels.trunk.length).toBeGreaterThan(0);
				expect(result.diagnostics).toEqual([]);
			});

			it('builds valid rules for random settings', () => {
				const rng = new Random(t.id.length);
				for (let i = 0; i < 40; i++) {
					const values = Object.fromEntries(
						t.params.map((p) => [p.key, randomValue(p, rng)]),
					);
					const { fields } = t.build(values);
					expectValidRules(fields);
					expect(
						grow(t, values).diagnostics.filter((d) => d.level === 'error'),
					).toEqual([]);
				}
			});

			it('is deterministic', () => {
				expect(t.build(defaultValues(t))).toEqual(t.build(defaultValues(t)));
			});
		});
	}
});

describe('template behaviour', () => {
	const build = (id: string, values: ParamValues = {}) => {
		const t = getTemplate(id);
		return t.build(normalizeValues(t, values)).fields;
	};

	it('broadleaf: more branches per layer adds branches', () => {
		const count = (branches: number) =>
			(build('broadleaf', { branches }).axiom.match(/A/g) ?? []).length;
		expect(count(6)).toBe(count(3) * 2);
	});

	it('broadleaf: missing branches uses chance rule letters', () => {
		expect(build('broadleaf', { gaps: 'none' }).axiom).toContain('A');
		expect(build('broadleaf', { gaps: 'few' }).axiom).toContain('a');
		const some = build('broadleaf', { gaps: 'some' });
		expect(some.axiom).toContain('c');
		expect(some.rules_c).not.toBe('');
	});

	it('conifer: branches get shorter towards the top', () => {
		const { axiom } = build('conifer', { tiers: 4, bottom: 6, topLength: 1 });
		const lengths = [...axiom.matchAll(/\[&+(f+)\]/g)].map((m) => m[1].length);
		expect(lengths[0]).toBe(6);
		expect(lengths.at(-1)).toBe(1);
		for (let i = 1; i < lengths.length; i++)
			expect(lengths[i]).toBeLessThanOrEqual(lengths[i - 1]);
	});

	it('branching: one rules set per level, shorter each level', () => {
		const fields = build('branching', {
			levels: 3,
			length: 4,
			shrink: 50,
			twist: 0,
		});
		expect(fields.rules_a).not.toBe('');
		expect(fields.rules_b).not.toBe('');
		expect(fields.rules_c).not.toBe('');
		expect(fields.rules_d).toBe('');
		expect(fields.iterations).toBe(3);
		const segment = (rule: string) => rule.match(/^[FT]+/)?.[0].length;
		expect([
			segment(fields.rules_a),
			segment(fields.rules_b),
			segment(fields.rules_c),
		]).toEqual([4, 2, 1]);
	});

	it('branching: bare trees have no leaves', () => {
		const t = getTemplate('branching');
		const result = grow(t, normalizeValues(t, { leaves: 'none' }));
		expect(result.voxels.leaves.length).toBe(0);
	});

	it('dead tree: has no leaves', () => {
		const t = getTemplate('dead');
		expect(grow(t, defaultValues(t)).voxels.leaves.length).toBe(0);
	});

	it('bush: has no trunk under the stems', () => {
		const { axiom } = build('bush', { centre: 0 });
		expect(axiom.startsWith('[')).toBe(true);
	});
});

describe('getTemplate', () => {
	it('finds templates by id and falls back to the first', () => {
		expect(getTemplate('conifer').id).toBe('conifer');
		expect(getTemplate('no-such-template')).toBe(TEMPLATES[0]);
	});
});

describe('normalizeValues', () => {
	const t = getTemplate('broadleaf');

	it('fills in missing values with defaults', () => {
		expect(normalizeValues(t, {})).toEqual(defaultValues(t));
	});

	it('clamps ranges and rejects invalid values', () => {
		const values = normalizeValues(t, {
			height: 999,
			layers: -3,
			trunk: 'huge',
			forks: 'yes',
			extra: 1,
		});
		expect(values.height).toBe(16);
		expect(values.layers).toBe(1);
		expect(values.trunk).toBe('single');
		expect(values.forks).toBe(false);
		expect(values).not.toHaveProperty('extra');
	});

	it('keeps valid values', () => {
		expect(
			normalizeValues(t, { height: 7, trunk: 'double', forks: true }),
		).toMatchObject({
			height: 7,
			trunk: 'double',
			forks: true,
		});
	});
});
