import type { RoomRepository } from '../src/room-model.ts';

export interface RepositoryReference {
  readonly projectId: string;
  readonly documentId: string;
}

export interface ProjectSummary {
  readonly projectId: string;
  readonly name: string;
  readonly headRevisionId: string;
  readonly recordedAt: number;
}

export interface ProjectHistoryEntry {
  readonly revisionId: string;
  readonly parentRevisionId: string | null;
  readonly changedEntityIds: readonly string[];
  readonly changedRelationshipIds: readonly string[];
  readonly recordedAt: number;
  readonly origin: 'created' | 'imported' | 'accepted';
  readonly requestId: string | null;
  readonly decisionId: string | null;
}

export interface ProjectHistoryPage {
  readonly entries: readonly ProjectHistoryEntry[];
  readonly nextCursor: string | null;
}

/** Shared connection: writes participate in the caller's acceptance transaction. */
export interface VersionedProjects {
  put(repository: RoomRepository): RepositoryReference;
  read(reference: RepositoryReference): string;
  current(projectId: string): RepositoryReference | null;
  publish(input: {
    projectId: string;
    expectedDocumentId: string | null;
    reference: RepositoryReference;
    origin: ProjectHistoryEntry['origin'];
    requestId: string | null;
    decisionId: string | null;
  }): void;
  list(input: { limit: number }): readonly ProjectSummary[];
  history(input: { projectId: string; before: string | null; limit: number }): ProjectHistoryPage;
}
