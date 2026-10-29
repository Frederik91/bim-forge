import { parseLinkedPrepared } from './linked-model.ts';
import type { LinkedPrepared } from './linked-model.ts';
import { geometryDigest } from './geometry-query.ts';
import type { GeometryRef } from './geometry-contract.ts';
import type { GeometryEvidenceSource, GeometryPublication, GeometryReadSnapshot } from './geometry-evidence.ts';
import type { GeometrySessionInput } from './geometry-session.ts';

export function evidenceWall(options: { version?: string; x?: number; namespace?: string; name?: string; missing?: boolean } = {}): LinkedPrepared {
  const source = { namespace: options.namespace ?? 'evidence-wall', revision: options.version ?? 'v1', originalSha256: geometryDigest(options.version ?? 'v1') };
  const ref = { ...source, globalId: '0123456789012345678901' };
  const transform = [[1, 0, 0, options.x ?? 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  const vertices = [0, .5, 0, .25, .5, 0, .25, 3.5, 0, 0, 3.5, 0, 0, .5, 2.5, .25, .5, 2.5, .25, 3.5, 2.5, 0, 3.5, 2.5];
  const triangles = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const artifact = { sha256: 'c'.repeat(64), bytes: 100 };
  return parseLinkedPrepared({ manifest: { format: 'bim-forge-ifc-link', version: 1, state: 'complete', readOnly: true,
    source, schema: 'IFC4', tool: { ifcopenshell: '0.9.0.post1' }, occurrence: { id: 'evidence-occurrence', sourceToProjectMetres: transform },
    artifacts: { 'original.ifc': { ...artifact, sha256: source.originalSha256 }, 'index.json': artifact, 'geometry.json': artifact },
    counts: { entities: 20, objects: 1, products: 1, meshes: options.missing ? 0 : 1, vertices: options.missing ? 0 : 8, triangles: options.missing ? 0 : 12 }, diagnostics: [], losses: [] },
    index: { source, schema: 'IFC4', unitScaleToMetres: 1, units: [], georeferencing: { applied: false, inventory: [] },
      objects: [{ ref, ifcClass: 'IfcWall', name: options.name ?? 'Evidence wall', properties: [] }],
      spatial: [], relationships: [], placements: [{ globalId: ref.globalId }] },
    geometry: { source, frame: 'source-engineering-metres', meshes: options.missing ? [] : [{ ref, verticesMetres: vertices, triangles,
      productToSourceMetres: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] }] } });
}
function wallRef(projectId: string, prepared: LinkedPrepared): Extract<GeometryRef, { kind: 'ifc' }> {
  const object = prepared.index.objects[0];
  if (!object) throw new Error('Fixture requires an object.');
  return { kind: 'ifc', projectId, ...object.ref, occurrenceId: prepared.manifest.occurrence.id,
    placementDigest: geometryDigest(prepared.manifest.occurrence.sourceToProjectMetres) };
}

/** Real immutable geometry inputs, with controlled catalogue races; no geometry computations are mocked. */
export class FixtureGeometrySource implements GeometryEvidenceSource {
  linked: LinkedPrepared[] = [evidenceWall()];
  unavailableSources: { id: string; reason: string }[] = [];
  history: LinkedPrepared[] = [...this.linked];
  generation = 1;
  snapshots = 0;
  guards = 0;
  onSnapshot?: () => void | Promise<void>;
  onGuard?: () => void;
  replace(linked: LinkedPrepared[]): void { this.history.push(...linked); this.linked = linked; this.generation += 1; }
  async snapshot(input: { projectId: string; native: GeometrySessionInput['native']; signal: AbortSignal }): Promise<GeometryReadSnapshot> {
    input.signal.throwIfAborted(); this.snapshots += 1;
    await this.onSnapshot?.(); input.signal.throwIfAborted();
    const correspondences = this.history.flatMap(historical => {
      const current = this.linked.find(item => item.manifest.source.namespace === historical.manifest.source.namespace
        && item.manifest.occurrence.id === historical.manifest.occurrence.id);
      return current ? [{ historical: wallRef(input.projectId, historical), current: wallRef(input.projectId, current) }] : [];
    });
    return { input: { projectId: input.projectId, native: structuredClone(input.native), linked: structuredClone(this.linked),
      unavailableSources: structuredClone(this.unavailableSources) }, catalogToken: String(this.generation), correspondences };
  }
  withCatalogGuard<T>(_projectId: string, catalogToken: string, commit: () => T): GeometryPublication<T> {
    this.guards += 1; this.onGuard?.();
    if (catalogToken !== String(this.generation)) return { kind: 'catalog-changed' };
    return { kind: 'committed', value: commit() };
  }
}

export const geometryReview = { summary: 'Place the requested cube 500 mm clear of the inspected wall.',
  rationale: 'Host measurements check the final authored shape and obstacle set.', constraints: 'Preserve accepted native objects and source identity.',
  uncertainty: 'Synthetic prepared mesh evidence; no construction approval.',
  intent: { interpretation: 'Add the requested cube beside the wall.', assumptions: [], certainty: 90, basis: 'A deterministic synthetic request.' } };
export const cubeAuthoring = `await model.previewAssets({families:[{id:'evidence-cube',type:'AssetFamily',name:'Cube',description:'Synthetic cube',
  parts:[{id:'body',kind:'box',min:[0,0,0],size:[1,1,1],color:'#546778'}]}],
  instances:[{id:'requested-cube',type:'AssetInstance',name:'Requested cube',familyId:'evidence-cube',position:[1,2],rotationDeg:0,
  size:{width:.5,depth:.5,height:.5},placement:{kind:'single-room'}}],removeInstanceIds:[]});`;
export const cubeMeasurement = { subject: { kind: 'box', candidateId: 'requested-cube', bounds: { min: [.75, 1.75, 0], max: [1.25, 2.25, .5] },
  localToProject: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] },
  against: { kind: 'query', query: { role: 'physical', region: { min: [.25, 1.25, -.5], max: [1.75, 2.75, 1] } } },
  operation: 'clearance', clearanceMetres: .5 };
export const geometryProposalScript = `${cubeAuthoring}
const result = await geometry.measure(${JSON.stringify(cubeMeasurement)});
if(result.kind !== 'complete' || result.value.clearance !== 'satisfied-mesh') throw new Error('Clearance unavailable');
return {kind:'propose',review:${JSON.stringify(geometryReview)}};`;
