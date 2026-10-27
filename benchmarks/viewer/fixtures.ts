import type { Camera, Element, Geometry, Model, Proposal } from './contract.ts';
import { parseModel } from './contract.ts';

const box: Geometry = {
  id: 'box',
  positions: [-.5,-.5,-.5, .5,-.5,-.5, .5,.5,-.5, -.5,.5,-.5, -.5,-.5,.5, .5,-.5,.5, .5,.5,.5, -.5,.5,.5],
  indices: [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 3,7,6, 3,6,2, 0,4,7, 0,7,3, 1,2,6, 1,6,5],
};
export function smokeModel(count = 24): Model {
  const elements: Element[] = [];
  const categories = ['Wall', 'Door', 'Window', 'Slab', 'Equipment', 'Furniture'];
  const disciplines = ['architecture', 'structure', 'mechanical', 'electrical', 'plumbing'];
  for (let i = 0; i < count; i++) {
    elements.push({ id: 'element-' + i, category: categories[i % categories.length], discipline: disciplines[i % disciplines.length],
      storey: 'ground', geometryId: 'box', position: [(i % 6) * 2.5, .75, Math.floor(i / 6) * 2.5], scale: [1.2, 1.5, 1.2],
      color: [.18 + (i % 3) * .15, .5, .65], properties: { Name: 'Smoke element ' + i, Source: 'synthetic-seed-192' } });
  }
  return parseModel({ version: 1, id: 'viewer-smoke-192', revision: 'baseline-1', coordinateSystem: 'right-handed-y-up-metres',
    grossFloorAreaM2: 150, cameraPath: [smokeCamera, ...Array.from({ length: 29 }, (_, index): Camera => {
      const angle = index / 29 * Math.PI * 2;
      return { eye: [6 + Math.cos(angle) * 22, 15, 4 + Math.sin(angle) * 22], target: smokeCamera.target };
    })], provenance: { kind: 'synthetic', seed: 192 }, geometries: [box], elements });
}
export const smokeCamera: Camera = { eye: [18, 15, 22], target: [6, .5, 4] };
export function smokeProposal(model: Model): Proposal {
  const first = model.elements[0]; const second = model.elements[1];
  if (!first || !second) throw new Error('Proposal replay needs at least two elements');
  return { id: 'smoke-proposal-1', baseRevision: model.revision, nextRevision: model.revision + '-proposal', remove: [second.id], upsert: [
    { ...first, position: [first.position[0], first.position[1] + 2, first.position[2]], properties: { ...first.properties, Review: 'Moved up 2 m' } },
    { ...second, id: 'proposal-added', position: [second.position[0], second.position[1], second.position[2] + 1] },
  ] };
}
