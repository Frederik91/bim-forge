# EX-02: w2-exchange-review-20261025-02

Outcome: failed. Execution: failed.

Both narrow candidates preserve the declared IFC slice; unfamiliar property losses must be explicit.

Variant: Controlled-generated IFC4 slice; retained failed preparation plus distinct historical-runner downstream task.

- native-authoring/m-r1/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- native-authoring/m-r1/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- native-authoring/m-r2/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- native-authoring/m-r2/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- native-authoring/m/successive-exports: passed; expected Two actual exports retain all GlobalIds and change only wall-a dimensions; observed checks satisfied
- native-authoring/mm-r1/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- native-authoring/mm-r1/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- native-authoring/mm-r2/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- native-authoring/mm-r2/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- native-authoring/mm/successive-exports: passed; expected Two actual exports retain all GlobalIds and change only wall-a dimensions; observed checks satisfied
- native-authoring/rotated-m-r1/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- native-authoring/rotated-m-r1/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- native-authoring/rotated-m-r2/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- native-authoring/rotated-m-r2/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- native-authoring/rotated-m/successive-exports: passed; expected Two actual exports retain all GlobalIds and change only wall-a dimensions; observed checks satisfied
- native-authoring/rotated-mm-r1/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- native-authoring/rotated-mm-r1/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- native-authoring/rotated-mm-r2/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- native-authoring/rotated-mm-r2/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- native-authoring/rotated-mm/successive-exports: passed; expected Two actual exports retain all GlobalIds and change only wall-a dimensions; observed checks satisfied
- ifc-native/m-r1/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- ifc-native/m-r1/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- ifc-native/m-r2/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- ifc-native/m-r2/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- ifc-native/m/successive-exports: passed; expected Two actual exports retain all GlobalIds and change only wall-a dimensions; observed checks satisfied
- ifc-native/mm-r1/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- ifc-native/mm-r1/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- ifc-native/mm-r2/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- ifc-native/mm-r2/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- ifc-native/mm/successive-exports: passed; expected Two actual exports retain all GlobalIds and change only wall-a dimensions; observed checks satisfied
- ifc-native/rotated-m-r1/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- ifc-native/rotated-m-r1/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- ifc-native/rotated-m-r2/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- ifc-native/rotated-m-r2/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- ifc-native/rotated-m/successive-exports: passed; expected Two actual exports retain all GlobalIds and change only wall-a dimensions; observed checks satisfied
- ifc-native/rotated-mm-r1/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- ifc-native/rotated-mm-r1/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- ifc-native/rotated-mm-r2/released-schema: failed; expected No released IFC4 attribute/inverse/EXPRESS errors; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 292, in <lambda>
    observations.check("EX-02", f"{case}/released-schema", "No released IFC4 attribute/inverse/EXPRESS errors", lambda: schema_check(path, directory / f"{tag}.validation.json"))
                                                                                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- ifc-native/rotated-mm-r2/semantic-contract: passed; expected IDs/classes, scalar/list properties, type instances, opening, space boundary and spatial graph retained; observed checks satisfied
- ifc-native/rotated-mm/successive-exports: passed; expected Two actual exports retain all GlobalIds and change only wall-a dimensions; observed checks satisfied
- m-r1/candidate-parity: passed; expected Independent reader sees identical narrow logical models for both candidates; observed checks satisfied
- m-r2/candidate-parity: passed; expected Independent reader sees identical narrow logical models for both candidates; observed checks satisfied
- mm-r1/candidate-parity: passed; expected Independent reader sees identical narrow logical models for both candidates; observed checks satisfied
- mm-r2/candidate-parity: passed; expected Independent reader sees identical narrow logical models for both candidates; observed checks satisfied
- rotated-m-r1/candidate-parity: passed; expected Independent reader sees identical narrow logical models for both candidates; observed checks satisfied
- rotated-m-r2/candidate-parity: passed; expected Independent reader sees identical narrow logical models for both candidates; observed checks satisfied
- rotated-mm-r1/candidate-parity: passed; expected Independent reader sees identical narrow logical models for both candidates; observed checks satisfied
- rotated-mm-r2/candidate-parity: passed; expected Independent reader sees identical narrow logical models for both candidates; observed checks satisfied
- unfamiliar-bounded/detected: passed; expected Unfamiliar bounded property is explicit in loss inventory with original source bytes retained; observed checks satisfied
- native-roundtrip/scalar-list-roundtrip: failed; expected Real IFC import via independent inventory -> TypeBox TS overlay -> IFC preserves declared slice; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 384, in check_import
    errors += schema_check(target, directory / f"{name}.validation.json")
              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- bounded-native-roundtrip/scalar-list-roundtrip: failed; expected Real IFC import via independent inventory -> TypeBox TS overlay -> IFC preserves declared slice; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 384, in check_import
    errors += schema_check(target, directory / f"{name}.validation.json")
              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'

- bounded-native-roundtrip/full-unfamiliar-preservation: failed; expected Every unfamiliar property survives in the re-exported IFC, including bounded values; observed UnfamiliarRange lost from native IFC re-export; explicitly reported in bounded-loss-report.json; original source bytes retained
- bounded-ifc-native-roundtrip/full-unfamiliar-preservation: failed; expected Direct IFC-native reserialization preserves unfamiliar bounded value entity and typed attributes; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 403, in direct_bounded_roundtrip
    return ([] if original_snapshot == roundtrip_snapshot else ["IFC-native bounded property roundtrip differs"]) + schema_check(target, directory / "bounded-ifc-native-roundtrip.validation.json")
                                                                                                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 226, in schema_check
    ifcopenshell.validate.validate(model, logger, express_rules=True)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/validate.py", line 629, in validate
    ifcopenshell.express.rule_executor.run(f, logger)
  File "/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps/ifcopenshell/express/rule_executor.py", line 73, in run
    from _pytest import assertion
ModuleNotFoundError: No module named '_pytest'


Limitations:

- Controlled generated IFC4 ADD2 TC1 fixture, not independent vendor exports; Revit not tested.
- Both candidates share IfcOpenShell serialization and geometry; stdlib STEP reader is independent but narrow.
- One partial space boundary, not a closed room shell, MVD qualification or thermal boundary calculation.
- Scalar/list property import retains authored geometry sidecar; no generic IFC-to-parametric-authoring reconstruction.
- Synthetic EPSG:25832 map transform, not certified survey/geodetic accuracy or a viewer test.
- Standalone observations require W0 validation and independent review; no engineering approval.
- The original failed prepare was not repeated. A distinct downstream task reused 74 checksum-verified retained artifacts.
- Original preparation: 65 passing / 20 failed observations. Downstream adds four actual failed observations; none were removed or changed.
- Three downstream schema checks were unavailable because the historical environment lacks pytest; the bounded-value loss is an actual failed preservation check.
- Latest source c30979d640a22ef8b4dc83f7307e111cd5d6546a: root validation, scoped typecheck, 3 TS and 8 Python tests passed. Full IFC preparation on that source remains unvalidated.
- Preparation and downstream engine observations used historical source/runner be6e71b2cc641d669de9f2e57dec49623744100a, before the pytest and JSON-null fixes.
- 1 GiB is the evidence-packaging budget declared and checked at finalization. The original preparation had no recorded W2 disk budget; this value is not a historical enforced run quota.
- Terminal metadata publication records the failed/inconclusive evidence only; it is not registry adoption, PR merge or engineering/model approval.
- Original execution disk budget was unrecorded; null represents that fact. The 1 GiB packaging budget is not an original-run quota.
- Metadata interpretation only: no engine, test, database or preparation was rerun.
