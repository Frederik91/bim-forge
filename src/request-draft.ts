import { validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';

/** Tentative display data. Never a proposal identity or acceptance capability. */
export interface RequestDraft {
  readonly ticketId: string;
  readonly requestId: string;
  readonly baseRevisionId: string;
  readonly attempt: number;
  readonly sequence: number;
  readonly snapshot: ModelSnapshot;
}

/** Parse the `draft` field of GET /api/change-requests/:id/draft. */
export function parseRequestDraft(value: unknown): RequestDraft | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request draft.');
  const keys = ['ticketId', 'requestId', 'baseRevisionId', 'attempt', 'sequence', 'snapshot'];
  if (Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))
      || !('ticketId' in value) || typeof value.ticketId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.ticketId)
      || !('requestId' in value) || typeof value.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.requestId)
      || !('baseRevisionId' in value) || typeof value.baseRevisionId !== 'string' || !/^[a-f0-9]{64}$/.test(value.baseRevisionId)
      || !('attempt' in value) || typeof value.attempt !== 'number' || !Number.isSafeInteger(value.attempt) || value.attempt < 1 || value.attempt > 3
      || !('sequence' in value) || typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence < 1
      || !('snapshot' in value)) throw new Error('Invalid request draft binding.');
  return { ticketId: value.ticketId, requestId: value.requestId, baseRevisionId: value.baseRevisionId,
    attempt: value.attempt, sequence: value.sequence, snapshot: validateSnapshot(value.snapshot) };
}
