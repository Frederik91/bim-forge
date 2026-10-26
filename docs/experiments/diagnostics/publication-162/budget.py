"""Root inside the leased tools container; all historical mounts are read-only."""
import datetime
import json
import os
import pathlib
import re
import subprocess
import time

GIB = 1024 ** 3
ROOT = pathlib.Path('/e')


def allocated(path):
    failures = []
    for attempt in range(1, 4):
        started = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            result = subprocess.run(['du', '-sx', '-B1', str(path)], capture_output=True, text=True,
                                    timeout=8, env={**os.environ, 'LC_ALL': 'C'})
        except subprocess.TimeoutExpired:
            failures.append({'attempt': attempt, 'error': 'Eight-second scan timeout'})
            continue
        if result.returncode != 0:
            # Discard all stdout from an incomplete scan, including ENOENT races.
            failures.append({'attempt': attempt, 'exitCode': result.returncode, 'error': result.stderr})
            continue
        if result.stderr:
            raise RuntimeError('Successful allocation scan emitted an unexpected diagnostic: ' + result.stderr)
        match = re.fullmatch(r'([0-9]+)\t' + re.escape(str(path)) + r'\n?', result.stdout)
        if match is None:
            raise RuntimeError('Malformed successful allocation scan output for ' + str(path))
        return int(match.group(1)), {'attempt': attempt, 'startedAt': started,
            'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'failedAttempts': failures}
    raise RuntimeError('No complete successful allocation scan after three attempts: ' + json.dumps(failures))


def breaches(row):
    # Stop ahead of the absolute 10/200 GiB and 100/4/1 GiB limits.
    return [name for name, bad in {
        'additional-allocation-headroom': row['newBytes'] >= 8 * GIB,
        'aggregate-allocation-headroom': row['aggregateBytes'] >= 198 * GIB,
        'ssd-reserve-headroom': row['ssdAvailableBytes'] < 101 * GIB,
        'root-reserve-headroom': row['rootAvailableBytes'] < 5 * GIB,
        'host-memory-headroom': row['hostAvailableMemoryBytes'] < 5 * GIB // 4,
    }.items() if bad]


def main():
    root = ROOT
    while True:
        started = time.monotonic()
        try:
            aggregate, aggregate_scan = allocated('/all')
            new, new_scan = allocated('/e')
            prepared, prepared_scan = allocated('/prepared')
            ssd, hostroot = os.statvfs('/all'), os.statvfs('/host-root')
            memory = next(int(line.split()[1]) * 1024 for line in pathlib.Path('/proc/meminfo').read_text().splitlines()
                          if line.startswith('MemAvailable:'))
            row = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'unix': time.time(),
                   'aggregateBytes': aggregate, 'newBytes': new + prepared,
                   'ssdAvailableBytes': ssd.f_bavail * ssd.f_frsize,
                   'rootAvailableBytes': hostroot.f_bavail * hostroot.f_frsize,
                   'hostAvailableMemoryBytes': memory, 'scanSeconds': time.monotonic() - started,
                   'completeScans': {'aggregate': aggregate_scan, 'run': new_scan, 'preparation': prepared_scan}}
            if row['scanSeconds'] > 10:
                raise RuntimeError('Budget scan exceeded freshness envelope')
            row['breaches'] = breaches(row)
            temporary = root / 'budget-next.json'
            temporary.write_text(json.dumps(row) + '\n')
            temporary.replace(root / 'budget.json')
            with (root / 'budget.ndjson').open('a') as stream:
                stream.write(json.dumps(row) + '\n')
            if row['breaches']:
                return 42
        except Exception as error:
            (root / 'budget-error.json').write_text(json.dumps({'error': str(error), 'unix': time.time()}) + '\n')
            return 43
        time.sleep(1)


if __name__ == '__main__':
    raise SystemExit(main())
