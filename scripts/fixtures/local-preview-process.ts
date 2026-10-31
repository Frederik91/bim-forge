import { runSpatialPreview } from '../serve-spatial-preview.ts';
import type { SpatialPreviewDependencies } from '../serve-spatial-preview.ts';

const session = { status: 'disconnected', connected: false, account: null, models: [], selectedModel: null } as const;
let releaseCleanup: (() => void) | undefined;
const connection: NonNullable<SpatialPreviewDependencies['connection']> = {
  publicSession: () => session,
  async startDeviceLogin() { throw new Error('Offline lifecycle fixture cannot sign in.'); },
  async cancelDeviceLogin() { return session; },
  async refreshModels() { return session; },
  async selectModel() { return session; },
  async signOut() { return session; },
  modelWorker() { throw new Error('Offline lifecycle fixture cannot call a provider.'); },
  async close() {
    process.send?.({ event: 'account-closing' });
    await new Promise<void>(resolve => { releaseCleanup = resolve; });
    process.send?.({ event: 'account-closed' });
    process.disconnect?.();
  },
};
process.on('message', message => {
  if (message === 'SIGINT' || message === 'SIGTERM') process.emit(message);
  if (message === 'release-cleanup') releaseCleanup?.();
});
const preview = await runSpatialPreview(process.argv.slice(2), { connection });
process.send?.(preview.receipt);
