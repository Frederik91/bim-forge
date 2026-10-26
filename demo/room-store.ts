import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { RoomRepository } from '../src/room-model.ts';
import type { ProjectSummary, ProjectHistoryPage } from './versioned-project-contract.ts';

// Legacy browser bytes are read-only recovery material. Accepted state lives on the server.
const DATABASE = 'bim-forge-room-demo';
const OBJECT_STORE = 'project';
const RECORD_KEY = 'active';
export const MAX_PROJECT_BYTES = 256 * 1024;

export interface RoomRecord {
  generation: number;
  text: string | null;
}

export class RoomStoreError extends Error {
  readonly code: string;
  readonly savedText: string | null;

  constructor(message: string, code = 'storage', savedText: string | null = null) {
    super(message);
    this.name = 'RoomStoreError';
    this.code = code;
    this.savedText = savedText;
  }
}

function recoveryRecordText(record: unknown): string | null {
  if (record !== null && typeof record === 'object' && 'text' in record && typeof record.text === 'string') return record.text;
  try { return JSON.stringify(record) ?? null; } catch { return null; }
}

export function parseLegacyRecord(record: unknown): RoomRecord {
  if (record === undefined) return { generation: 0, text: null };
  if (!record || typeof record !== 'object' || Array.isArray(record)
      || !('generation' in record) || !('text' in record)
      || !Object.hasOwn(record, 'generation') || !Object.hasOwn(record, 'text')) {
    throw new RoomStoreError('The browser recovery record is unreadable and has been left intact.', 'corrupt', recoveryRecordText(record));
  }
  const generation = record.generation;
  const text = record.text;
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1 ||
      generation >= Number.MAX_SAFE_INTEGER || typeof text !== 'string') {
    throw new RoomStoreError('The browser recovery record is unreadable and has been left intact.',
      'corrupt', recoveryRecordText(record));
  }
  return { generation, text };
}

export class RoomStore {
  #database: IDBDatabase;

  constructor(database: IDBDatabase) { this.#database = database; }

  static open(): Promise<RoomStore> {
    return new Promise<RoomStore>((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new RoomStoreError('Browser recovery storage is unavailable. Server projects can still be opened.'));
        return;
      }
      let request: IDBOpenDBRequest;
      let settled = false;
      try { request = indexedDB.open(DATABASE, 1); }
      catch { reject(new RoomStoreError('Local storage could not be opened. Check browser storage permissions.')); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE);
      };
      request.onblocked = () => {
        settled = true;
        reject(new RoomStoreError('Opening local storage is blocked by another tab. Close other demo tabs and reload.'));
      };
      request.onerror = () => {
        settled = true;
        reject(new RoomStoreError('Local storage could not be opened. Your saved data has not been reset.'));
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) { database.close(); return; }
        settled = true;
        database.onversionchange = () => database.close();
        resolve(new RoomStore(database));
      };
    });
  }

  load(): Promise<RoomRecord> {
    return new Promise<RoomRecord>((resolve, reject) => {
      let transaction: IDBTransaction;
      let result: RoomRecord | undefined;
      let failure: unknown;
      try {
        transaction = this.#database.transaction(OBJECT_STORE, 'readonly');
        const request = transaction.objectStore(OBJECT_STORE).get(RECORD_KEY);
        request.onsuccess = () => {
          try { result = parseLegacyRecord(request.result); }
          catch (error) { failure = error; transaction.abort(); }
        };
      } catch {
        reject(new RoomStoreError('The saved project could not be read. Reload to retry; no data has been changed.'));
        return;
      }
      transaction.oncomplete = () => {
        if (!result) { reject(new RoomStoreError('Reading local storage failed. Your saved project has been left intact.')); return; }
        resolve(result);
      };
      transaction.onabort = () => reject(failure ?? new RoomStoreError('Reading local storage failed. Your saved project has been left intact.'));
      transaction.onerror = () => { /* The abort handler reports the final transaction failure. */ };
    });
  }

  close(): void { this.#database.close(); }
}

const id = Type.String({ minLength: 1, maxLength: 256 });
const nullableId = Type.Union([id, Type.Null()]);
const recordedAt = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const ProjectListSchema = Type.Object({ projects: Type.Array(Type.Object({
  projectId: id, name: Type.String({ minLength: 1, maxLength: 80 }), headRevisionId: id, recordedAt,
}), { maxItems: 32 }) });
const ProjectSchema = Type.Object({ project: Type.String({ minLength: 1 }) });
const HistorySchema = Type.Object({ entries: Type.Array(Type.Object({
  revisionId: id, parentRevisionId: nullableId,
  changedEntityIds: Type.Array(id), changedRelationshipIds: Type.Array(id), recordedAt,
  origin: Type.Union([Type.Literal('created'), Type.Literal('imported'), Type.Literal('accepted')]),
  requestId: nullableId, decisionId: nullableId,
}), { maxItems: 50 }), nextCursor: nullableId });

