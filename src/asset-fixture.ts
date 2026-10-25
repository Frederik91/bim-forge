import { parseAssetFamily, parseAssetInstance } from './asset-family.ts';
import type { AssetEdit, AssetFamily, AssetInstance } from './asset-family.ts';

export function personFamily(): AssetFamily {
  return parseAssetFamily({ id: 'standing-person', type: 'AssetFamily', name: 'Standing person proxy',
    description: 'AI-authored conceptual standing figure from normalized primitives; no anatomical or ergonomic certification.',
    parts: [
      { id: 'torso', kind: 'box', min: [.2, .2, .35], size: [.6, .6, .4], color: '#507a92' },
      { id: 'head', kind: 'ellipsoid', min: [.3, .2, .75], size: [.4, .6, .25], color: '#c99d7e' },
      { id: 'left-arm', kind: 'cylinder', min: [0, .35, .35], size: [.2, .3, .4], color: '#507a92' },
      { id: 'right-arm', kind: 'cylinder', min: [.8, .35, .35], size: [.2, .3, .4], color: '#507a92' },
      { id: 'left-leg', kind: 'box', min: [.2, 0, 0], size: [.25, 1, .35], color: '#334454' },
      { id: 'right-leg', kind: 'box', min: [.55, 0, 0], size: [.25, 1, .35], color: '#334454' },
    ] });
}

export function personInstance(id = 'person-187', height = 1.87, placement: AssetInstance['placement'] = { kind: 'single-room' }): AssetInstance {
  return parseAssetInstance({ id, type: 'AssetInstance', name: 'Person ' + height + ' m', familyId: 'standing-person',
    position: [1, 2], rotationDeg: 0, size: { width: .5, depth: .3, height }, placement });
}

/** Two sizes reuse one family; the unrelated plinth exercises generic rendering. */
export function assetFixtureEdit(): AssetEdit {
  const plinth = parseAssetFamily({ id: 'generated-plinth', type: 'AssetFamily', name: 'Generated display plinth',
    description: 'Concept proxy for a display plinth; dimensions require human review.', parts: [
      { id: 'base', kind: 'box', min: [0, 0, 0], size: [1, 1, .4], color: '#ad9170' },
      { id: 'column', kind: 'cylinder', min: [.2, .2, .4], size: [.6, .6, .6], color: '#788c8a' },
    ] });
  const shorter = personInstance('person-165', 1.65); shorter.position = [2, 2.2];
  return { families: [personFamily(), plinth], instances: [personInstance(), shorter,
    parseAssetInstance({ id: 'plinth-one', type: 'AssetInstance', name: 'Display plinth', familyId: plinth.id,
      position: [4.5, 2.5], rotationDeg: 0, size: { width: .4, depth: .4, height: .8 }, placement: { kind: 'single-room' } }),
  ], removeInstanceIds: [] };
}
