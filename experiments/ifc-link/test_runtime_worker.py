import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
import subprocess

from runtime_worker import supervise


class Supervision(unittest.TestCase):
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
