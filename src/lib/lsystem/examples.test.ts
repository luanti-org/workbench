import { describe, expect, it } from 'vitest';
import { getTemplate, normalizeValues, TEMPLATES } from './builder';
import { EXAMPLES } from './examples';
import { generate } from './generate';

describe('examples', () => {
	for (const example of EXAMPLES) {
		describe(example.name, () => {
			if ('def' in example) {
				it('grows a tree from its rules', () => {
					const result = generate({
						...example.def,
						...example.nodes,
						seed: 1,
					});
					expect(result.nodeCount).toBeGreaterThan(0);
					expect(result.diagnostics).toEqual([]);
				});
				return;
			}

			it('uses an existing tree type', () => {
				expect(TEMPLATES.map((t) => t.id)).toContain(example.template);
			});

			it('only sets valid settings for that type', () => {
				const template = getTemplate(example.template);
				const normalized = normalizeValues(template, example.values);
				for (const [key, value] of Object.entries(example.values)) {
					expect(normalized[key], key).toBe(value);
				}
			});

			it('grows a tree with its node names', () => {
				const template = getTemplate(example.template);
				const { fields } = template.build(
					normalizeValues(template, example.values),
				);
				const result = generate({ ...fields, ...example.nodes, seed: 1 });
				expect(result.nodeCount).toBeGreaterThan(0);
				expect(result.diagnostics).toEqual([]);
				if (example.nodes.fruit && example.nodes.fruit_chance > 0) {
					expect(result.voxels.fruit.length).toBeGreaterThan(0);
				}
			});
		});
	}
});
