import { describe, expect, it } from 'vitest';
import { Random, randomSeed } from './random';

describe('Random', () => {
	it('gives the same sequence for the same seed', () => {
		const a = new Random(42);
		const b = new Random(42);
		for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
	});

	it('gives different sequences for different seeds', () => {
		const a = new Random(1);
		const b = new Random(2);
		const same = Array.from({ length: 20 }, () => a.next() === b.next());
		expect(same.every(Boolean)).toBe(false);
	});

	it('returns floats in [0, 1)', () => {
		const r = new Random(7);
		for (let i = 0; i < 10_000; i++) {
			const v = r.next();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});

	it('range() is inclusive and hits every value', () => {
		const r = new Random(3);
		const seen = new Set<number>();
		for (let i = 0; i < 2_000; i++) {
			const v = r.range(-2, 2);
			expect(Number.isInteger(v)).toBe(true);
			expect(v).toBeGreaterThanOrEqual(-2);
			expect(v).toBeLessThanOrEqual(2);
			seen.add(v);
		}
		expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2]);
	});

	it('chance() respects 0%, 100% and roughly hits the rate between', () => {
		const r = new Random(9);
		const roll = (p: number) =>
			Array.from({ length: 10_000 }, () => r.chance(p)).filter(Boolean).length;
		expect(roll(0)).toBe(0);
		expect(roll(100)).toBe(10_000);
		expect(roll(30)).toBeGreaterThan(2_800);
		expect(roll(30)).toBeLessThan(3_200);
	});

	it('randomSeed() returns signed 32-bit integers', () => {
		for (let i = 0; i < 100; i++) {
			const s = randomSeed();
			expect(s).toBe(s | 0);
		}
	});
});
