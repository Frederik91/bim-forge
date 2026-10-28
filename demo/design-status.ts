import type { DesignTarget } from '../src/design-targets.ts';

export function designSaveStatus(input: {
  name: string; target: DesignTarget; displayedRevisionId: string; serverRevisionId: string;
}): string {
  const revision = input.displayedRevisionId.slice(0, 10);
  if (input.target.kind === 'baseline') return `${input.name} · fixed baseline · ${revision}`;
  return input.displayedRevisionId === input.serverRevisionId
    ? `Saved · ${input.name} · ${revision}`
    : `${input.name} has an update · reopen the current design · your message is kept`;
}
