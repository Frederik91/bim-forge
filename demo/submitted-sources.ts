import type { RequestSource } from '../src/request-sources.ts';
import type { ProjectEvidenceClient } from './project-evidence-client.ts';

/** Sending a project message is the explicit retention action for its attachments. */
export async function retainSubmittedSources(input: {
  projectId: string; sources: readonly RequestSource[]; client: Pick<ProjectEvidenceClient, 'retain'>;
}): Promise<void> {
  for (const source of input.sources) await input.client.retain(input.projectId, source);
}
