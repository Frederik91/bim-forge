"""Verify retained post hoc collection and summarize the one reduced profile.

Usage: python3 publication-profile-162.py REVIEW_DIRECTORY
Read-only filesystem analysis. No Docker, database, subprocess, or retry access.
"""
import datetime
import hashlib
import json
import pathlib
import sys


def sha(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def stamp(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def main():
    review = pathlib.Path(sys.argv[1]).resolve(strict=True)
    raw = review / 'raw'
    manifest = json.loads((review / 'recovery-sha256.json').read_text())
    for name, expected in manifest.items():
        path = (review / name).resolve(strict=True)
        if not path.is_relative_to(review) or sha(path) != expected:
            raise ValueError('Recovery input hash mismatch: ' + name)

    def read(name):
        return json.loads((raw / name).read_text())

    def lines(name):
        return [json.loads(line) for line in (raw / name).read_text().splitlines()]

    recovery = json.loads((review / 'recovered-terminal.json').read_text())
    intent, result, loaded = read('intent.json'), read('profile-result.json'), read('run/load.json')
    expected = {'count': 270205,
                'sum': '7a7dce5cc0865f0bf3aa82a0fe14ca5a115e8a5258b60a4f24442bb7d5600082',
                'xor': '50c0078fc4df5d1d4fca3e065a4ea698cf7d53cae90fceb20a6a9ffe2cce472a'}
    if intent['measuredSource'] != '3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098' or intent['lease'] != 'house161-profile-20261026c':
        raise ValueError('Unexpected measured source or lease')
    if result['status'] != 'PASS' or result['fingerprint'] != expected or loaded['fingerprint'] != expected:
        raise ValueError('Profile or fixed canonical fingerprint failed')
    oracle, properties, errors = read('run/oracle.json'), read('run/property-values.json'), read('run/errors.json')
    if oracle['expected'] != oracle['actual'] or properties['expected'] != properties['actual'] or errors:
        raise ValueError('Original source/readback/property oracle failed')
    metrics = read('run/metrics-loaded.json')
    counts = {'versions': 270205, 'changes': 270205, 'visibility': 270205, 'revisions': 1, 'receipts': 1}
    if metrics['counts'] != counts or any(not row['passed'] for row in result['observations']):
        raise ValueError('Published counts or source observations failed')
    plans = {name: read('plan-' + name + '.json') for name in ('changes', 'visibility', 'references')}
    summaries = {}
    for name, plan in plans.items():
        top = plan['Plan']
        entry = {'topNode': top['Node Type'], 'mainPlanActualTotalMs': top['Actual Total Time'],
                 'topActualRows': top['Actual Rows'], 'tempReadBlocks': top['Temp Read Blocks'],
                 'tempWrittenBlocks': top['Temp Written Blocks'], 'triggers': plan.get('Triggers', [])}
        if name != 'references':
            triggers = plan['Triggers']
            if len(triggers) != 2 or any(t['Calls'] != 270205 for t in triggers):
                raise ValueError('Missing per-row FK trigger work: ' + name)
            entry['afterTriggerTotalMs'] = sum(t['Time'] for t in triggers)
            entry['inputNode'] = top['Plans'][0]['Node Type']
            entry['inputActualRows'] = top['Plans'][0]['Actual Rows']
            entry['inputActualTotalMs'] = top['Plans'][0]['Actual Total Time']
        elif top['Actual Rows'] != 0:
            raise ValueError('Reference validation returned a missing-reference witness')
        summaries[name] = entry
    budget, phases, activity = lines('budget.ndjson'), lines('phases.ndjson'), lines('activity.ndjson')
    if any(row['breaches'] for row in budget):
        raise ValueError('Budget breach occurred')
    if any(not value for value in [recovery['leaseReleased'], not recovery['nativeTerminalFilePresent'], not recovery['nativeControllerDonePresent']]):
        raise ValueError('Recovery status does not describe missing native finalization')
    for name, container in recovery['containers'].items():
        if name.startswith('bim-issue162-profile-') and (container['state']['Running'] or container['state']['Pid'] != 0):
            raise ValueError('Owned resource still running')
    starts = {row['phase'].removesuffix('-before'): row['at'] for row in phases if row['phase'].endswith('-before')}
    windows = {row['phase'].removesuffix('-after'): (stamp(row['at']) - stamp(starts[row['phase'].removesuffix('-after')])) * 1000
               for row in phases if row['phase'].endswith('-after') and row['phase'].removesuffix('-after') in starts}
    schema = read('schema-and-sizes.json')
    if any(not c['validated'] for c in schema['constraints']) or any(t['enabled'] != 'O' for t in schema['triggers']):
        raise ValueError('Constraint or trigger enablement differs')
    facts = {
        'overallStatus': 'ISSUES', 'profileWorkStatus': 'PASS', 'datasetExecutions': 1,
        'comparisonPerformed': False, 'fullAdmissionPerformed': False,
        'measuredSource': intent['measuredSource'], 'harnessCommit': recovery['harnessCommit'],
        'readySealSha256': recovery['readySealSha256'], 'lease': intent,
        'jobStart': read('job-start.json'), 'jobFinished': read('job-finished.json'),
        'publishedRevision': result['revisionId'], 'fingerprint': expected, 'counts': counts,
        'sourceOracle': oracle, 'propertyOracle': properties, 'originalRunnerErrors': errors,
        'plans': summaries, 'instrumentedLoadPhasesMs': loaded['phasesMs'],
        'phaseBoundaryWindowsMsIncludingCollection': windows,
        'canonicalSourceBytes': loaded['canonicalBytes'], 'settings': read('database-settings.json'),
        'budget': {'samples': len(budget), 'breaches': 0,
                   'maxAdditionalBytes': max(row['newBytes'] for row in budget),
                   'maxAggregateBytes': max(row['aggregateBytes'] for row in budget),
                   'minSsdAvailableBytes': min(row['ssdAvailableBytes'] for row in budget),
                   'minRootAvailableBytes': min(row['rootAvailableBytes'] for row in budget),
                   'minHostAvailableMemoryBytes': min(row['hostAvailableMemoryBytes'] for row in budget),
                   'maxCollectionSeconds': max(row['scanSeconds'] for row in budget),
                   'firstAt': budget[0]['at'], 'lastAt': budget[-1]['at']},
        'activitySamples': len(activity),
        'maxActivityGapSeconds': max(stamp(b['at']) - stamp(a['at']) for a, b in zip(activity, activity[1:])),
        'containers': recovery['containers'], 'watchdogStop': read('watchdog-stop.json'),
        'watchdogCleanup': read('watchdog-cleanup.json'),
        'nativeTerminalPresent': False, 'nativeControllerDonePresent': False,
        'recoveryKind': recovery['evidenceKind'], 'finalizationFailure': recovery['finalizationFailure'],
        'timingLimitations': ['One instrumented case, no A/B or repetitions.',
            'Plan node times include children. AFTER-trigger times are separate.',
            'Phase boundaries include collection and instrumentation toggles.',
            'No source-equivalent speedup, overall full-run limiter, or full-capacity conclusion.'],
        'recoveryInputHashes': manifest,
    }
    print(json.dumps(facts, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
