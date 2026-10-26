import datetime
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


control, budget, instrumentation = (module(name) for name in ('control', 'budget', 'instrument'))


class Safety(unittest.TestCase):
    def test_lease_rejects_future_expired_naive_and_overlong(self):
        begin = '2026-10-26T08:00:00Z'
        end = '2026-10-26T08:15:00Z'
        now = datetime.datetime(2026, 10, 26, 8, 1, tzinfo=datetime.timezone.utc).timestamp()
        self.assertEqual(control.lease_window(begin, end, now)[1] - now, 840)
        for start, finish, moment in [
            (begin, end, now - 120), (begin, end, now + 840),
            ('2026-10-26T08:00:00', end, now), (begin, '2026-10-26T08:15:01Z', now),
            (end, begin, now), (begin, '2026-10-26T09:15:00+01:00', now),
        ]:
            with self.subTest(start=start, finish=finish, moment=moment):
                with self.assertRaises(ValueError):
                    control.lease_window(start, finish, moment)

    def test_cleanup_never_signals_old_or_wrong_owner_containers(self):
        for name, nonce in [('bim-qvm-db', 'mine'), ('bim-qvm-r3-db', 'mine'),
                            (control.NAMES['pg'], 'someone-else')]:
            record = {'Name': '/' + name, 'Id': 'sentinel', 'Config': {'Labels': {control.LABEL: nonce}},
                      'State': {'Running': True}}
            with patch.object(control, 'inspect', return_value=record), patch.object(control, 'command') as execute:
                rows = control.stop_owned('mine')
                execute.assert_not_called()
                self.assertTrue(all('error' in row for row in rows))

    def test_cleanup_signals_only_verified_container_ids(self):
        def inspect(name):
            return {'Name': '/' + name, 'Id': 'id-' + name, 'Config': {'Labels': {control.LABEL: 'mine'}},
                    'State': {'Running': True}}
        with patch.object(control, 'inspect', side_effect=inspect), patch.object(control, 'command') as execute:
            control.stop_owned('mine')
            self.assertEqual([call.args[0] for call in execute.call_args_list],
                             [['docker', 'kill', 'id-' + control.NAMES[key]] for key in ('client', 'pg', 'budget')])

    def test_watchdog_deadline_and_missing_telemetry_fail_closed(self):
        intent = {'expiry': 1000, 'created': 0}
        fresh = {'unix': 100}
        funds = {'unix': 100, 'breaches': []}
        job = {'deadline': 500}
        self.assertIsNone(control.stop_reason(intent, 100, fresh, funds, job, fresh))
        cases = [
            (910, {'unix': 910}, {'unix': 910, 'breaches': []}, None, None),
            (116, fresh, funds, job, fresh),
            (100, fresh, {'unix': 80, 'breaches': []}, job, fresh),
            (100, fresh, {'unix': 100, 'breaches': ['disk']}, job, fresh),
            (100, fresh, None, None, None),
            (500, {'unix': 500}, {'unix': 500, 'breaches': []}, job, {'unix': 500}),
            (100, fresh, funds, job, None),
            (100, fresh, funds, job, {'unix': 84}),
        ]
        for values in cases:
            with self.subTest(values=values):
                self.assertIsNotNone(control.stop_reason(intent, *values))

    def test_budget_stops_before_absolute_limits(self):
        row = {'newBytes': 0, 'aggregateBytes': 190 * budget.GIB,
               'ssdAvailableBytes': 200 * budget.GIB, 'rootAvailableBytes': 10 * budget.GIB,
               'hostAvailableMemoryBytes': 8 * budget.GIB}
        self.assertEqual(budget.breaches(row), [])
        thresholds = {'newBytes': 8 * budget.GIB, 'aggregateBytes': 198 * budget.GIB,
                      'ssdAvailableBytes': 101 * budget.GIB - 1, 'rootAvailableBytes': 5 * budget.GIB - 1,
                      'hostAvailableMemoryBytes': 5 * budget.GIB // 4 - 1}
        for key, value in thresholds.items():
            with self.subTest(key=key):
                self.assertEqual(len(budget.breaches({**row, key: value})), 1)

    def test_instrumentation_keeps_originals_and_validator_statement(self):
        source = pathlib.Path('/measured')
        before = (source / 'experiments/storage/load.ts').read_bytes()
        with tempfile.TemporaryDirectory() as temporary:
            output = pathlib.Path(temporary)
            instrumentation.instrument(source, output)
            generated = (output / 'load-profile.ts').read_text()
            self.assertEqual(generated.count('await store.validateReferences(branch);'), 1)
            self.assertEqual(generated.count('INSERT INTO qvm_storage.changes SELECT'), 1)
            self.assertEqual(generated.count('INSERT INTO qvm_storage.visibility'), 1)
            self.assertEqual((source / 'experiments/storage/load.ts').read_bytes(), before)
            self.assertEqual(generated.count("await phase(store, 'references-before');"), 1)
            self.assertEqual(generated.count("await phase(store, 'references-after');"), 1)


if __name__ == '__main__':
    unittest.main()
