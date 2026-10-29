import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
import subprocess
import os
import signal

from runtime_worker import convert, read_request, supervise
from unittest.mock import patch
import hashlib


class RevisionRequests(unittest.TestCase):
    def test_job_identity_is_independent_of_retained_namespace_and_occurrence(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
            directory.mkdir()
            content = b'new synthetic IFC revision'
            digest = hashlib.sha256(content).hexdigest()
            request = {'id': directory.name, 'source': {'namespace': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
                       'revision': digest, 'originalSha256': digest}, 'occurrence': 'cccccccc-cccc-4ccc-cccc-cccccccccccc'}
            (directory / 'request.json').write_text(json.dumps(request))
            (directory / 'input.ifc').write_bytes(content)
            with patch('runtime_worker.supervise', return_value={'kind': 'complete'}) as run:
                convert(directory)
            command = run.call_args.args[1]
            self.assertEqual(command[command.index('--namespace') + 1], request['source']['namespace'])
            self.assertEqual(command[command.index('--occurrence') + 1], request['occurrence'])
            self.assertEqual(command[command.index('--revision') + 1], digest)
            self.assertEqual(json.loads((directory / 'terminal.json').read_text()), {'kind': 'complete'})

    def test_malformed_requests_fail_as_bounded_input_errors_without_crashing_worker(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
            directory.mkdir()
            valid = {'id': directory.name, 'source': {'namespace': directory.name, 'revision': 'a' * 64,
                     'originalSha256': 'a' * 64}, 'occurrence': directory.name}
            cases = [None, [], 'source text', {}, {**valid, 'occurrence': 17}, {**valid, 'source': []},
                     {**valid, 'source': {**valid['source'], 'namespace': 12}},
                     {**valid, 'source': {**valid['source'], 'revision': None}},
                     {**valid, 'source': {**valid['source'], 'originalSha256': 'b' * 64}},
                     {**valid, 'id': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'}, {**valid, 'fetch': 'https://example.invalid'}]
            for value in cases:
                with self.subTest(value=value):
                    (directory / 'request.json').write_text(json.dumps(value))
                    with self.assertRaises(ValueError):
                        read_request(directory)
            (directory / 'request.json').write_bytes(b' ' * 4097)
            with self.assertRaisesRegex(ValueError, 'budget'):
                read_request(directory)


class Supervision(unittest.TestCase):
    def test_exited_leader_cannot_leave_descendant_running_or_publish_late(self):
        for exit_code in (0, 7):
            with self.subTest(exit_code=exit_code), tempfile.TemporaryDirectory() as root:
                directory = Path(root)
                child = ('import os,time; from pathlib import Path; root=Path(' + repr(root) + '); '
                         '(root / "child.pid").write_text(str(os.getpid())); '
                         '(root / "child.ready").write_text("ready"); '
                         'time.sleep(2); (root / "late").write_text("published")')
                leader = ('import os,subprocess,sys,time; from pathlib import Path; '
                          'subprocess.Popen([sys.executable,"-c",' + repr(child) + ']); '
                          'ready=Path(' + repr(str(directory / 'child.ready')) + '); '
                          '\nwhile not ready.exists(): time.sleep(.01)\n'
                          'os._exit(' + str(exit_code) + ')')
                result = supervise(directory, [sys.executable, '-c', leader])
                self.assertEqual(result['kind'], 'complete' if exit_code == 0 else 'failed')
                self.assertTrue((directory / 'child.ready').exists(), 'Descendant actually started before leader exit')
                pid = int((directory / 'child.pid').read_text())
                try:
                    time.sleep(2.1)
                    self.assertFalse((directory / 'late').exists(), 'Descendant published after its leader exited and supervise returned')
                    process = Path('/proc') / str(pid) / 'stat'
                    self.assertTrue(not process.exists() or process.read_text().rsplit(')', 1)[1].split()[0] in ('Z', 'X'),
                                    'Descendant must be dead, not merely prevented from publishing')
                finally:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_hard_deadline_kills_native_equivalent_child_before_late_publication(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            child = 'import time,pathlib; time.sleep(2); pathlib.Path("' + root + '/late").write_text("published")'
            command = [sys.executable, '-c', 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",' + repr(child) + ']); time.sleep(60)']
            result = supervise(directory, command, seconds=.2)
            self.assertEqual(result['kind'], 'failed')
            self.assertIn('deadline', result['error'])
            time.sleep(2.1)
            self.assertFalse((directory / 'late').exists())

    def test_cancel_kills_child_and_refuses_completion(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            (directory / 'cancel.json').write_text(json.dumps({'cancelled': True}))
            result = supervise(directory, [sys.executable, '-c', 'import time; time.sleep(60)'])
            self.assertEqual(result['kind'], 'failed')
            self.assertIn('cancelled', result['error'])

    def test_worker_restart_marks_abandoned_job_failed_without_reconverting(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
            directory.mkdir()
            (directory / 'running.json').write_text('{}')
            (directory / 'request.json').write_text('{}')
            subprocess.run([sys.executable, str(Path(__file__).with_name('runtime_worker.py')), root, '--once'], check=True)
            self.assertIn('restart', json.loads((directory / 'terminal.json').read_text())['error'])
            self.assertFalse((directory / 'output' / 'manifest.json').exists())


if __name__ == '__main__':
    unittest.main()
