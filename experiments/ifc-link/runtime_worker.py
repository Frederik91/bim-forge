"""Private-spool IFC sidecar. Run in the network:none container described in deploy/ifc-link."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import signal
import stat
import subprocess
import sys
import time

UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")
REVISION = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")


def atomic(filename, value):
    temporary = filename.with_suffix('.tmp')
    temporary.write_text(json.dumps(value))
    temporary.replace(filename)


def bounded(filename, limit):
    descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise ValueError('Worker input exceeds budget')
        content = stream.read(limit + 1)
        if len(content) > limit:
            raise ValueError('Worker input exceeds budget')
        return content


def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024**2, 8 * 1024**2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def terminate(process):
    # The leader may have exited while its descendants still occupy the group.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def supervise(directory, command, seconds=35):
    """Hard-kill the complete process group; no publication decision until child exit."""
    with (directory / 'stdout.log').open('wb') as output, (directory / 'stderr.log').open('wb') as errors:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=output, stderr=errors,
                                   start_new_session=True, preexec_fn=limits, close_fds=True)
        started = time.monotonic()
        try:
            while process.poll() is None:
                if (directory / 'cancel.json').exists():
                    terminate(process)
                    return {'kind': 'failed', 'error': 'Conversion cancelled.'}
                if time.monotonic() - started > seconds:
                    terminate(process)
                    return {'kind': 'failed', 'error': 'Hard conversion deadline exceeded.'}
                if output.tell() > 65536 or errors.tell() > 65536:
                    terminate(process)
                    return {'kind': 'failed', 'error': 'Converter diagnostic budget exceeded.'}
                # The CLI emits bounded JSON progress lines, never client manifests.
                try:
                    lines = bounded(directory / 'stdout.log', 65536).splitlines()
                    if lines:
                        event = json.loads(lines[-1])
                        if isinstance(event, dict) and event.get('phase') in ('retain', 'index', 'geometry', 'publish'):
                            atomic(directory / 'progress.json', event)
                except (ValueError, OSError):
                    pass
                time.sleep(.05)
            if (directory / 'cancel.json').exists():
                return {'kind': 'failed', 'error': 'Conversion cancelled.'}
            if process.returncode != 0:
                try:
                    receipt = json.loads(bounded(directory / 'output' / 'failure.json', 4096))
                    if not isinstance(receipt, dict):
                        raise ValueError('Invalid converter failure receipt')
                    return {'kind': 'failed', 'error': str(receipt.get('code', 'IMPORT_FAILED'))[:128] + ': ' + str(receipt.get('detail', 'Conversion failed'))[:800]}
                except (ValueError, OSError):
                    return {'kind': 'failed', 'error': 'Converter process failed.'}
            return {'kind': 'complete'}
        finally:
            terminate(process)


def read_request(directory):
    request = json.loads(bounded(directory / 'request.json', 4096))
    if not isinstance(request, dict) or set(request) != {'id', 'source', 'occurrence'}:
        raise ValueError('Invalid private worker request')
    source = request['source']
    if (not isinstance(source, dict) or set(source) != {'namespace', 'revision', 'originalSha256'}
            or not all(isinstance(source[key], str) for key in source)
            or not isinstance(request['occurrence'], str)
            or request['id'] != directory.name or not UUID.fullmatch(request['occurrence'])
            or not UUID.fullmatch(source['namespace']) or not REVISION.fullmatch(source['revision'])
            or not HASH.fullmatch(source['originalSha256'])):
        raise ValueError('Invalid private worker request')
    return request


def convert(directory):
    if not UUID.fullmatch(directory.name) or directory.is_symlink():
        return
    request = read_request(directory)
    source = request['source']
    content = bounded(directory / 'input.ifc', 2 * 1024**2)
    if hashlib.sha256(content).hexdigest() != source['originalSha256']:
        raise ValueError('Source integrity check failed')
    atomic(directory / 'running.json', {'started': time.time()})
    result = supervise(directory, [sys.executable, str(Path(__file__).with_name('link.py')),
                       str(directory / 'input.ifc'), str(directory / 'output'),
                       '--namespace', source['namespace'], '--revision', source['revision'],
                       '--occurrence', request['occurrence'], '--cancel-file', str(directory / 'cancel.json')])
    atomic(directory / 'terminal.json', result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('spool', type=Path)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    if set(os.listdir('/sys/class/net')) - {'lo'}:
        raise RuntimeError('IFC sidecar requires an isolated network:none namespace')
    spool = args.spool.resolve()
    # A converter restart never resumes a job whose previous process may have partially written output.
    for directory in spool.iterdir():
        if UUID.fullmatch(directory.name) and directory.is_dir() and not directory.is_symlink() and (directory / 'running.json').exists() and not (directory / 'terminal.json').exists():
            atomic(directory / 'terminal.json', {'kind': 'failed', 'error': 'Converter interrupted by restart.'})
    while True:
        for directory in sorted(spool.iterdir()):
            if not UUID.fullmatch(directory.name) or not directory.is_dir() or directory.is_symlink() or not (directory / 'request.json').exists() or (directory / 'terminal.json').exists():
                continue
            try:
                if (directory / 'cancel.json').exists():
                    atomic(directory / 'terminal.json', {'kind': 'failed', 'error': 'Conversion cancelled.'})
                else:
                    convert(directory)
            except (ValueError, OSError) as error:
                atomic(directory / 'terminal.json', {'kind': 'failed', 'error': str(error)[:1000]})
        if args.once:
            return
        time.sleep(.1)


if __name__ == '__main__':
    main()
