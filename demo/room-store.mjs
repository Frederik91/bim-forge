// Disposable browser adapter. One repository record, published only on transaction completion.
const DATABASE = 'bim-forge-room-demo';
const OBJECT_STORE = 'project';
const RECORD_KEY = 'active';
export const MAX_PROJECT_BYTES = 256 * 1024;

export class RoomStoreError extends Error {
  constructor(message, code = 'storage', savedText = null) {
    super(message);
    this.name = 'RoomStoreError';
    this.code = code;
    this.savedText = savedText;
  }
}

function checkedRecord(record) {
  if (record === undefined) return { generation: 0, text: null };
  if (!record || !Number.isSafeInteger(record.generation) || record.generation < 1 ||
      record.generation >= Number.MAX_SAFE_INTEGER || typeof record.text !== 'string') {
    throw new RoomStoreError('The saved record is unreadable. It has been left intact. Local writes are blocked.',
      'corrupt', typeof record?.text === 'string' ? record.text : null);
  }
  return { generation: record.generation, text: record.text };
}

export class RoomStore {
  #database;

  constructor(database) { this.#database = database; }

  static open() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new RoomStoreError('Local storage is unavailable. This demo needs IndexedDB to save safely.'));
        return;
      }
      let request;
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

  load() {
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let failure;
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
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? new RoomStoreError('Reading local storage failed. Your saved project has been left intact.'));
      transaction.onerror = () => { /* The abort handler reports the final transaction failure. */ };
    });
  }

  // Read and conditional write share one readwrite transaction. Other tabs serialize here.
  // Resolves to the new generation only after the durable transaction has completed.
  saveCAS(text, expectedGeneration) {
    return new Promise((resolve, reject) => {
      if (typeof text !== 'string' || !text || new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES ||
          !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0 || expectedGeneration >= Number.MAX_SAFE_INTEGER - 1) {
        reject(new RoomStoreError('The project cannot be saved: invalid generation or JSON larger than 256 KiB.', 'invalid'));
        return;
      }
      let transaction;
      let failure;
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

  close() { this.#database.close(); }
}
