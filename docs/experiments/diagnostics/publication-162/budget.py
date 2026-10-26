"""Root inside the leased tools container; all historical mounts are read-only."""
import datetime
import json
import os
import pathlib
import re
import subprocess
import time

GIB = 1024 ** 3


def allocated(path):
    result = subprocess.run(['du', '-sx', '-B1', str(path)], capture_output=True, text=True,
                            timeout=8, env={**os.environ, 'LC_ALL': 'C'})
    warnings = result.stderr.splitlines()
    # A disappearing temporary file occupies no space after its removal.
    # Every other scan error invalidates the monitor instead of becoming zero.
    if result.returncode != 0 and (result.returncode != 1 or not warnings or
            not all(re.fullmatch(r"du: cannot access '.+': No such file or directory", line) for line in warnings)):
        raise RuntimeError('Allocation scan failed: ' + result.stderr)
    return int(result.stdout.split()[0]), warnings


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
    root = pathlib.Path('/e')
    while True:
        started = time.monotonic()
        try:
            aggregate, warnings = allocated('/all')
            new, new_warnings = allocated('/e')
            prepared, prepared_warnings = allocated('/prepared')
            ssd, hostroot = os.statvfs('/all'), os.statvfs('/host-root')
            memory = next(int(line.split()[1]) * 1024 for line in pathlib.Path('/proc/meminfo').read_text().splitlines()
                          if line.startswith('MemAvailable:'))
            row = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'unix': time.time(),
                   'aggregateBytes': aggregate, 'newBytes': new + prepared,
                   'ssdAvailableBytes': ssd.f_bavail * ssd.f_frsize,
                   'rootAvailableBytes': hostroot.f_bavail * hostroot.f_frsize,
                   'hostAvailableMemoryBytes': memory, 'scanSeconds': time.monotonic() - started,
                   'vanishedPathWarnings': warnings + new_warnings + prepared_warnings}
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
