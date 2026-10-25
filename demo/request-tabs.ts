import type { RequestState } from './change-requests.ts';

export type RequestTab = 'review' | 'progress' | 'waiting' | 'finished';

export const REQUEST_TABS = [
  { id: 'review', label: 'Ready for review', description: 'Proposals to review, questions to answer and attempts that need your attention.', empty: 'Nothing needs your review right now.' },
  { id: 'progress', label: 'In progress', description: 'Agents are working on these requests. You can keep requesting changes.', empty: 'No agents are working on requests right now.' },
  { id: 'waiting', label: 'Waiting', description: 'Requests waiting for an agent or a ChatGPT connection.', empty: 'No requests are waiting to start.' },
  { id: 'finished', label: 'Completed / rejected', description: 'Accepted, rejected and cancelled requests, kept for reference.', empty: 'Completed, rejected and cancelled requests will appear here.' },
] satisfies { id: RequestTab; label: string; description: string; empty: string }[];

const stateTabs: Record<RequestState, RequestTab> = {
  ready: 'review', 'needs-input': 'review', failed: 'review',
  working: 'progress', queued: 'waiting',
  completed: 'finished', rejected: 'finished', cancelled: 'finished',
};

export function groupRequests<T extends { state: RequestState }>(requests: readonly T[]): Record<RequestTab, T[]> {
  const groups: Record<RequestTab, T[]> = { review: [], progress: [], waiting: [], finished: [] };
  for (const request of requests) groups[stateTabs[request.state]].push(request);
  return groups;
}
