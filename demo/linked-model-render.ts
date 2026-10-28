import type { Scene } from '@babylonjs/core/scene.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { linkPoint } from '../src/linked-model.ts';
import type { LinkedPrepared, LinkedSelection } from '../src/linked-model.ts';

export type LinkedDisplay = { id: string; prepared: LinkedPrepared; visible: boolean };
/** Adds only disposable source-owned meshes to the existing scene; never calls setModel. */
export class LinkedModelLayer {
  private readonly scene: Scene;
  private readonly material: StandardMaterial;
  private readonly parts = new Map<Mesh, LinkedSelection>();
  private readonly signatures = new Map<string, string>();
  constructor(scene: Scene) {
    this.scene = scene; this.material = new StandardMaterial('ifc-reference-material', scene);
    this.material.diffuseColor = Color3.FromHexString('#4b91ab'); this.material.alpha = .65; this.material.backFaceCulling = false;
  }
  setLinks(links: readonly LinkedDisplay[]): void {
    const present = new Set(links.map(link => link.id));
    for (const [mesh, selection] of this.parts) if (!present.has(selection.occurrence.id)) { mesh.dispose(); this.parts.delete(mesh); }
    for (const id of this.signatures.keys()) if (!present.has(id)) this.signatures.delete(id);
    for (const link of links) {
      const { manifest, geometry } = link.prepared;
      const signature = JSON.stringify([manifest.source, manifest.occurrence]);
      if (this.signatures.get(link.id) !== signature) {
        for (const [mesh, selection] of this.parts) if (selection.occurrence.id === link.id) { mesh.dispose(); this.parts.delete(mesh); }
        for (const shape of geometry.meshes) {
          const positions: number[] = [];
          for (let i = 0; i < shape.verticesMetres.length; i += 3) {
            const [x = 0, y = 0, z = 0] = linkPoint(manifest.occurrence.sourceToProjectMetres, linkPoint(shape.productToSourceMetres, shape.verticesMetres.slice(i, i + 3)));
            positions.push(x, z, y);
          }
          const indices: number[] = [];
          for (let i = 0; i < shape.triangles.length; i += 3) indices.push(shape.triangles[i] ?? 0, shape.triangles[i + 2] ?? 0, shape.triangles[i + 1] ?? 0);
          const mesh = new Mesh(`ifc:${link.id}:${shape.ref.globalId}`, this.scene); const data = new VertexData(); const normals: number[] = [];
          VertexData.ComputeNormals(positions, indices, normals); data.positions = positions; data.indices = indices; data.normals = normals; data.applyToMesh(mesh);
          mesh.material = this.material; mesh.isPickable = true;
          this.parts.set(mesh, { kind: 'ifc-reference', source: shape.ref, occurrence: manifest.occurrence });
        }
        this.signatures.set(link.id, signature);
      }
      for (const [mesh, selection] of this.parts) if (selection.occurrence.id === link.id) mesh.setEnabled(link.visible);
    }
  }
  pick(mesh: AbstractMesh | null): LinkedSelection | null { return mesh instanceof Mesh && mesh.isEnabled() ? this.parts.get(mesh) ?? null : null; }
  objectAt(x: number, y: number): LinkedSelection | null { return this.pick(this.scene.pick(x, y, mesh => mesh instanceof Mesh && this.parts.has(mesh))?.pickedMesh ?? null); }
  select(selection: LinkedSelection | null): void {
    for (const [mesh, value] of this.parts) {
      mesh.renderOutline = Boolean(selection && JSON.stringify(selection) === JSON.stringify(value));
      mesh.outlineColor = Color3.FromHexString('#135b91'); mesh.outlineWidth = .025;
    }
  }
  dispose(): void { for (const mesh of this.parts.keys()) mesh.dispose(); this.parts.clear(); this.signatures.clear(); this.material.dispose(); }
}
