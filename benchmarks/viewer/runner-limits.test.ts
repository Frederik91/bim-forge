import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runCandidateProcess } from './runner-limits.ts';
import type { Result } from './metrics.ts';

async function outputDirectory(t: TestContext): Promise<string> {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-limits-'));
  t.after(() => fs.rm(output, { recursive: true, force: true }));
  return output;
}

test('one watchdog bounds hangs in every candidate phase including browser close', { timeout: 30000 }, async t => {
  for (const phase of ['launch', 'setup', 'replay', 'preview', 'comparison', 'inspect', 'discard', 'dispose', 'trace', 'close']) {
    const output = await outputDirectory(t); const started = Date.now();
    const passed = await runCandidateProcess({ candidate: 'babylon', output, timeoutMs: 1000, executable: process.execPath,
      args: ['-e', `process.send({phase:${JSON.stringify(phase)}}); setInterval(()=>{},1000);`],
    });
    assert.equal(passed, false, phase);
    const failure = JSON.parse(await fs.readFile(path.join(output, 'babylon-failure.json'), 'utf8'));
    assert.equal(failure.phase, phase); assert.equal(failure.qualified, false);
    assert.match(failure.error, /lifecycle timeout/); assert.deepEqual(failure.cleanupErrors, []);
    assert.ok(Date.now() - started < 5000, 'Hung candidate exceeded watchdog cleanup allowance');
  }
});

test('watchdog kills detached descendants even before launch reports a browser PID', { timeout: 10000 }, async t => {
  const output = await outputDirectory(t); const pidFile = path.join(output, 'descendant-pid');
  const script = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
    fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); process.send({phase:'launch'}); setInterval(()=>{},1000);`;
  assert.equal(await runCandidateProcess({ candidate: 'fragments', output, timeoutMs: 1500, executable: process.execPath, args: ['-e', script] }), false);
  const pid = Number(await fs.readFile(pidFile, 'utf8'));
  // A container init may briefly retain a killed process as a zombie.
  let alive = true;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      process.kill(pid, 0);
      if (process.platform === 'linux' && /^State:\s+Z/m.test(await fs.readFile('/proc/' + pid + '/status', 'utf8'))) { alive = false; break; }
    } catch { alive = false; break; }
    await delay(25);
  }
  assert.equal(alive, false, 'Detached browser descendant survived cleanup');
});

test('phase transitions do not restart the candidate deadline', { timeout: 6000 }, async t => {
  const output = await outputDirectory(t); const started = Date.now();
  assert.equal(await runCandidateProcess({ candidate: 'babylon', output, timeoutMs: 1500, executable: process.execPath,
    args: ['-e', "process.send({phase:'replay'}); setTimeout(()=>process.send({phase:'comparison'}),1000); setInterval(()=>{},1000);"],
  }), false);
  assert.ok(Date.now() - started < 2400, 'Deadline was restarted for a later phase');
  const failure = JSON.parse(await fs.readFile(path.join(output, 'babylon-failure.json'), 'utf8'));
  assert.equal(failure.phase, 'comparison');
});

test('premature exit and launch errors retain failure evidence; successful close does not', async t => {
  for (const script of ['process.exit(0)', 'process.exit(7)']) {
    const output = await outputDirectory(t);
    assert.equal(await runCandidateProcess({ candidate: 'babylon', output, timeoutMs: 2000, executable: process.execPath, args: ['-e', script] }), false);
    assert.match(await fs.readFile(path.join(output, 'babylon-failure.json'), 'utf8'), /before successful close/);
  }
  const bad = await outputDirectory(t);
  assert.equal(await runCandidateProcess({ candidate: 'babylon', output: bad, timeoutMs: 2000, executable: path.join(bad, 'absent'), args: [] }), false);
  assert.match(await fs.readFile(path.join(bad, 'babylon-failure.json'), 'utf8'), /ENOENT/);
  const good = await outputDirectory(t); const started = Date.now();
  assert.equal(await runCandidateProcess({ candidate: 'babylon', output: good, timeoutMs: 10000, executable: process.execPath,
    args: ['-e', "process.send({phase:'completed'}); process.disconnect();"],
  }), true);
  assert.ok(Date.now() - started < 5000, 'Success left the deadline timer running');
  await assert.rejects(fs.access(path.join(good, 'babylon-failure.json')));
});

test('real browser evaluations hanging after replay are terminated with failed evidence', {
  skip: !process.env.VIEWER_BENCHMARK_BROWSER_TESTS, timeout: 120000,
}, async t => {
  // A deliberately labelled result fixture isolates lifecycle handling from GPU
  // and engine behavior. These temporary artifacts are not benchmark measurements.
  const operations = ['load', 'select', 'properties', 'pick', 'filter', 'section', 'proposal', 'comparison', 'comparison-exit', 'discard'];
  const result: Result = { version: 1, candidate: 'babylon', profile: 'viewer-192-v1', purpose: 'setup-smoke', status: 'completed', qualified: false,
    reviewCycles: 1, samples: operations.map(operation => ({ operation, durationMs: 0, drawCalls: 0, triangles: 0 })), frameIntervalsMs: [1],
    checks: [...operations, 'renderer-readback', 'stale-rejected', ...Array.from({ length: 4 }, () => 'accepted-immutable')],
    limitations: ['Lifecycle test fixture; no engine, geometry, or performance evidence'], error: null,
    environment: { userAgent: 'fixture', hardwareConcurrency: 1, renderer: 'fixture', viewport: [16, 16], devicePixelRatio: 1 } };
  for (const phase of ['preview', 'comparison', 'inspect', 'discard', 'dispose']) {
    const output = await outputDirectory(t);
    const method = phase === 'comparison' ? 'compare' : phase;
    const server = createServer((_, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<canvas width="16" height="16"></canvas><script>
        window.viewerBenchmark={run:async()=>(${JSON.stringify(result)}),preview:async()=>{},compare:async()=>{},
          inspect:async()=>({}),discard:async()=>{},dispose:async()=>{},
          focusReview:async(stage)=>{const ctx=document.querySelector('canvas').getContext('2d');
            ctx.fillStyle=stage==='preview'?'blue':stage==='comparison'?'green':'red';ctx.fillRect(0,0,16,16);return{};}};
        window.viewerBenchmark[${JSON.stringify(method)}]=()=>new Promise(()=>{});
      </script>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address');
      const passed = await runCandidateProcess({ candidate: 'babylon', output, timeoutMs: 15000, executable: process.execPath,
        args: [fileURLToPath(new URL('./runner-candidate.ts', import.meta.url)), JSON.stringify({
          candidate: 'babylon', url: 'http://127.0.0.1:' + address.port, output, channel: process.env.VIEWER_BENCHMARK_CHANNEL ?? '', headed: false, cycles: 1, timeout: 15000,
        })],
      });
      assert.equal(passed, false);
      const failure = JSON.parse(await fs.readFile(path.join(output, 'babylon-failure.json'), 'utf8'));
      assert.equal(failure.phase, phase); assert.match(failure.error, /lifecycle timeout/);
      assert.equal(failure.qualified, false); assert.deepEqual(failure.cleanupErrors, []);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});
