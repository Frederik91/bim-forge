import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

from runtime_worker import supervise


class Supervision(unittest.TestCase):
    def test_hard_deadline_kills_native_equivalent_child_before_late_publication(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            command = [sys.executable, '-c', 'import time,pathlib; time.sleep(2); pathlib.Path("' + root + '/late").write_text("published")']
            result = supervise(directory, command, seconds=.1)
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


if __name__ == '__main__':
    unittest.main()
