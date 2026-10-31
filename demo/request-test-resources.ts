import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ChangeRequests } from './change-requests.ts';

/** Owns temporary stores until asynchronous worker and SQLite shutdown completes. */
export function temporaryRequestResources(test: TestContext, prefix: string) {
  const root = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(root, prefix));
  const queues: ChangeRequests[] = [];
  const databases: DatabaseSync[] = [];
  test.after(async () => {
    for (const queue of queues) await queue.close();
    for (const database of databases) if (database.isOpen) database.close();
    if (path.dirname(fs.realpathSync(directory)) !== root) {
      throw new Error('Temporary request directory moved outside its owned root.');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    async openQueue(...args: Parameters<typeof ChangeRequests.open>) {
      const queue = await ChangeRequests.open(...args);
      queues.push(queue);
      return queue;
    },
    openDatabase(...args: ConstructorParameters<typeof DatabaseSync>) {
      const database = new DatabaseSync(...args);
      databases.push(database);
      return database;
    },
  };
}
