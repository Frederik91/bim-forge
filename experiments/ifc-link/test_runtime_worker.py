import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
import subprocess
import os
import signal

from runtime_worker import supervise


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
