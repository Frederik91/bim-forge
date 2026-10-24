import type { Point } from './room-model.ts';

export interface ModelViewCamera {
  readonly yaw: number;
  readonly pitch: number;
  readonly zoom: number;
  readonly pan: readonly [number, number];
}

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
}

export const DEFAULT_MODEL_VIEW_CAMERA: ModelViewCamera = Object.freeze({
  yaw: -0.72,
  pitch: 0.82,
  zoom: 56,
  pan: Object.freeze([0, 12] as Point),
});

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
  return value;
}

export function modelViewCamera(input: ModelViewCamera): ModelViewCamera {
  return Object.freeze({
    yaw: finite(input.yaw, 'Camera yaw'),
    pitch: clamp(finite(input.pitch, 'Camera pitch'), 0.18, 1.42),
    zoom: clamp(finite(input.zoom, 'Camera zoom'), 24, 180),
    pan: Object.freeze([finite(input.pan[0], 'Camera pan X'), finite(input.pan[1], 'Camera pan Y')] as Point),
  });
}

export function orbitModelView(camera: ModelViewCamera, delta: Point): ModelViewCamera {
  return modelViewCamera({ ...camera, yaw: camera.yaw + delta[0] * 0.008, pitch: camera.pitch + delta[1] * 0.008 });
}

export function panModelView(camera: ModelViewCamera, delta: Point): ModelViewCamera {
  return modelViewCamera({ ...camera, pan: [camera.pan[0] + delta[0], camera.pan[1] + delta[1]] });
}

export function zoomModelView(camera: ModelViewCamera, wheelDelta: number): ModelViewCamera {
  return modelViewCamera({ ...camera, zoom: camera.zoom * Math.exp(-finite(wheelDelta, 'Zoom delta') * 0.001) });
}

export function projectModelPoint(
  point: readonly [number, number, number],
  camera: ModelViewCamera,
  centre: Point,
): ProjectedPoint {
  const [x, y, z] = point;
  for (const [value, name] of [[x, 'Model X'], [y, 'Model Y'], [z, 'Model Z']] as const) finite(value, name);
  const cosYaw = Math.cos(camera.yaw); const sinYaw = Math.sin(camera.yaw);
  const horizontal = x * cosYaw - y * sinYaw;
  const depthOnPlan = x * sinYaw + y * cosYaw;
  const cosPitch = Math.cos(camera.pitch); const sinPitch = Math.sin(camera.pitch);
  const vertical = z * sinPitch - depthOnPlan * cosPitch;
  const depth = z * cosPitch + depthOnPlan * sinPitch;
  return Object.freeze({
    x: centre[0] + camera.pan[0] + horizontal * camera.zoom,
    y: centre[1] + camera.pan[1] - vertical * camera.zoom,
    depth,
  });
}
