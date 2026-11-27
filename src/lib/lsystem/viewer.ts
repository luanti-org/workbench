import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { NODE_KINDS, type NodeKind } from './generate';

export type NodeColors = Record<NodeKind, string>;

export const DEFAULT_COLORS: NodeColors = {
	trunk: '#7a5230',
	leaves: '#3f8f3a',
	leaves2: '#a3c94a',
	fruit: '#d8312b',
};

export interface BlockRef {
	kind: NodeKind;
	/** Index into that kind's voxel list */
	index: number;
}

const WHITE = new THREE.Color(1, 1, 1);
const DIM = new THREE.Color(0.45, 0.45, 0.45);

/** Voxel preview: one InstancedMesh per node kind */
export class TreeViewer {
	/** Called when the pointer moves onto a block, or off all blocks (null) */
	onHover: (block: BlockRef | null) => void = () => {};
	/** Called on a click (not a drag) on a block, or on empty space (null) */
	onClick: (block: BlockRef | null) => void = () => {};

	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera: THREE.PerspectiveCamera;
	private controls: OrbitControls;
	private geometry = new THREE.BoxGeometry(1, 1, 1);
	private materials: Record<NodeKind, THREE.MeshLambertMaterial>;
	private meshes = new Map<NodeKind, THREE.InstancedMesh>();
	private voxels: Record<NodeKind, Int32Array> | null = null;
	private bounds: { min: number[]; max: number[] } | null = null;
	private raycaster = new THREE.Raycaster();
	private pointer = new THREE.Vector2();
	private hovered: BlockRef | null = null;
	private hoverBox: THREE.LineSegments;
	private pendingPointer: PointerEvent | null = null;
	private downAt: { x: number; y: number } | null = null;
	private ground: THREE.Mesh;
	private grid: THREE.GridHelper;
	private resizeObserver: ResizeObserver;
	private frame = 0;
	private needsRender = true;