export class ProjectServerError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message); this.name = 'ProjectServerError'; this.status = status;
  }
}

// Direct HTTP boundary for the fixed project API. No client-side accepted-state writes.
export class ProjectClient {
  readonly #fetch: typeof fetch;
  constructor(request: typeof fetch = (input, options) => globalThis.fetch(input, options)) { this.#fetch = request; }

  async #json(path: string, options: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try { response = await this.#fetch(path, { ...options, cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
    catch { throw new ProjectServerError('Server disconnected. Reconnect and retry; no offline acceptance or sync is available.'); }
    if (!response.ok) throw new ProjectServerError(`Project server refused the request (HTTP ${response.status}). Retry or export recovery data.`, response.status);
    let text: string;
    try { text = await response.text(); }
    catch { throw new ProjectServerError('Server response was interrupted. Reconnect and reopen the latest accepted project.'); }
    if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES * 6 + 1024) throw new ProjectServerError('Project server response exceeds the bounded demo limit.');
    try { const value: unknown = JSON.parse(text); return value; }
    catch { throw new ProjectServerError('Project server returned unreadable JSON.'); }
  }

  async list(): Promise<readonly ProjectSummary[]> {
    const value = await this.#json('/api/projects');
    if (!Check(ProjectListSchema, value) || new Set(value.projects.map(project => project.projectId)).size !== value.projects.length) {
      throw new ProjectServerError('Project server returned an invalid saved-project list.');
    }
    return value.projects;
  }

  async #repository(value: unknown, expected: { projectId: string; root?: string }): Promise<RoomRepository> {
    if (!Check(ProjectSchema, value)) throw new ProjectServerError('Project server returned an invalid project envelope.');
    let project: RoomRepository;
    try { project = await RoomRepository.restore(value.project); }
    catch (error) { throw new ProjectServerError(`Project server returned an invalid model: ${error instanceof Error ? error.message : 'validation failed'}`); }
    if (project.projectId !== expected.projectId || (expected.root !== undefined && project.root() !== expected.root)) {
      throw new ProjectServerError('Project server returned a different project identity or original revision.');
    }
    return project;
  }

  async read(projectId: string): Promise<RoomRepository> {
    return this.#repository(await this.#json(`/api/projects/${encodeURIComponent(projectId)}`), { projectId });
  }

  async reopen(input: { rememberedProjectId: string | null; choices: readonly ProjectSummary[] }): Promise<RoomRepository | null> {
    const candidates = new Set([
      ...(input.rememberedProjectId === null ? [] : [input.rememberedProjectId]),
      ...input.choices.map(choice => choice.projectId),
    ]);
    for (const projectId of candidates) {
      try { return await this.read(projectId); }
      catch (error) {
        if (!(error instanceof ProjectServerError) || error.status !== 404) throw error;
      }
    }
    return null;
  }

  async register(project: RoomRepository): Promise<RoomRepository> {
    const value = await this.#json('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: project.serialize() }) });
    // The returned accepted head wins, including when an older browser import was supplied.
    return this.#repository(value, { projectId: project.projectId, root: project.root() });
  }

  async history(projectId: string, before: string | null = null, limit = 20): Promise<ProjectHistoryPage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('History page size must be between 1 and 50.');
    const query = new URLSearchParams({ limit: String(limit) });
    if (before !== null) query.set('before', before);
    const value = await this.#json(`/api/projects/${encodeURIComponent(projectId)}/history?${query}`);
    if (!Check(HistorySchema, value) || value.entries.length > limit) throw new ProjectServerError('Project server returned an invalid history page.');
    const seen = new Set<string>();
    for (const [index, entry] of value.entries.entries()) {
      if (entry.revisionId === before || seen.has(entry.revisionId) || (index > 0 && value.entries[index - 1]?.parentRevisionId !== entry.revisionId)) {
        throw new ProjectServerError('Project server returned inconsistent history ancestry.');
      }
      seen.add(entry.revisionId);
    }
    const last = value.entries.at(-1);
    if (value.nextCursor !== null && (!last || last.revisionId !== value.nextCursor || last.parentRevisionId === null)) {
      throw new ProjectServerError('Project server returned an invalid history cursor.');
    }
    return value;
  }
}
