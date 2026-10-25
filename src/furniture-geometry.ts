import type { Furniture, ModelSnapshot } from './room-model.ts';

export type ModelPoint = readonly [number, number, number];
export interface FurnitureFace {
  readonly points: readonly ModelPoint[];
  readonly fill: string;
  readonly stroke: string;
  readonly object: Furniture;
}

/** Low-detail product silhouettes, shared by every 3D view; no separate visual model state. */
export function furnitureFaces(item: Furniture, snapshot: ModelSnapshot): FurnitureFace[] {
  const support = snapshot.entities.find((entity) => entity.id === item.supportId);
  const elevation = support?.type === 'Furniture' ? support.height : 0;
  const angle = item.rotationDeg * Math.PI / 180;
  const transform = ([x, y, z]: ModelPoint): ModelPoint => [
    item.position[0] + x * Math.cos(angle) - y * Math.sin(angle),
    item.position[1] + x * Math.sin(angle) + y * Math.cos(angle), elevation + z,
  ];
  const faces: FurnitureFace[] = [];
  const face = (points: readonly ModelPoint[], fill: string): void => {
    faces.push({ points: points.map(transform), fill, stroke: '#334b4c', object: item });
  };
  const box = (x: number, y: number, z: number, width: number, depth: number, height: number, fill: string): void => {
    const a = x - width / 2; const b = x + width / 2; const c = y - depth / 2; const d = y + depth / 2;
    const top = z + height;
    face([[a, c, top], [b, c, top], [b, d, top], [a, d, top]], fill);
    face([[a, c, z], [b, c, z], [b, c, top], [a, c, top]], fill);
    face([[b, c, z], [b, d, z], [b, d, top], [b, c, top]], fill);
    face([[b, d, z], [a, d, z], [a, d, top], [b, d, top]], fill);
    face([[a, d, z], [a, c, z], [a, c, top], [a, d, top]], fill);
  };
  const { width: w, depth: d, height: h } = item;
  if (item.kind === 'desk' || item.kind === 'table') {
    const top = Math.min(0.055, h * .12);
    box(0, 0, h - top, w, d, top, item.kind === 'desk' ? '#d6b58c' : '#c69a73');
    for (const x of [-w * .41, w * .41]) for (const y of [-d * .37, d * .37]) {
      box(x, y, 0, w * .045, d * .075, h - top, '#5c686d');
    }
  } else if (item.kind === 'monitor') {
    box(0, 0, 0, w * .4, d, h * .045, '#53616a');
    box(0, 0, h * .045, w * .065, d * .3, h * .23, '#586b73');
    box(0, -d * .18, h * .25, w, d * .22, h * .75, '#293d4c');
    face([[-w * .46, -d * .065, h * .3], [w * .46, -d * .065, h * .3], [w * .46, -d * .065, h * .95], [-w * .46, -d * .065, h * .95]], '#69b7d0');
  } else if (item.kind === 'laptop') {
    box(0, 0, 0, w, d, h * .08, '#a2b3bd');
    box(0, d * .1, h * .08, w * .78, d * .55, h * .015, '#465d6d');
    box(0, -d * .45, h * .08, w, d * .09, h * .92, '#344b5c');
    face([[-w * .45, -d * .4, h * .16], [w * .45, -d * .4, h * .16], [w * .45, -d * .4, h * .95], [-w * .45, -d * .4, h * .95]], '#8ccbd4');
  } else if (item.kind === 'chair') {
    box(0, 0, h * .43, w * .85, d * .82, h * .08, '#527a86');
    box(0, -d * .38, h * .51, w * .85, d * .12, h * .49, '#527a86');
    box(0, 0, h * .09, w * .09, d * .09, h * .34, '#4b5961');
    box(0, 0, h * .04, w, d * .12, h * .05, '#4b5961');
    box(0, 0, h * .04, w * .12, d, h * .05, '#4b5961');
  } else if (item.kind === 'bed') {
    box(0, 0, 0, w, d, h * .45, '#c69a73');
    box(0, 0, h * .45, w * .96, d * .96, h * .4, '#e7e2d4');
    box(0, d * .08, h * .85, w * .97, d * .65, h * .05, '#6b9295');
    for (const x of [-w * .25, w * .25]) box(x, -d * .32, h * .85, w * .42, d * .2, h * .15, '#faf5e9');
  } else if (item.kind === 'sofa') {
    box(0, 0, 0, w, d, h * .32, '#557a7a');
    box(0, -d * .4, h * .32, w, d * .2, h * .68, '#557a7a');
    for (const x of [-w * .45, w * .45]) box(x, 0, h * .32, w * .1, d, h * .4, '#557a7a');
    for (const x of [-w * .22, w * .22]) box(x, d * .08, h * .32, w * .42, d * .68, h * .17, '#729594');
  } else if (item.kind === 'cabinet') {
    box(0, 0, 0, w, d, h * .95, '#c69a73');
    box(0, 0, h * .95, w, d, h * .05, '#d6d8d0');
    for (const x of [-w * .04, w * .04]) box(x, d * .505, h * .5, .015, .015, h * .12, '#53616a');
  } else {
    box(0, 0, 0, w * .55, d * .55, h * .28, '#bb8165');
    box(0, 0, h * .28, w * .045, d * .045, h * .55, '#547642');
    for (const [x, y, z] of [[0, 0, .92], [-.32, -.12, .7], [.3, .18, .66], [-.1, .32, .52]] as const) {
      const cx = x * w; const cy = y * d;
      face([[cx - w * .2, cy, h * (z - .16)], [cx, cy + d * .15, h * (z + .08)], [cx + w * .2, cy, h * (z - .05)], [cx, cy - d * .15, h * (z - .25)]], '#53885d');
      face([[cx, cy - d * .2, h * (z - .16)], [cx - w * .15, cy, h * (z + .08)], [cx, cy + d * .2, h * (z - .05)], [cx + w * .15, cy, h * (z - .25)]], '#74a46c');
    }
  }
  return faces;
}
