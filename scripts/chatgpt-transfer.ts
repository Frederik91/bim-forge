import fs from 'node:fs/promises';
import path from 'node:path';
import { ChatGPTPlanConnection } from '../src/chatgpt-plan.ts';

const MAX_TRANSFER_BYTES = 256 * 1024;

interface TransferArguments {
  command: 'host-id' | 'bootstrap' | 'import';
  storageFile: string;
}

function parseArguments(values: readonly string[]): TransferArguments {
  const [command, flag, storageFile, ...extra] = values;
  if ((command !== 'host-id' && command !== 'bootstrap' && command !== 'import') || flag !== '--storage-file' || !storageFile || extra.length) {
    throw new Error('Usage: chatgpt-transfer.ts <host-id|bootstrap|import> --storage-file <absolute-path>');
  }
  if (!storageFile.startsWith('/') || storageFile.includes('\0')) throw new Error('The credential storage path must be absolute.');
  return { command, storageFile };
}

async function readBoundedInput(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_TRANSFER_BYTES) throw new Error('The ChatGPT credential transfer exceeds 256 KiB.');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('The ChatGPT credential transfer is not valid JSON.'); }
}

const args = parseArguments(process.argv.slice(2));
await fs.mkdir(path.dirname(args.storageFile), { recursive: true, mode: 0o700 });
const connection = await ChatGPTPlanConnection.open({ storageFile: args.storageFile });
if (args.command === 'host-id') {
  process.stdout.write(`${connection.hostId()}\n`);
} else if (args.command === 'bootstrap') {
  process.stdout.write(`${JSON.stringify(connection.pairingBootstrap())}\n`);
} else {
  const session = await connection.importCredentialTransfer(await readBoundedInput());
  process.stdout.write(`${JSON.stringify({
    connected: session.connected,
    sharing: session.sharing,
    account: session.account,
    selectedModel: session.selectedModel,
  })}\n`);
}
