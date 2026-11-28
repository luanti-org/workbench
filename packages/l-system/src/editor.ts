// The L-system editor's page controller. Expects the markup from Editor.astro.

import {
	type BuiltFields,
	defaultValues,
	getTemplate,
	normalizeValues,
	type ParamValues,
	TEMPLATES,
} from './lib/builder';
import { EXAMPLES } from './lib/examples';
import type { NodeKind, PickInfo, SourceField } from './lib/generate';
import { NODE_KINDS } from './lib/generate';
import {
	parseLuaTreedef,
	toDecorationSnippet,
	toSpawnTreeSnippet,
} from './lib/lua';
import { randomSeed } from './lib/random';
import {
	DEFAULT_TREEDEF,
	TRUNK_TYPES,
	type TreeDef,
	type TrunkType,
} from './lib/treedef';
import {
	type BlockRef,
	DEFAULT_COLORS,
	type NodeColors,
	TreeViewer,
} from './lib/viewer';
import type { WorkerRequest, WorkerResponse } from './lib/worker';
import { createGeneratorWorker } from './lib/worker-client';

export function mountEditor(): void {
	const $ = <T extends HTMLElement>(sel: string) =>
		document.querySelector<T>(sel) as T;
	const $$ = <T extends HTMLElement>(sel: string) => [
		...document.querySelectorAll<T>(sel),
	];

	const form = $<HTMLFormElement>('#treedef');
	const statsEl = $('#stats');
	const busyEl = $('#busy');
	const inspectEl = $('#inspect');
	const diagnosticsEl = $('#diagnostics');
	const outputEl = $('#output').querySelector('code') as HTMLElement;

	const viewer = new TreeViewer($('#viewer'));
	const worker = createGeneratorWorker();
	const send = (req: WorkerRequest) => worker.postMessage(req);

	let outputMode: 'spawn' | 'decoration' = 'spawn';
	let requestId = 0;
	/** Generation shown in the viewer */
	let shownGeneration = -1;
	let recenterNext = true;

	// ---- builder state ---------------------------------------------------------

	/** The "Custom" tree type: the user's own rules */
	const CUSTOM = 'custom';

	interface BuilderState {
		/** A template id, or CUSTOM */
		template: string;
		/** Remembered settings for each template, so switching back restores them */
		values: Record<string, ParamValues>;
		/** Remembered rules for Custom, so switching away and back keeps them */
		custom: BuiltFields | null;
		/** The last rules a template wrote */
		lastBuilt: { template: string; fields: BuiltFields } | null;
		/**
		 * The template that Custom was branched from by editing its rules. If the
		 * rules are edited back to exactly its output, it's selected again.
		 */
		origin: { template: string; fields: BuiltFields } | null;
	}
	const builder: BuilderState = {
		template: TEMPLATES[0].id,
		values: {},
		custom: null,
		lastBuilt: null,
		origin: null,
	};

	const isCustom = () => builder.template === CUSTOM;

	function currentValues(): ParamValues {
		const t = getTemplate(builder.template);
		builder.values[t.id] = normalizeValues(
			t,
			builder.values[t.id] ?? defaultValues(t),
		);
		return builder.values[t.id];
	}

	const RULE_FIELDS = [
		'axiom',
		'rules_a',
		'rules_b',
		'rules_c',
		'rules_d',
		'angle',
		'iterations',
		'random_level',
		'trunk_type',
		'thin_branches',
	] as const satisfies readonly (keyof BuiltFields)[];
	const ruleAndGrowthFields = new Set<string>(RULE_FIELDS);

	/** The fields a template writes, as currently in the form */
	function readRuleFields(): BuiltFields {
		const def = readForm();
		return Object.fromEntries(
			RULE_FIELDS.map((k) => [k, def[k]]),
		) as unknown as BuiltFields;
	}

	function sameRuleFields(a: BuiltFields, b: BuiltFields) {
		return RULE_FIELDS.every((k) => a[k] === b[k]);
	}

	/** Write the selected template's rules into the form (Custom writes none) */
	function applyBuilder() {
		const notesEl = $('#builder-notes');
		if (isCustom()) {
			notesEl.replaceChildren();
			return;
		}
		const { fields, notes } = getTemplate(builder.template).build(
			currentValues(),
		);
		writeForm(fields);
		builder.lastBuilt = { template: builder.template, fields };
		notesEl.replaceChildren(
			...notes.map((n) => {
				const li = document.createElement('li');
				li.className = 'alert alert-warning alert-soft py-1';
				li.textContent = n;
				return li;
			}),
		);
	}

	function renderBuilder() {
		for (const btn of $$<HTMLButtonElement>('[data-template]')) {
			const active = btn.dataset.template === builder.template;
			btn.classList.toggle('btn-primary', active);
			btn.setAttribute('aria-pressed', String(active));
		}
		for (const el of $$('[data-template-description]')) {
			el.classList.toggle(
				'hidden',
				el.dataset.templateDescription !== builder.template,
			);
		}
		for (const el of $$('[data-template-examples]')) {
			const active = el.dataset.templateExamples === builder.template;
			el.classList.toggle('hidden', !active);
			el.classList.toggle('flex', active);
		}
		for (const group of $$('[data-template-params]')) {
			const active = group.dataset.templateParams === builder.template;
			group.classList.toggle('hidden', !active);
			group.classList.toggle('flex', active);
		}
		if (isCustom()) {
			// Custom's controls show the form's own fields
			for (const input of $$<HTMLInputElement | HTMLSelectElement>(
				'[data-custom]',
			)) {
				const source = field<HTMLInputElement | HTMLSelectElement>(
					input.dataset.custom as string,
				);
				if (input instanceof HTMLInputElement && input.type === 'checkbox') {
					input.checked = (source as HTMLInputElement).checked;
				} else {
					input.value = source.value;
				}
			}
			for (const out of $$<HTMLOutputElement>('[data-custom-output]')) {
				out.value = field(out.dataset.customOutput as string).value;
			}
			return;
		}
		const values = currentValues();
		for (const group of $$(`[data-template-params="${builder.template}"]`)) {
			for (const input of group.querySelectorAll<
				HTMLInputElement | HTMLSelectElement
			>('[data-param]')) {
				const value = values[input.dataset.param as string];
				if (input instanceof HTMLInputElement && input.type === 'checkbox')
					input.checked = Boolean(value);
				else input.value = String(value);
			}
			for (const out of group.querySelectorAll<HTMLOutputElement>(
				'[data-output-for]',
			)) {
				out.value = String(values[out.dataset.outputFor as string]);
			}
		}
	}

	function selectTemplate(id: string) {
		if (id === CUSTOM) {
			if (builder.custom) writeForm(builder.custom);
			else builder.custom = readRuleFields(); // start from what's showing
		}
		builder.template = id;
		builder.origin = null;
		recenterNext = true;
		applyBuilder();
		renderBuilder();
		update();
	}

	for (const btn of $$<HTMLButtonElement>('[data-template]')) {
		btn.addEventListener('click', () =>
			selectTemplate(btn.dataset.template as string),
		);
	}

	/** The rules were edited by hand: keep them as Custom */
	function rulesEdited() {
		const fields = readRuleFields();
		if (!isCustom()) {
			builder.origin = builder.lastBuilt;
			builder.template = CUSTOM;
		}
		builder.custom = fields;
		// Edited back to exactly the template's output (e.g. by undoing)
		if (builder.origin && sameRuleFields(fields, builder.origin.fields)) {
			builder.template = builder.origin.template;
			builder.origin = null;
		}
		applyBuilder();
		renderBuilder();
	}

	$('#builder-params').addEventListener('input', (e) => {
		e.stopPropagation(); // not a treedef field
		const input = e.target as HTMLInputElement | HTMLSelectElement;
		const customField = input.dataset.custom;
		if (customField) {
			// Custom's controls write straight into the form's own fields
			const target = field<HTMLInputElement | HTMLSelectElement>(customField);
			if (input instanceof HTMLInputElement && input.type === 'checkbox') {
				(target as HTMLInputElement).checked = input.checked;
			} else {
				target.value = input.value;
			}
			builder.custom = readRuleFields();
			renderBuilder();
			scheduleUpdate();
			return;
		}
		const key = input.dataset.param;
		if (!key) return;
		const values = currentValues();
		values[key] =
			input instanceof HTMLInputElement && input.type === 'checkbox'
				? input.checked
				: input instanceof HTMLInputElement && input.type === 'range'
					? Number(input.value)
					: input.value;
		applyBuilder();
		renderBuilder();
		scheduleUpdate();
	});

	// ---- tabs --------------------------------------------------------------------

	function setMode(mode: 'builder' | 'advanced') {
		for (const tab of $$<HTMLButtonElement>('[data-mode]')) {
			const active = tab.dataset.mode === mode;
			tab.classList.toggle('tab-active', active);
			tab.setAttribute('aria-selected', String(active));
		}
		for (const [id, m] of [
			['#builder-panel', 'builder'],
			['#advanced-panel', 'advanced'],
		] as const) {
			$(id).classList.toggle('hidden', mode !== m);
			$(id).classList.toggle('flex', mode === m);
		}
		if (mode === 'advanced') for (const f of codeFields.values()) f.render();
	}
	for (const tab of $$<HTMLButtonElement>('[data-mode]')) {
		tab.addEventListener('click', () =>
			setMode(tab.dataset.mode as 'builder' | 'advanced'),
		);
	}
	for (const link of $$<HTMLButtonElement>('[data-mode-link]')) {
		link.addEventListener('click', () =>
			setMode(link.dataset.modeLink as 'builder' | 'advanced'),
		);
	}

	// ---- form <-> treedef ----------------------------------------------------

	function field<T extends HTMLElement = HTMLInputElement>(name: string) {
		return form.elements.namedItem(name) as unknown as T;
	}

	function readForm(): TreeDef {
		const num = (name: string, fallback: number) => {
			const v = Number.parseInt(field(name).value, 10);
			return Number.isFinite(v) ? v : fallback;
		};
		const text = (name: string) =>
			field<HTMLInputElement | HTMLTextAreaElement>(name).value.trim();
		const seedRaw = field('seed').value.trim();
		const trunkType = field<HTMLSelectElement>('trunk_type').value as TrunkType;
		return {
			axiom: text('axiom'),
			rules_a: text('rules_a'),
			rules_b: text('rules_b'),
			rules_c: text('rules_c'),
			rules_d: text('rules_d'),
			trunk: text('trunk'),
			leaves: text('leaves'),
			leaves2: text('leaves2'),
			leaves2_chance: num('leaves2_chance', 0),
			angle: num('angle', DEFAULT_TREEDEF.angle),
			iterations: num('iterations', DEFAULT_TREEDEF.iterations),
			random_level: num('random_level', 0),
			trunk_type: TRUNK_TYPES.includes(trunkType) ? trunkType : 'single',
			thin_branches: field('thin_branches').checked,
			fruit: text('fruit'),
			fruit_chance: num('fruit_chance', 0),
			seed: seedRaw === '' ? undefined : Number.parseInt(seedRaw, 10) | 0,
		};
	}

	function writeForm(def: Partial<TreeDef>) {
		for (const [key, value] of Object.entries(def) as [
			keyof TreeDef,
			unknown,
		][]) {
			const el = field<HTMLInputElement>(key);
			if (!el) continue;
			if (el.type === 'checkbox') el.checked = Boolean(value);
			else el.value = value === undefined ? '' : String(value);
		}
		for (const f of codeFields.values()) f.render();
	}

	function readColors(): NodeColors {
		const colors = { ...DEFAULT_COLORS };
		for (const el of $$<HTMLInputElement>('[data-color]')) {
			colors[el.dataset.color as NodeKind] = el.value;
		}
		return colors;
	}

	// ---- URL hash sharing ------------------------------------------------------

	interface SharedState {
		v: 2;
		def: TreeDef;
		/** The selected tree type (null in older links means Custom) */
		builder: { template: string; values: ParamValues } | null;
	}

	function encodeState(state: SharedState): string {
		const bytes = new TextEncoder().encode(JSON.stringify(state));
		return btoa(String.fromCharCode(...bytes))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
	}

	function decodeState(hash: string): SharedState | null {
		try {
			const b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
			const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			const parsed = JSON.parse(new TextDecoder().decode(bytes));
			if (parsed?.v === 2)
				return { ...parsed, def: { ...DEFAULT_TREEDEF, ...parsed.def } };
			// Links from before the builder held just the treedef
			return { v: 2, def: { ...DEFAULT_TREEDEF, ...parsed }, builder: null };
		} catch {
			return null;
		}
	}

	// ---- text fields with highlightable characters -------------------------------

	class CodeField {
		readonly textarea: HTMLTextAreaElement;
		private backdrop: HTMLElement;
		private marks: { from: number; to: number; strong: number[] } | null = null;

		constructor(
			readonly name: SourceField,
			wrapper: HTMLElement,
		) {
			this.textarea = wrapper.querySelector('textarea') as HTMLTextAreaElement;
			this.backdrop = wrapper.querySelector('.code-backdrop') as HTMLElement;
			this.textarea.addEventListener('scroll', () => {
				this.backdrop.scrollTop = this.textarea.scrollTop;
			});
			this.textarea.addEventListener('input', () => this.fitHeight());
		}

		/** Characters before the trimmed text that the generator sees */
		get offset() {
			const v = this.textarea.value;
			return v.length - v.trimStart().length;
		}

		/** Highlight columns [from, to) of the trimmed text, with some stronger */
		mark(from: number, to: number, strong: number[] = []) {
			this.marks = { from, to, strong };
			this.render();
		}

		clearMarks() {
			if (!this.marks) return;
			this.marks = null;
			this.render();
		}

		fitHeight() {
			this.textarea.style.height = 'auto';
			this.textarea.style.height = `${this.textarea.scrollHeight + 2}px`;
		}

		render() {
			const text = this.textarea.value;
			const off = this.offset;
			const frag = document.createDocumentFragment();
			for (let i = 0; i < text.length; i++) {
				const span = document.createElement('span');
				span.textContent = text[i];
				span.dataset.col = String(i - off);
				const m = this.marks;
				const col = i - off;
				if (m?.strong.includes(col)) span.className = 'hl-strong';
				else if (m && col >= m.from && col < m.to) span.className = 'hl';
				frag.append(span);
			}
			// Keeps the last line's height when the text ends with a newline
			frag.append(document.createTextNode('​'));
			this.backdrop.replaceChildren(frag);
			this.fitHeight();
			this.backdrop.scrollTop = this.textarea.scrollTop;
		}

		/** Column (in trimmed text) under a screen point, if any */
		columnAt(x: number, y: number): number | null {
			for (const el of document.elementsFromPoint(x, y)) {
				if (
					el.parentElement === this.backdrop &&
					el instanceof HTMLElement &&
					el.dataset.col
				) {
					const col = Number(el.dataset.col);
					return col >= 0 && col < this.textarea.value.trim().length
						? col
						: null;
				}
			}
			return null;
		}
	}

	const codeFields = new Map<SourceField, CodeField>();
	for (const wrapper of $$('[data-code-field]')) {
		const name = wrapper.dataset.codeField as SourceField;
		codeFields.set(name, new CodeField(name, wrapper));
	}

	// ---- linking text <-> blocks -------------------------------------------------

	type Focus =
		| { type: 'text'; field: SourceField; from: number; to: number; at: number }
		| { type: 'block'; block: BlockRef; info: PickInfo };

	let hoverFocus: Focus | null = null;
	let pinnedFocus: Focus | null = null;
	let caretFocus: Focus | null = null;
	let highlightRequest = 0;
	/** Whether the current highlight should shrink unlit blocks */
	let highlightShrink = false;
	let pickRequest = 0;
	let pendingPick: { id: number; block: BlockRef; pin: boolean } | null = null;

	const SYMBOL_HELP: Record<string, string> = {
		G: 'move forward without drawing',
		F: 'draw trunk (inside [ ], a branch with leaves)',
		f: 'draw a leaf',
		T: 'draw trunk',
		R: 'place fruit',
		A: 'replaced by Rules A',
		B: 'replaced by Rules B',
		C: 'replaced by Rules C',
		D: 'replaced by Rules D',
		a: 'replaced by Rules A (90% chance)',
		b: 'replaced by Rules B (80% chance)',
		c: 'replaced by Rules C (70% chance)',
		d: 'replaced by Rules D (60% chance)',
		'+': 'turn right',
		'-': 'turn left',
		'&': 'tilt down',
		'^': 'tilt up',
		'/': 'roll right',
		'*': 'roll left',
		'[': 'start a branch (saves position)',
		']': 'end a branch (goes back)',
	};
	const FIELD_LABEL: Record<SourceField, string> = {
		axiom: 'Axiom',
		rules_a: 'Rules A',
		rules_b: 'Rules B',
		rules_c: 'Rules C',
		rules_d: 'Rules D',
	};

	/**
	 * The text a symbol column refers to: a whole [ … ] for brackets, and for
	 * turns or G (which draw nothing) everything after it in the same branch.
	 */
	function textFocus(name: SourceField, col: number, to = col + 1): Focus {
		const text = field<HTMLTextAreaElement>(name).value.trim();
		let from = col;
		if (to === col + 1 && '+-&^/*G'.includes(text[col])) {
			let depth = 0;
			to = text.length;
			for (let i = col + 1; i < text.length; i++) {
				if (text[i] === '[') depth += 1;
				if (text[i] === ']') depth -= 1;
				if (depth < 0) {
					to = i;
					break;
				}
			}
		} else if (to === col + 1 && (text[col] === '[' || text[col] === ']')) {
			const step = text[col] === '[' ? 1 : -1;
			let depth = 0;
			for (let i = col; i >= 0 && i < text.length; i += step) {
				if (text[i] === '[') depth += 1;
				if (text[i] === ']') depth -= 1;
				if (depth === 0) {
					from = Math.min(col, i);
					to = Math.max(col, i) + 1;
					break;
				}
			}
		}
		return { type: 'text', field: name, from, to, at: col };
	}

	function describeText(f: Extract<Focus, { type: 'text' }>) {
		const text = field<HTMLTextAreaElement>(f.field).value.trim();
		const ch = text[f.at];
		const what = SYMBOL_HELP[ch] ?? 'not a symbol (ignored)';
		const note = '+-&^/*G'.includes(ch)
			? '. Lit up: everything drawn after it in this branch.'
			: '';
		return `<b class="font-mono">${escapeHtml(ch)}</b> in ${FIELD_LABEL[f.field]} — ${what}${note}`;
	}

	function describeBlock(f: Extract<Focus, { type: 'block' }>) {
		const [own, ...via] = f.info.chain;
		const what = SYMBOL_HELP[f.info.symbol] ?? '';
		const kind =
			f.block.kind === 'trunk'
				? 'Trunk'
				: f.block.kind === 'fruit'
					? 'Fruit'
					: 'Leaf';
		let html = `${kind} block, drawn by <b class="font-mono">${escapeHtml(f.info.symbol)}</b> in ${FIELD_LABEL[own.field]} (${what})`;
		if (via.length) {
			html += ` · via ${via.map((r) => `<b class="font-mono">${escapeHtml(charAt(r))}</b> in ${FIELD_LABEL[r.field]}`).join(', ')}`;
		}
		return html;
	}

	function charAt(ref: { field: SourceField; index: number }) {
		return field<HTMLTextAreaElement>(ref.field).value.trim()[ref.index] ?? '?';
	}

	function escapeHtml(s: string) {
		return s.replace(
			/[&<>"]/g,
			(c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`,
		);
	}

	const IDLE_HINT =
		'<span class="text-base-content/60">Hover a block to see which symbol drew it, or click it to select it. Drag to rotate, scroll to zoom.</span>';

	/** Second line under a description, explaining what the preview is showing */
	function hint(text: string) {
		return `<br><span class="text-base-content/60 text-xs">${text}</span>`;
	}

	/** Show whichever focus wins: hover, then a clicked block, then the caret */
	function applyFocus() {
		const focus = hoverFocus ?? pinnedFocus ?? caretFocus;
		for (const f of codeFields.values()) f.clearMarks();
		highlightRequest++;
		// Don't reshape the tree under the pointer while hovering blocks
		highlightShrink =
			focus?.type === 'text' || (focus !== null && focus === pinnedFocus);
		if (!focus) {
			viewer.setHighlight(null);
			inspectEl.innerHTML = IDLE_HINT;
			return;
		}
		if (focus.type === 'text') {
			codeFields.get(focus.field)?.mark(focus.from, focus.to, [focus.at]);
			inspectEl.innerHTML =
				describeText(focus) +
				hint(
					'Full-size blocks are what it draws. The rest are shrunk so you can see them.',
				);
			send({
				type: 'blocksFrom',
				id: highlightRequest,
				field: focus.field,
				from: focus.from,
				to: focus.to,
			});
		} else {
			const [own, ...via] = focus.info.chain;
			for (const ref of via)
				codeFields.get(ref.field)?.mark(ref.index, ref.index + 1);
			codeFields.get(own.field)?.mark(own.index, own.index + 1, [own.index]);
			inspectEl.innerHTML =
				describeBlock(focus) +
				hint(
					focus === pinnedFocus
						? 'Full-size blocks were drawn by the same symbol; the rest are shrunk so you can see them. Click empty space or press Esc to clear.'
						: 'The outline marks the block under the pointer. Brighter blocks were drawn by the same symbol. Click to select.',
				);
			send({
				type: 'blocksFrom',
				id: highlightRequest,
				field: own.field,
				from: own.index,
				to: own.index + 1,
			});
		}
	}

	for (const f of codeFields.values()) {
		const ta = f.textarea;
		ta.addEventListener('mousemove', (e) => {
			const col = f.columnAt(e.clientX, e.clientY);
			const next = col === null ? null : textFocus(f.name, col);
			const same =
				next?.type === 'text' &&
				hoverFocus?.type === 'text' &&
				next.field === hoverFocus.field &&
				next.at === hoverFocus.at;
			if (same || (next === null && hoverFocus === null)) return;
			hoverFocus = next;
			applyFocus();
		});
		ta.addEventListener('mouseleave', () => {
			if (!hoverFocus) return;
			hoverFocus = null;
			applyFocus();
		});
		const updateCaret = () => {
			if (document.activeElement !== ta) return;
			const len = ta.value.trim().length;
			const off = f.offset;
			const start = ta.selectionStart - off;
			const end = ta.selectionEnd - off;
			if (len === 0) caretFocus = null;
			else if (end > start)
				caretFocus = {
					type: 'text',
					field: f.name,
					from: Math.max(0, start),
					to: Math.min(len, end),
					at: Math.max(0, start),
				};
			else
				caretFocus = textFocus(f.name, Math.min(Math.max(0, start), len - 1));
			pinnedFocus = null;
			applyFocus();
		};
		ta.addEventListener('click', updateCaret);
		ta.addEventListener('keyup', (e) => {
			if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')
				updateCaret();
		});
		ta.addEventListener('select', updateCaret);
		ta.addEventListener('blur', () => {
			if (!caretFocus) return;
			caretFocus = null;
			applyFocus();
		});
		ta.addEventListener('input', () => {
			caretFocus = null;
			hoverFocus = null;
			pinnedFocus = null;
			f.render();
		});
	}

	viewer.onHover = (block) => {
		pickRequest++;
		if (!block) {
			if (hoverFocus?.type === 'block') {
				hoverFocus = null;
				applyFocus();
			}
			return;
		}
		send({
			type: 'pick',
			id: pickRequest,
			kind: block.kind,
			index: block.index,
		});
		pendingPick = { id: pickRequest, block, pin: false };
	};
	viewer.onClick = (block) => {
		if (!block) {
			pinnedFocus = null;
			applyFocus();
			return;
		}
		pickRequest++;
		send({
			type: 'pick',
			id: pickRequest,
			kind: block.kind,
			index: block.index,
		});
		pendingPick = { id: pickRequest, block, pin: true };
	};
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && pinnedFocus) {
			pinnedFocus = null;
			applyFocus();
		}
	});

	// ---- worker ------------------------------------------------------------------

	worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
		const msg = event.data;
		if (msg.type === 'generate') {
			if (msg.id !== requestId) return; // stale
			busyEl.classList.add('hidden');
			if (msg.error || !msg.result) {
				renderDiagnostics([
					{ level: 'error', message: msg.error ?? 'Unknown error' },
				]);
				return;
			}
			const result = msg.result;
			shownGeneration = msg.id;
			viewer.setVoxels(result.voxels, result.bounds, recenterNext);
			recenterNext = false;

			const { min, max } = result.bounds;
			const size = [0, 1, 2].map((a) => max[a] - min[a] + 1).join('×');
			const counts = NODE_KINDS.filter((k) => result.voxels[k].length)
				.map((k) => `${k} ${result.voxels[k].length / 3}`)
				.join(' · ');
			statsEl.textContent = `${result.nodeCount.toLocaleString()} nodes · ${size}\n${counts}`;
			renderDiagnostics(result.diagnostics);
			// Block indices changed, so a clicked block no longer means anything
			pinnedFocus = null;
			if (hoverFocus?.type === 'block') hoverFocus = null;
			applyFocus();
		} else if (msg.type === 'blocksFrom') {
			if (msg.id !== highlightRequest || msg.generation !== shownGeneration)
				return;
			viewer.setHighlight(msg.blocks, { shrink: highlightShrink });
		} else if (msg.type === 'pick') {
			if (
				!pendingPick ||
				msg.id !== pendingPick.id ||
				msg.generation !== shownGeneration
			)
				return;
			const { block, pin } = pendingPick;
			pendingPick = null;
			if (!msg.info) return;
			const focus: Focus = { type: 'block', block, info: msg.info };
			if (pin) {
				pinnedFocus = focus;
				hoverFocus = null;
				const own = msg.info.chain[0];
				codeFields
					.get(own.field)
					?.textarea.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			} else {
				hoverFocus = focus;
			}
			applyFocus();
		}
	};

	function renderDiagnostics(
		list: { level: 'error' | 'warning'; message: string }[],
	) {
		diagnosticsEl.replaceChildren(
			...list.map(({ level, message }) => {
				const li = document.createElement('li');
				li.className = `alert alert-soft py-1 ${level === 'error' ? 'alert-error' : 'alert-warning'}`;
				li.textContent = message;
				return li;
			}),
		);
	}

	function update() {
		const def = readForm();
		outputEl.textContent =
			outputMode === 'spawn'
				? toSpawnTreeSnippet(def)
				: toDecorationSnippet(def);
		const state: SharedState = {
			v: 2,
			def,
			builder: {
				template: builder.template,
				values: isCustom() ? {} : currentValues(),
			},
		};
		history.replaceState(null, '', `#${encodeState(state)}`);

		requestId++;
		busyEl.classList.remove('hidden');
		send({ type: 'generate', id: requestId, def, options: {} });
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	function scheduleUpdate() {
		clearTimeout(timer);
		timer = setTimeout(update, 120);
	}

	// ---- wiring ------------------------------------------------------------------

	form.addEventListener('input', (e) => {
		const target = e.target as HTMLInputElement;
		if (target.dataset.color) {
			viewer.setColors(readColors());
			return;
		}
		if (ruleAndGrowthFields.has(target.name)) rulesEdited();
		scheduleUpdate();
	});
	form.addEventListener('submit', (e) => e.preventDefault());

	$('#reroll').addEventListener('click', () => {
		field('seed').value = String(randomSeed());
		update();
	});
	$('#fit').addEventListener('click', () => viewer.fitView());

	const viewerFrame = $('#viewer-frame');
	const fullscreenButton = $('#fullscreen');
	fullscreenButton.addEventListener('click', () => {
		if (document.fullscreenElement) void document.exitFullscreen();
		else viewerFrame.requestFullscreen().catch(() => {});
	});
	document.addEventListener('fullscreenchange', () => {
		const on = document.fullscreenElement === viewerFrame;
		for (const el of $$('[data-fullscreen-icon]')) {
			el.classList.toggle(
				'hidden',
				(el.dataset.fullscreenIcon === 'exit') !== on,
			);
		}
		const label = on ? 'Exit full screen' : 'Full screen';
		fullscreenButton.title = label;
		fullscreenButton.setAttribute('aria-label', label);
	});

	/** Load hand-written rules (an example or an import) as Custom */
	function loadCustom(def: TreeDef) {
		writeForm(def);
		builder.custom = readRuleFields();
		builder.template = CUSTOM;
		builder.origin = null;
		recenterNext = true;
		applyBuilder();
		renderBuilder();
		update();
	}

	/** Examples sit under their tree type; loading one sets its sliders and node names */
	for (const btn of $$<HTMLButtonElement>('[data-example]')) {
		btn.addEventListener('click', () => {
			const example = EXAMPLES[Number(btn.dataset.example)];
			if (!example) return;
			if ('def' in example) {
				loadCustom({ ...example.def, ...example.nodes });
				return;
			}
			writeForm(example.nodes);
			const template = getTemplate(example.template);
			builder.values[template.id] = normalizeValues(template, example.values);
			selectTemplate(template.id);
		});
	}

	for (const tab of $$<HTMLButtonElement>('[data-output]')) {
		tab.addEventListener('click', () => {
			outputMode = tab.dataset.output as typeof outputMode;
			for (const t of $$('[data-output]'))
				t.classList.toggle('tab-active', t === tab);
			update();
		});
	}

	async function copyWithFeedback(button: HTMLButtonElement, text: string) {
		await navigator.clipboard.writeText(text);
		const original = button.innerHTML;
		button.textContent = 'Copied!';
		setTimeout(() => {
			button.innerHTML = original;
		}, 1200);
	}

	$<HTMLButtonElement>('#copy').addEventListener('click', (e) =>
		copyWithFeedback(
			e.currentTarget as HTMLButtonElement,
			outputEl.textContent ?? '',
		),
	);
	$<HTMLButtonElement>('#share').addEventListener('click', (e) =>
		copyWithFeedback(e.currentTarget as HTMLButtonElement, location.href),
	);

	const importDialog = $<HTMLDialogElement>('#import-dialog');
	const importText = $<HTMLTextAreaElement>('#import-text');
	const importMessage = $('#import-message');
	$('#import-open').addEventListener('click', () => {
		importMessage.textContent = '';
		importDialog.showModal();
	});
	$('#import-apply').addEventListener('click', () => {
		const { def, ignored } = parseLuaTreedef(importText.value);
		if (!def.axiom) {
			importMessage.textContent = 'No axiom found in the pasted text.';
			return;
		}
		importDialog.close();
		loadCustom(def);
		if (ignored.length) console.info('Ignored fields on import:', ignored);
	});

	// ---- init --------------------------------------------------------------------

	const shared =
		location.hash.length > 1 ? decodeState(location.hash.slice(1)) : null;
	writeForm(shared?.def ?? DEFAULT_TREEDEF);
	if (shared && (!shared.builder || shared.builder.template === CUSTOM)) {
		builder.template = CUSTOM;
		builder.custom = readRuleFields();
	} else if (shared?.builder) {
		builder.template = getTemplate(shared.builder.template).id;
		builder.values[builder.template] = shared.builder.values;
	}
	applyBuilder();
	renderBuilder();
	viewer.setColors(readColors());
	inspectEl.innerHTML = IDLE_HINT;
	update();
}
