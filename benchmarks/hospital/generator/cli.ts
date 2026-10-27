import process from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { bindingFor } from '../../../experiments/contracts/records.ts';
import { Dataset, loadProfile, parseOptions } from './profile.ts';
import { Graph } from './graph.ts';
import { createManifest } from './manifest.ts';
import { lines } from './rows.ts';

try {
  const options = parseOptions(process.argv.slice(2));
  const loaded = loadProfile(options.profile);
  const graph = new Graph(new Dataset(loaded.profile, loaded.sha256, options));
  if (options.table === 'manifest') {
    const implementation = [];
    for (const filename of ['profile.ts', 'graph.ts', 'rows.ts', 'manifest.ts', 'cli.ts', 'check.ts']) {
      implementation.push(await bindingFor(process.cwd(), `benchmarks/hospital/generator/${filename}`));
    }
    await pipeline(Readable.from([`${JSON.stringify({ ...createManifest(graph), implementation }, null, 2)}\n`]), process.stdout);
  } else {
    // Node pipeline enforces writable backpressure, propagates EPIPE and keeps stdout clean.
    await pipeline(Readable.from(lines(graph, options.table), { objectMode: false, highWaterMark: 64 * 1024 }), process.stdout);
  }
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Hospital generation failed.'}\n`);
  process.exitCode = 1;
}
