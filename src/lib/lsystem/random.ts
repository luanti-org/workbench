export class Random {
	private state: number;

	constructor(seed: number) {
		this.state = seed | 0;
	}

	/** float in [0, 1) */
	next(): number {
		this.state = (this.state + 0x6d2b79f5) | 0;
		let t = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/** integer in [min, max], inclusive */
	range(min: number, max: number): number {
		return min + Math.floor(this.next() * (max - min + 1));
	}

	/** true with `percent`% probability */
	chance(percent: number): boolean {
		return this.next() * 100 < percent;
	}
}

/** A random signed 32-bit seed */
export function randomSeed(): number {
	return (Math.random() * 0x100000000) | 0;
}
