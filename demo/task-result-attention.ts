import type { BacklogItem } from './spatial-tasks.ts';

export type TaskResultAttention = 'none' | 'unread' | 'viewed';
type ResultTask = Pick<BacklogItem, 'projectId' | 'id' | 'state' | 'attempts'> & { readonly request: Pick<BacklogItem['request'], 'requestId'> };
export type AttentionStorage = Pick<Storage, 'getItem' | 'setItem'>;

function outcomeVersion(ticket: ResultTask): string | null {
  // Decisions update updatedAt; they do not deliver another agent result.
  if (!['ready', 'needs-input', 'failed', 'rejected'].includes(ticket.state)) return null;
  return JSON.stringify([ticket.request.requestId, ticket.attempts]);
}

/** Per-browser viewing state, independent of server execution and acceptance. */
export class TaskResultAttentionStore {
  readonly #storage: AttentionStorage | undefined;
  readonly #seen = new Map<string, string>();
  constructor(storage?: AttentionStorage) { this.#storage = storage; }
  #key(ticket: ResultTask): string { return `bim-forge.task-result-viewed.v1:${JSON.stringify([ticket.projectId, ticket.id])}`; }
  attention(ticket: ResultTask): TaskResultAttention {
    const version = outcomeVersion(ticket); if (!version) return 'none';
    const key = this.#key(ticket);
    let seen = this.#seen.get(key);
    if (!seen) { try { seen = this.#storage?.getItem(key) ?? undefined; } catch { /* Session viewing remains available when storage is denied. */ } }
    return seen === version ? 'viewed' : 'unread';
  }
  markViewed(ticket: ResultTask): boolean {
    const version = outcomeVersion(ticket); if (!version || this.attention(ticket) === 'viewed') return false;
    const key = this.#key(ticket); this.#seen.set(key, version);
    try { this.#storage?.setItem(key, version); } catch { /* Keep the session result when storage is full or denied. */ }
    return true;
  }
}

export function browserAttentionStorage(): AttentionStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}
