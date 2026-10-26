"""Single-use, lease-gated diagnostic launcher and independent watchdog.

There is deliberately no retry, comparison, resume, or existing-database mode.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import threading
import time
import uuid

GIB = 1024 ** 3
SOURCE = '3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098'
TOOLS = 'sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff'
PG = 'sha256:1493afd6cc99c05d611913cd5731aa0a081aefd9ff0b805552e66dc150b17ccc'
HOUSE = pathlib.Path('/ssd1/bim-forge-qualification/house-161')
PREP = HOUSE / 'issue162-reduced-profile-prep-c-20261026a'
RUN = HOUSE / 'issue162-reduced-profile-20261026a'
MODULE = 'docs/experiments/diagnostics/publication-162'
PREFIX = 'bim-issue162-profile-20261026a'
NAMES = {key: PREFIX + '-' + key for key in ('pg', 'client', 'budget')}
NETWORK = PREFIX + '-net'
DATABASE = 'qvm_w5_issue162_profile'
LABEL = 'bim.issue162.owner'


def put(path, value):
    temporary = path.with_suffix(path.suffix + '.next')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def command(args, timeout=5, check=True):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=check)


def digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(block)
    return checksum.hexdigest()


def lease_window(start, expiry, now):
    begin = datetime.datetime.fromisoformat(start.replace('Z', '+00:00'))
    end = datetime.datetime.fromisoformat(expiry.replace('Z', '+00:00'))
    if begin.utcoffset() != datetime.timedelta(0) or end.utcoffset() != datetime.timedelta(0):
        raise ValueError('Lease timestamps must explicitly use UTC')
    if not 0 < (end - begin).total_seconds() <= 900:
        raise ValueError('Lease must be positive and at most 15 minutes')
    if not begin.timestamp() <= now < end.timestamp() - 120:
        raise ValueError('Lease has not started or lacks cleanup time')
    return begin.timestamp(), end.timestamp()


def owned(record, nonce):
    return (record['Name'].removeprefix('/') in NAMES.values()
            and record['Config'].get('Labels', {}).get(LABEL) == nonce)


def inspect(name):
    result = command(['docker', 'inspect', name], check=False)
    if result.returncode == 0:
        return json.loads(result.stdout)[0]
    missing = (r'(?i:(?:error(?::| response from daemon:)[ \t]*)?'
               r'no such (?:object|container):[ \t]*)' + re.escape(name))
    if (result.returncode == 1 and result.stdout.strip() in ('', '[]')
            and re.fullmatch(missing, result.stderr.strip())):
        return None
    raise RuntimeError(result.stderr)


def stop_owned(nonce, grace=False):
    results = []
    for key in ('client', 'pg', 'budget'):
        try:
            record = inspect(NAMES[key])
            if record is None:
                continue
            if not owned(record, nonce):
                raise RuntimeError('Refusing cleanup of resource without exact owner label')
            if record['State']['Running']:
                args = ['docker', 'stop', '-t', '5', record['Id']] if grace and key == 'pg' else ['docker', 'kill', record['Id']]
                command(args, timeout=8 if grace else 4, check=False)
            final = inspect(NAMES[key])
            results.append({'name': NAMES[key], 'id': record['Id'], 'running': final['State']['Running'] if final else False})
        except Exception as error:
            results.append({'name': NAMES[key], 'error': str(error)})
    return results


def protected_states():
    return {name: inspect(name)['State']['Status'] for name in ('bim-qvm-db', 'bim-qvm-r3-db')}


def verify_prepared():
    sealed = json.loads((PREP / 'ready.json').read_text())
    if sealed['measuredSource'] != SOURCE or not sealed['networkNoneChecksPassed']:
        raise ValueError('Preparation lacks successful source-bound checks')
    for name, checksum in sealed['sha256'].items():
        path = (PREP / name).resolve(strict=True)
        if not path.is_relative_to(PREP.resolve()) or digest(path) != checksum:
            raise ValueError('Prepared input changed: ' + name)


def stop_reason(intent, now, controller, budget, job, observation):
    if now >= intent['expiry'] - 90:
        return 'Total lease reached cleanup boundary'
    if now - controller['unix'] > 15:
        return 'Controller heartbeat unavailable'
    if budget is None:
        if now - intent['created'] > 30:
            return 'No initial budget sample'
    elif now - budget['unix'] > 15 or budget['breaches']:
        return 'Budget stale or breached'
    if job is not None:
        if now >= job['deadline']:
            return 'Eight-minute instrumented job deadline'
        if observation is None or now - observation['unix'] > 15:
            return 'Activity/resource observer unavailable'
    return None


def watchdog():
    intent = json.loads((RUN / 'intent.json').read_text())
    nonce, expiry = intent['nonce'], intent['expiry']
    try:
        while not (RUN / 'controller-done.json').exists():
            now = time.time()
            heartbeat = json.loads((RUN / 'controller-heartbeat.json').read_text())
            if (RUN / 'budget-error.json').exists():
                raise RuntimeError('Budget collector failed')
            budget = json.loads((RUN / 'budget.json').read_text()) if (RUN / 'budget.json').exists() else None
            job = json.loads((RUN / 'job-start.json').read_text()) if (RUN / 'job-start.json').exists() and not (RUN / 'job-finished.json').exists() else None
            observation = json.loads((RUN / 'observer-heartbeat.json').read_text()) if (RUN / 'observer-heartbeat.json').exists() else None
            reason = stop_reason(intent, now, heartbeat, budget, job, observation)
            if (HOUSE / 'loop-pause-all').exists():
                reason = 'Coordinator pause marker present'
            if reason:
                raise RuntimeError(reason)
            put(RUN / 'watchdog-heartbeat.json', {'unix': now})
            time.sleep(0.5)
    except Exception as error:
        put(RUN / 'watchdog-stop.json', {'unix': time.time(), 'error': str(error)})
        put(RUN / 'watchdog-cleanup.json', stop_owned(nonce))


def check_guard():
    if (RUN / 'watchdog-stop.json').exists():
        raise RuntimeError((RUN / 'watchdog-stop.json').read_text())
    heartbeat = json.loads((RUN / 'watchdog-heartbeat.json').read_text())
    if time.time() - heartbeat['unix'] > 15:
        raise RuntimeError('Independent watchdog unavailable')


def create_container(kind, nonce, args):
    check_guard()
    result = command(['docker', 'create', '--name', NAMES[kind], '--label', LABEL + '=' + nonce] + args, timeout=15)
    record = inspect(NAMES[kind])
    if not record or not owned(record, nonce) or record['Id'] != result.stdout.strip():
        raise RuntimeError('Created container identity differs')
    put(RUN / (kind + '-created.json'), record)
    check_guard()
    command(['docker', 'start', record['Id']], timeout=10)


def sql(query):
    # The target is fixed, newly created, private, and verified by its ownership label.
    return command(['docker', 'exec', NAMES['pg'], 'psql', '-X', '-U', 'qvm', '-d', DATABASE,
                    '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', query], timeout=3).stdout.strip()


ACTIVITY = """SELECT jsonb_build_object('at',clock_timestamp(),'activity',(
 SELECT jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start,'application',application_name,
 'state',state,'query',query,'queryStart',query_start,'queryAge',clock_timestamp()-query_start,
 'waitType',wait_event_type,'event',wait_event)) FROM pg_stat_activity WHERE datname=current_database()))"""


def capture_samples(tick):
    start = time.monotonic()
    activity = sql(ACTIVITY)
    with (RUN / 'activity.ndjson').open('a') as stream:
        stream.write(activity + '\n')
    if tick % 5 == 0:
        sample = {'unix': time.time()}
        for kind in ('pg', 'client'):
            result = command(['docker', 'exec', NAMES[kind], 'sh', '-c',
                'for p in cpu.stat memory.current memory.events memory.stat io.stat; do printf "FILE %s\\n" "$p"; cat "/sys/fs/cgroup/$p"; done'], check=False)
            sample[kind] = {'exit': result.returncode, 'cgroup': result.stdout,
                            'processes': command(['docker', 'top', NAMES[kind], '-eo', 'pid,pcpu,time,comm'], check=False).stdout}
        with (RUN / 'resources.ndjson').open('a') as stream:
            stream.write(json.dumps(sample) + '\n')
    with (RUN / 'observer-cost.ndjson').open('a') as stream:
        stream.write(json.dumps({'unix': time.time(), 'seconds': time.monotonic() - start}) + '\n')
    put(RUN / 'observer-heartbeat.json', {'unix': time.time()})


def run(args):
    begin, expiry = lease_window(args.starts_at, args.expires_at, time.time())
    if expiry - time.time() < 780:
        raise ValueError('Fewer than thirteen minutes remain for setup, job, inspection, and cleanup')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', args.lease_id):
        raise ValueError('Unsafe lease ID')
    if PREP.resolve() != pathlib.Path(__file__).resolve().parent:
        raise ValueError('Launcher must run from the fixed prepared root')
    verify_prepared()
    # Fail closed instead of adopting a partial prior attempt.
    for name in NAMES.values():
        if inspect(name) is not None:
            raise ValueError('Owned resource name already exists')
    if command(['docker', 'network', 'inspect', NETWORK], check=False).returncode == 0:
        raise ValueError('Diagnostic network name already exists')
    for image in (TOOLS, PG):
        if command(['docker', 'image', 'inspect', '--format', '{{.Id}}', image]).stdout.strip() != image:
            raise ValueError('Pinned image unavailable')
    RUN.mkdir()
    nonce = str(uuid.uuid4())
    before = protected_states()
    intent = {'lease': args.lease_id, 'start': begin, 'expiry': expiry, 'created': time.time(),
              'nonce': nonce, 'measuredSource': SOURCE, 'oldClusterStates': before}
    put(RUN / 'intent.json', intent)
    put(RUN / 'controller-heartbeat.json', {'unix': time.time()})
    done = threading.Event()

    def heartbeat():
        while not done.wait(1):
            put(RUN / 'controller-heartbeat.json', {'unix': time.time()})

    threading.Thread(target=heartbeat, daemon=True).start()
    watch_log = (RUN / 'watchdog.log').open('w')
    watch = subprocess.Popen([sys.executable, str(PREP / 'control.py'), 'watch'],
                             stdout=watch_log, stderr=subprocess.STDOUT, start_new_session=True)
    put(RUN / 'watchdog-process.json', {'pid': watch.pid})
    terminal = {'status': 'ISSUES', 'claim': 'One reduced instrumented diagnostic; no speedup or full admission claim.'}
    try:
        for _ in range(20):
            if (RUN / 'watchdog-heartbeat.json').exists():
                break
            time.sleep(0.1)
        check_guard()
        put(RUN / 'host-before.json', {'uptime': command(['uptime']).stdout, 'cores': command(['nproc']).stdout,
            'processes': command(['ps', '-eo', 'pid,pcpu,pmem,comm', '--sort=-pcpu']).stdout,
            'containers': command(['docker', 'ps', '--format', '{{.Names}} {{.Status}}']).stdout})
        create_container('budget', nonce, ['--network', 'none', '--cpus=.25', '--memory=256m', '--memory-swap=256m',
            '--read-only', '--mount', 'type=bind,src=/ssd1/bim-forge-qualification,dst=/all,readonly',
            '--mount', 'type=bind,src=/,dst=/host-root,readonly', '--mount', f'type=bind,src={RUN},dst=/e',
            '--mount', f'type=bind,src={PREP},dst=/prepared,readonly', '--entrypoint', 'python3', TOOLS, '/prepared/budget.py'])
        while not (RUN / 'budget.json').exists():
            check_guard()
            time.sleep(0.25)
        budget = json.loads((RUN / 'budget.json').read_text())
        if budget['breaches'] or time.time() - budget['unix'] > 15:
            raise RuntimeError('Initial budget did not pass')
        command(['docker', 'network', 'create', '--internal', '--label', LABEL + '=' + nonce, NETWORK])
        (RUN / 'data').mkdir()
        create_container('pg', nonce, ['--network', NETWORK, '--cpus=1.5', '--memory=3g', '--memory-swap=3g',
            '--log-opt', 'max-size=64m', '--log-opt', 'max-file=1', '--mount', f'type=bind,src={RUN}/data,dst=/var/lib/postgresql/data',
            '-e', 'POSTGRES_USER=qvm', '-e', 'POSTGRES_DB=' + DATABASE, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', PG,
            '-c', 'shared_buffers=256MB', '-c', 'work_mem=8MB', '-c', 'maintenance_work_mem=256MB',
            '-c', 'max_wal_size=8GB', '-c', 'max_connections=80', '-c', 'max_parallel_workers_per_gather=1',
            '-c', 'track_io_timing=on', '-c', 'track_wal_io_timing=on', '-c', 'track_activity_query_size=8192',
            '-c', 'fsync=on', '-c', 'synchronous_commit=on', '-c', 'full_page_writes=on'])
        setup_deadline = min(begin + 180, expiry - 600)
        while True:
            check_guard()
            if time.time() >= setup_deadline:
                raise RuntimeError('Three-minute setup envelope expired')
            ready = command(['docker', 'exec', NAMES['pg'], 'pg_isready', '-U', 'qvm', '-d', DATABASE], check=False)
            if ready.returncode == 0:
                break
            time.sleep(1)
        settings = json.loads(sql("SELECT jsonb_build_object('version',current_setting('server_version'), 'settings',"
            "(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes',"
            "'work_mem','shared_buffers','maintenance_work_mem','hash_mem_multiplier','max_wal_size','max_parallel_workers_per_gather')))"))
        if not settings['version'].startswith('15.14') or any(settings['settings'][key] != 'on' for key in ('fsync', 'synchronous_commit', 'full_page_writes')):
            raise RuntimeError('Version or durability differs')
        put(RUN / 'database-settings.json', settings)
        sql('CHECKPOINT')
        make_inputs(args.lease_id)
        job = {'start': time.time(), 'deadline': min(time.time() + 480, expiry - 120)}
        put(RUN / 'observer-heartbeat.json', {'unix': time.time()})
        put(RUN / 'job-start.json', job)
        create_container('client', nonce, ['--network', NETWORK, '--cpus=1', '--memory=1g', '--memory-swap=1g',
            '--mount', f'type=bind,src={PREP},dst=/prepared,readonly', '--mount', f'type=bind,src={RUN},dst=/e',
            '--mount', 'type=bind,src=/ssd1/bim-forge-qualification,dst=/qualification,readonly',
            '--mount', 'type=bind,src=/,dst=/host-root,readonly', '-w', '/app',
            '-e', f'DATABASE_URL=postgresql://qvm@{NAMES["pg"]}/{DATABASE}?application_name=issue162-profile',
            '-e', 'QVM_EXECUTION_LEASE=' + args.lease_id, '--entrypoint', '/bin/bash', TOOLS, '/prepared/client.sh'])
        tick = 0
        while inspect(NAMES['client'])['State']['Running']:
            check_guard()
            capture_samples(tick)
            tick += 1
            time.sleep(1)
        client = inspect(NAMES['client'])
        put(RUN / 'job-finished.json', {'unix': time.time()})
        put(RUN / 'client-terminal.json', client)
        if client['State']['ExitCode'] != 0 or client['State']['OOMKilled']:
            raise RuntimeError('Instrumented client failed')
        result = json.loads((RUN / 'profile-result.json').read_text())
        if result['status'] != 'PASS':
            raise RuntimeError('Missing successful original oracle')
        if time.time() >= expiry - 120:
            raise RuntimeError('No remaining inspection envelope')
        inspection = sql("SELECT jsonb_build_object('constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,"
            "'definition',pg_get_constraintdef(oid),'validated',convalidated,'deferrable',condeferrable)) FROM pg_constraint "
            "WHERE connamespace='qvm_storage'::regnamespace),'indexes',(SELECT jsonb_agg(to_jsonb(i)) FROM pg_indexes i "
            "WHERE schemaname='qvm_storage'),'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled)) "
            "FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='qvm_storage'::regnamespace)),"
            "'sizes',(SELECT jsonb_agg(jsonb_build_object('table',relname,'heap',pg_relation_size(oid),'indexes',pg_indexes_size(oid))) "
            "FROM pg_class WHERE relnamespace='qvm_storage'::regnamespace AND relkind='r'))")
        put(RUN / 'schema-and-sizes.json', json.loads(inspection))
        terminal['status'] = 'PASS'
    except Exception as error:
        terminal['error'] = str(error)
    finally:
        terminal['cleanup'] = stop_owned(nonce, grace=True)
        try:
            terminal['oldClusterStatesAfter'] = protected_states()
        except Exception as error:
            terminal['oldClusterStatesAfter'] = {'inspectionError': str(error)}
        if terminal['oldClusterStatesAfter'] != before or any(row.get('running') or 'error' in row for row in terminal['cleanup']):
            terminal['status'] = 'ISSUES'
        for kind in NAMES:
            record = inspect(NAMES[kind])
            if record and owned(record, nonce):
                put(RUN / (kind + '-final.json'), record)
                logs = command(['docker', 'logs', record['Id']], timeout=5, check=False)
                (RUN / (kind + '.stdout.log')).write_text(logs.stdout)
                (RUN / (kind + '.stderr.log')).write_text(logs.stderr)
        network = command(['docker', 'network', 'inspect', NETWORK], check=False)
        if network.returncode == 0:
            details = json.loads(network.stdout)[0]
            if details.get('Labels', {}).get(LABEL) == nonce:
                # Stopped containers keep the network attached; preserve it with evidence.
                put(RUN / 'retained-network.json', details)
        terminal['finished'] = time.time()
        terminal['retention'] = 'New containers stopped; new database and network retained. No historical resources changed.'
        put(RUN / 'terminal.json', terminal)
        put(RUN / 'controller-done.json', {'unix': time.time()})
        done.set()
        watch.wait(timeout=5)
        watch_log.close()
        hashes = {str(path.relative_to(RUN)): digest(path) for path in RUN.rglob('*')
                  if path.is_file() and 'data' not in path.relative_to(RUN).parts}
        put(RUN / 'evidence-sha256.json', hashes)
    return 0 if terminal['status'] == 'PASS' else 1


def make_inputs(lease):
    admission = json.loads((PREP / 'admission-template.json').read_text())
    admission['sourceManifest']['file'] = '/prepared/reduced.json'
    put(RUN / 'admission.json', admission)
    config = json.loads((PREP / 'config-template.json').read_text())
    config.update(runId='issue162-profile', branch='issue162-profile', dataset='/e/admission.json', scale='reduced')
    config['execution'].update(decisionPath='/prepared/README.md', decisionSha256=digest(PREP / 'README.md'),
        loadWallTimeLimitMs=480000, loadStatementTimeoutMs=480000, mode={'kind': 'load-only'})
    config['execution']['space'].update(dataPath='/qualification', hostRootPath='/host-root', monitorEvidence='/e/budget.ndjson')
    config['environment'].update(sourceCommit=SOURCE, nodeImage=TOOLS, postgresImage=PG,
        storageDescription='Single instrumented reduced diagnostic on a new private issue162 cluster')
    put(RUN / 'config.json', config)
    put(RUN / 'lease.json', {'lease': lease})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    run_parser = sub.add_parser('run')
    run_parser.add_argument('--lease-id', required=True)
    run_parser.add_argument('--starts-at', required=True)
    run_parser.add_argument('--expires-at', required=True)
    sub.add_parser('watch')
    arguments = parser.parse_args()
    if arguments.mode == 'watch':
        watchdog()
    else:
        raise SystemExit(run(arguments))