	constructor(private container: HTMLElement) {
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		// setSize(..., false) below only sizes the pixel buffer (which is scaled by
		// devicePixelRatio), so the canvas's displayed size must come from CSS.
		Object.assign(this.renderer.domElement.style, {
			display: 'block',
			width: '100%',
			height: '100%',
		});
		container.appendChild(this.renderer.domElement);

		this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
		this.camera.position.set(20, 15, 20);

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.addEventListener('change', () => {
			this.needsRender = true;
		});

		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.6));
		const sun = new THREE.DirectionalLight(0xffffff, 1.4);
		sun.position.set(0.6, 1, 0.4);
		this.scene.add(sun);

		this.ground = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshLambertMaterial({ color: 0x6b8f4e }),
		);
		this.ground.rotation.x = -Math.PI / 2;
		this.scene.add(this.ground);
		this.grid = new THREE.GridHelper(1, 1, 0x000000, 0x000000);
		(this.grid.material as THREE.Material).opacity = 0.15;
		(this.grid.material as THREE.Material).transparent = true;
		this.scene.add(this.grid);

		this.materials = Object.fromEntries(
			NODE_KINDS.map((k) => [
				k,
				new THREE.MeshLambertMaterial({ color: DEFAULT_COLORS[k] }),
			]),
		) as Record<NodeKind, THREE.MeshLambertMaterial>;

		this.hoverBox = new THREE.LineSegments(
			new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04)),
			new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }),
		);
		this.hoverBox.renderOrder = 1;
		this.hoverBox.visible = false;
		this.scene.add(this.hoverBox);

		const canvas = this.renderer.domElement;
		canvas.addEventListener('pointermove', (e) => {
			this.pendingPointer = e.buttons === 0 ? e : null;
		});
		canvas.addEventListener('pointerleave', () => {
			this.pendingPointer = null;
			this.setHovered(null);
		});
		canvas.addEventListener('pointerdown', (e) => {
			this.downAt = { x: e.clientX, y: e.clientY };
		});
		canvas.addEventListener('pointerup', (e) => {
			if (!this.downAt) return;
			const moved = Math.hypot(
				e.clientX - this.downAt.x,
				e.clientY - this.downAt.y,
			);
			this.downAt = null;
			if (moved < 4) this.onClick(this.pick(e));
		});

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(container);
		this.resize();
		this.loop();
	}

	setColors(colors: NodeColors) {
		for (const kind of NODE_KINDS) this.materials[kind].color.set(colors[kind]);
		this.needsRender = true;
	}

	setVoxels(
		voxels: Record<NodeKind, Int32Array>,
		bounds: { min: number[]; max: number[] },
		recenter: boolean,
	) {
		for (const mesh of this.meshes.values()) {
			this.scene.remove(mesh);
			mesh.dispose();
		}
		this.meshes.clear();
		this.voxels = voxels;
		this.bounds = bounds;
		this.setHovered(null);

		const matrix = new THREE.Matrix4();
		for (const kind of NODE_KINDS) {
			const data = voxels[kind];
			const count = data.length / 3;
			if (count === 0) continue;
			const mesh = new THREE.InstancedMesh(
				this.geometry,
				this.materials[kind],
				count,
			);
			for (let i = 0; i < count; i++) {
				// +0.5 on y so the base node sits on the ground plane
				matrix.makeTranslation(
					data[i * 3],
					data[i * 3 + 1] + 0.5,
					data[i * 3 + 2],
				);
				mesh.setMatrixAt(i, matrix);
				mesh.setColorAt(i, WHITE);
			}
			mesh.instanceMatrix.needsUpdate = true;
			mesh.userData.kind = kind;
			this.scene.add(mesh);
			this.meshes.set(kind, mesh);
		}

		const sizeX = bounds.max[0] - bounds.min[0] + 1;
		const sizeZ = bounds.max[2] - bounds.min[2] + 1;
		const extent = Math.max(sizeX, sizeZ, 8) + 8;
		this.ground.scale.set(extent, extent, 1);
		this.ground.position.set(0, -0.001, 0);
		this.scene.remove(this.grid);
		this.grid.dispose();
		const cells = Math.ceil(extent) | 1;
		this.grid = new THREE.GridHelper(cells, cells, 0x000000, 0x000000);
		this.grid.position.set(0.5, 0, 0.5);
		(this.grid.material as THREE.Material).opacity = 0.15;
		(this.grid.material as THREE.Material).transparent = true;
		this.scene.add(this.grid);

		if (recenter) this.fitView();
		this.needsRender = true;
	}

	/** Point the camera at the whole tree */
	fitView() {
		if (!this.bounds) return;
		const { min, max } = this.bounds;
		const cx = (min[0] + max[0]) / 2;
		const cy = (min[1] + max[1] + 1) / 2;
		const cz = (min[2] + max[2]) / 2;
		const radius = Math.max(
			max[0] - min[0] + 1,
			max[1] - min[1] + 1,
			max[2] - min[2] + 1,
			6,
		);
		this.controls.target.set(cx, cy, cz);
		this.camera.position.set(
			cx + radius * 1.2,
			cy + radius * 0.6,
			cz + radius * 1.2,
		);
		this.controls.update();
		this.needsRender = true;
	}

	/**
	 * Show the given blocks normally and dim the rest. With `shrink`, the rest
	 * are also made small so lit blocks inside a dense canopy stay visible.
	 * Pass null to reset.
	 */
	setHighlight(
		blocks: Record<NodeKind, Int32Array> | null,
		{ shrink = false } = {},
	) {
		const matrix = new THREE.Matrix4();
		const scale = new THREE.Vector3();
		const position = new THREE.Vector3();
		const rotation = new THREE.Quaternion();
		for (const [kind, mesh] of this.meshes) {
			const data = this.voxels?.[kind];
			if (!data) continue;
			const lit = new Uint8Array(mesh.count);
			if (blocks) for (const i of blocks[kind]) lit[i] = 1;
			for (let i = 0; i < mesh.count; i++) {
				const on = !blocks || lit[i] === 1;
				position.set(data[i * 3], data[i * 3 + 1] + 0.5, data[i * 3 + 2]);
				scale.setScalar(on || !shrink ? 1 : 0.3);
				mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
				mesh.setColorAt(i, on ? WHITE : DIM);
			}
			mesh.instanceMatrix.needsUpdate = true;
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
			// Bounds changed with the scale, so picking needs fresh ones
			mesh.computeBoundingSphere();
		}
		this.needsRender = true;
	}

	private pick(e: { clientX: number; clientY: number }): BlockRef | null {
		const rect = this.renderer.domElement.getBoundingClientRect();
		this.pointer.set(
			((e.clientX - rect.left) / rect.width) * 2 - 1,
			-((e.clientY - rect.top) / rect.height) * 2 + 1,
		);
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const hits = this.raycaster.intersectObjects(
			[...this.meshes.values()],
			false,
		);
		const hit = hits.find((h) => h.instanceId !== undefined);
		if (!hit || hit.instanceId === undefined) return null;
		return {
			kind: hit.object.userData.kind as NodeKind,
			index: hit.instanceId,
		};
	}

	private setHovered(block: BlockRef | null) {
		const same =
			block?.kind === this.hovered?.kind &&
			block?.index === this.hovered?.index;
		if (same) return;
		this.hovered = block;
		const data = block && this.voxels?.[block.kind];
		if (block && data) {
			this.hoverBox.position.set(
				data[block.index * 3],
				data[block.index * 3 + 1] + 0.5,
				data[block.index * 3 + 2],
			);
			this.hoverBox.visible = true;
		} else {
			this.hoverBox.visible = false;
		}
		this.needsRender = true;
		this.onHover(block);
	}

	private resize() {
		const { clientWidth: w, clientHeight: h } = this.container;
		if (w === 0 || h === 0) return;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.needsRender = true;
	}

	private loop = () => {
		this.frame = requestAnimationFrame(this.loop);
		this.controls.update();
		// Raycast at most once per frame, and only while not dragging
		if (this.pendingPointer) {
			this.setHovered(this.pick(this.pendingPointer));
			this.pendingPointer = null;
		}
		if (this.needsRender) {
			this.needsRender = false;
			this.renderer.render(this.scene, this.camera);
		}
	};

	dispose() {
		cancelAnimationFrame(this.frame);
		this.resizeObserver.disconnect();
		this.controls.dispose();
		this.renderer.dispose();
	}
}
