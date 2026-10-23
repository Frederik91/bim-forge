// Disposable browser adapter. One repository record, published only on transaction completion.
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

function checkedRecord(record: unknown): RoomRecord {
  if (record === undefined) return { generation: 0, text: null };
  if (!record || typeof record !== 'object' || Array.isArray(record)
      || !Object.hasOwn(record, 'generation') || !Object.hasOwn(record, 'text')) {
    throw new RoomStoreError('The saved record is unreadable. It has been left intact. Local writes are blocked.', 'corrupt');
  }
  const generation = Reflect.get(record, 'generation');
  const text = Reflect.get(record, 'text');
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1 ||
      generation >= Number.MAX_SAFE_INTEGER || typeof text !== 'string') {
    throw new RoomStoreError('The saved record is unreadable. It has been left intact. Local writes are blocked.',
      'corrupt', typeof text === 'string' ? text : null);
  }
  return { generation, text };
}

export class RoomStore {
  #database: IDBDatabase;

  constructor(database: IDBDatabase) { this.#database = database; }

  static open(): Promise<RoomStore> {
    return new Promise<RoomStore>((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new RoomStoreError('Local storage is unavailable. This demo needs IndexedDB to save safely.'));
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
          try { result = checkedRecord(request.result); }
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

  // Read and conditional write share one readwrite transaction. Other tabs serialize here.
  // Resolves to the new generation only after the durable transaction has completed.
  saveCAS(text: string, expectedGeneration: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      if (typeof text !== 'string' || !text || new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES ||
          !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0 || expectedGeneration >= Number.MAX_SAFE_INTEGER - 1) {
        reject(new RoomStoreError('The project cannot be saved: invalid generation or JSON larger than 256 KiB.', 'invalid'));
        return;
      }
      let transaction: IDBTransaction;
      let failure: unknown;
      const nextGeneration = expectedGeneration + 1;
      try {
        transaction = this.#database.transaction(OBJECT_STORE, 'readwrite', { durability: 'strict' });
        const objectStore = transaction.objectStore(OBJECT_STORE);
        const request = objectStore.get(RECORD_KEY);
        request.onsuccess = () => {
          try {
            const current = checkedRecord(request.result);
            if (current.generation !== expectedGeneration) {
              throw new RoomStoreError('Another tab saved a newer project. This tab cannot overwrite it. The unsaved preview is still visible but is not included in saved-history exports. Record its dimensions before reloading; unsaved edits will be lost.', 'stale');
            }
            objectStore.put({ generation: nextGeneration, text }, RECORD_KEY);
          } catch (error) { failure = error; transaction.abort(); }
        };
      } catch {
        reject(new RoomStoreError('Local storage is unavailable for a durable save. The displayed project has not been replaced.'));
        return;
      }
      transaction.oncomplete = () => resolve(nextGeneration);
      transaction.onabort = () => reject(failure ?? new RoomStoreError('The local save failed, possibly because storage is full. The displayed project and saved data have not been replaced.'));
      transaction.onerror = () => { /* Abort owns rejection; a request succeeding is not a committed save. */ };
    });
  }

  close(): void { this.#database.close(); }
}
