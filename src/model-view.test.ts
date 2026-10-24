import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL_VIEW_CAMERA,
  modelViewCamera,
  orbitModelView,
  panModelView,
  projectModelPoint,
  zoomModelView,
} from './model-view.ts';

test('orbit, pan and zoom produce bounded immutable camera state', () => {
  const orbit = orbitModelView(DEFAULT_MODEL_VIEW_CAMERA, [20, -20]);
  const pan = panModelView(orbit, [15, -8]);
  const zoom = zoomModelView(pan, -300);
  assert.notDeepEqual(orbit, DEFAULT_MODEL_VIEW_CAMERA);
  assert.deepEqual(pan.pan, [15, 4]);
  assert.ok(zoom.zoom > pan.zoom);
  assert.ok(Object.isFrozen(zoom));
  assert.ok(Object.isFrozen(zoom.pan));
  assert.deepEqual(DEFAULT_MODEL_VIEW_CAMERA.pan, [0, 12]);
  assert.equal(modelViewCamera({ ...zoom, pitch: -10 }).pitch, 0.18);
  assert.equal(modelViewCamera({ ...zoom, zoom: 1000 }).zoom, 180);
});

test('projection is deterministic and camera-only navigation never changes model coordinates', () => {
  const point = [6, 4, 3] as const;
  const first = projectModelPoint(point, DEFAULT_MODEL_VIEW_CAMERA, [400, 250]);
  const second = projectModelPoint(point, DEFAULT_MODEL_VIEW_CAMERA, [400, 250]);
  const moved = projectModelPoint(point, orbitModelView(DEFAULT_MODEL_VIEW_CAMERA, [40, 0]), [400, 250]);
  assert.deepEqual(first, second);
  assert.notDeepEqual(moved, first);
  assert.deepEqual(point, [6, 4, 3]);
});

test('camera and projection reject non-finite values', () => {
  assert.throws(() => modelViewCamera({ ...DEFAULT_MODEL_VIEW_CAMERA, zoom: Number.NaN }), /finite/);
  assert.throws(() => zoomModelView(DEFAULT_MODEL_VIEW_CAMERA, Number.POSITIVE_INFINITY), /finite/);
  assert.throws(() => projectModelPoint([0, Number.NaN, 0], DEFAULT_MODEL_VIEW_CAMERA, [0, 0]), /finite/);
});
