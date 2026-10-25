export const ACTIVITY_STAGES = {
  queued: 'Queued', started: 'Agent started', inspecting: 'Inspecting model', validating: 'Testing a proposal',
  validated: 'Validation passed', 'validation-failed': 'Validation failed', submitting: 'Preparing review',
  declined: 'Clarification needed', ready: 'Ready for review', 'needs-input': 'Needs your input',
  failed: 'Attempt failed', cancelled: 'Cancelled', completed: 'Accepted', rejected: 'Rejected', recovered: 'Server recovery',
};
export type ActivityStage = keyof typeof ACTIVITY_STAGES;
export interface ActivityUpdate { stage: ActivityStage; message: string }
export interface RequestActivity extends ActivityUpdate { sequence: number; requestId: string; attempt: number; at: number }

function isStage(value: unknown): value is ActivityStage { return typeof value === 'string' && Object.hasOwn(ACTIVITY_STAGES, value); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** Network/storage boundary. Old tickets deliberately have no fabricated activity history. */
export function parseRequestActivity(value: unknown): readonly RequestActivity[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 96) throw new Error('Invalid request activity.');
  let sequence = 0;
  return value.map((item: unknown) => {
    if (!object(item) || !isStage(item.stage) || typeof item.message !== 'string' || item.message.length > 300
      || typeof item.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item.requestId)
      || typeof item.sequence !== 'number' || !Number.isSafeInteger(item.sequence) || item.sequence <= sequence
      || typeof item.attempt !== 'number' || !Number.isSafeInteger(item.attempt) || item.attempt < 0 || item.attempt > 3
      || typeof item.at !== 'number' || !Number.isSafeInteger(item.at) || item.at < 0) throw new Error('Invalid request activity event.');
    sequence = item.sequence;
    return { stage: item.stage, message: item.message, requestId: item.requestId, sequence, at: item.at, attempt: item.attempt };
  });
}
