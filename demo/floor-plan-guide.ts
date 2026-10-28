import { parseRequestSources, MAX_REQUEST_SOURCES } from '../src/request-sources.ts';
import type { RequestSource } from '../src/request-sources.ts';

export interface FloorMeasurement {
  source: RequestSource;
  page: number;
  feature: string;
  lengthMm: number;
  provenance: 'measured' | 'documented';
  basis: 'wall-centrelines' | 'clear-span';
}

export function drawingSources(sources: readonly RequestSource[]): RequestSource[] {
  return sources.filter(source => source.mediaType.startsWith('image/') || source.mediaType === 'application/pdf');
}

/** Confirmation is a user assertion, never proof of the drawing's accuracy. */
export function parseFloorMeasurement(input: unknown): FloorMeasurement {
  if (!input || typeof input !== 'object' || !('source' in input) || !('page' in input) || !('feature' in input)
      || !('lengthMm' in input) || !('provenance' in input) || !('basis' in input)) throw new Error('Confirm a known drawing dimension first.');
  const source = parseRequestSources([input.source])[0];
  if (!source || !drawingSources([source]).length) throw new Error('Choose an attached image or PDF.');
  if (typeof input.page !== 'number' || !Number.isSafeInteger(input.page) || input.page < 1
      || input.page > (source.mediaType === 'application/pdf' ? 4 : 1)) throw new Error('Choose a prepared page (PDF pages 1–4; images use page 1).');
  if (typeof input.feature !== 'string' || !input.feature.trim() || input.feature.trim().length > 100
      || /[\u0000-\u001f\u007f]/u.test(input.feature)) throw new Error('Name the measured feature in 1–100 characters.');
  if (typeof input.lengthMm !== 'number' || !Number.isSafeInteger(input.lengthMm) || input.lengthMm < 1 || input.lengthMm > 1000000)
    throw new Error('Enter a known length of 1–1,000,000 whole millimetres.');
  if (input.provenance !== 'measured' && input.provenance !== 'documented') throw new Error('Choose site measurement or drawing dimension.');
  if (input.basis !== 'wall-centrelines' && input.basis !== 'clear-span') throw new Error('Choose wall centrelines or clear span.');
  return { source, page: input.page, feature: input.feature.trim(), lengthMm: input.lengthMm, provenance: input.provenance, basis: input.basis };
}

export function floorMeasurementText(input: FloorMeasurement): string {
  const m = parseFloorMeasurement(input);
  return `User-confirmed floor-plan dimension (unverified reference evidence)\n${JSON.stringify(m, null, 2)}\n`
    + 'Only this feature is confirmed. Image proportions and other dimensions remain inferred. '
    + 'Report conflicting dimensions and unresolved assumptions; this confirmation does not resolve evidence history. '
    + 'One storey only, rectangular envelope tiled by 2–12 rectangular rooms. '
    + 'Disclose unsupported geometry and omissions. No construction accuracy or automatic acceptance.\n';
}

export function measurementMatches(m: FloorMeasurement, sources: readonly RequestSource[]): boolean {
  return sources.some(source => source.id === m.source.id && source.sha256 === m.source.sha256
    && source.name === m.source.name && source.mediaType === m.source.mediaType && source.byteLength === m.source.byteLength);
}

export function guidedFloorRequest(input: { instruction: string; sources: readonly RequestSource[];
  measurement: FloorMeasurement; note: RequestSource }) {
  const measurement = parseFloorMeasurement(input.measurement);
  if (!measurementMatches(measurement, input.sources)) throw new Error('The confirmed drawing changed or was removed. Confirm its dimension again.');
  if (input.sources.length >= MAX_REQUEST_SOURCES) throw new Error('Keep at most three files to leave room for the confirmed measurement.');
  if (input.note.mediaType !== 'text/plain' || input.note.byteLength !== new TextEncoder().encode(floorMeasurementText(measurement)).byteLength)
    throw new Error('The confirmed measurement attachment is invalid.');
  const sources = parseRequestSources([...input.sources, input.note]);
  const prompt = input.instruction.trim().replace(/\s+/gu, ' ') || 'Reconstruct the attached floor as a reviewable proposal.';
  const instruction = `${prompt} Known ${measurement.provenance} dimension (user confirmed, ${measurement.basis}): ${measurement.feature} = ${measurement.lengthMm} mm, ${measurement.source.name}, page ${measurement.page}. Other dimensions are inferred; explain contradictions, assumptions and unsupported geometry. Keep accepted geometry unchanged until I accept.`;
  if (instruction.length > 1000) throw new Error('Shorten the message to leave room for the confirmed dimension (1,000 characters total).');
  return { instruction, sources, authoringScope: 'floor-plan-reconstruction' as const };
}
