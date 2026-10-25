# EX-08: w2-partial-coordinates-20261025-01

Outcome: inconclusive. Execution: failed.

Metre/mm placements and survey transforms preserve declared coordinates, independently of exact canonical hashing.

Variant: Controlled-generated IFC4 slice; retained failed preparation plus distinct historical-runner downstream task.

- native-authoring/m-r1/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- native-authoring/m-r1/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- native-authoring/m-r2/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- native-authoring/m-r2/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- native-authoring/mm-r1/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- native-authoring/mm-r1/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- native-authoring/mm-r2/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- native-authoring/mm-r2/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- native-authoring/rotated-m-r1/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- native-authoring/rotated-m-r1/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- native-authoring/rotated-m-r2/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- native-authoring/rotated-m-r2/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- native-authoring/rotated-mm-r1/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- native-authoring/rotated-mm-r1/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- native-authoring/rotated-mm-r2/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- native-authoring/rotated-mm-r2/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- ifc-native/m-r1/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- ifc-native/m-r1/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- ifc-native/m-r2/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- ifc-native/m-r2/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- ifc-native/mm-r1/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- ifc-native/mm-r1/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- ifc-native/mm-r2/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- ifc-native/mm-r2/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- ifc-native/rotated-m-r1/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- ifc-native/rotated-m-r1/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- ifc-native/rotated-m-r2/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- ifc-native/rotated-m-r2/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- ifc-native/rotated-mm-r1/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- ifc-native/rotated-mm-r1/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- ifc-native/rotated-mm-r2/coordinates: passed; expected Metre/mm raw dimensions, nested local rotation and survey corners within declared tolerances; observed checks satisfied
- ifc-native/rotated-mm-r2/real-kernel: passed; expected Real IfcOpenShell evaluated wall opening subtraction, solid volumes and world bounds; observed checks satisfied
- native-authoring/m-vs-mm: failed; expected Different exact canonical hashes, equivalent physical corners without viewer-origin rewriting; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 329, in compare_units
    if canonical_hash(metres) == canonical_hash(millimetres):
       ^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 49, in canonical_hash
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/json/__init__.py", line 238, in dumps
    **kw).encode(obj)
          ^^^^^^^^^^^
  File "/usr/lib/python3.11/json/encoder.py", line 200, in encode
    chunks = self.iterencode(o, _one_shot=True)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/json/encoder.py", line 258, in iterencode
    return _iterencode(o, 0)
           ^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/json/encoder.py", line 180, in default
    raise TypeError(f'Object of type {o.__class__.__name__} '
TypeError: Object of type Atom is not JSON serializable

- native-authoring/rotated-m-vs-mm: failed; expected Different exact canonical hashes, equivalent physical corners without viewer-origin rewriting; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 329, in compare_units
    if canonical_hash(metres) == canonical_hash(millimetres):
       ^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 49, in canonical_hash
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/json/__init__.py", line 238, in dumps
    **kw).encode(obj)
          ^^^^^^^^^^^
  File "/usr/lib/python3.11/json/encoder.py", line 200, in encode
    chunks = self.iterencode(o, _one_shot=True)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/json/encoder.py", line 258, in iterencode
    return _iterencode(o, 0)
           ^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/json/encoder.py", line 180, in default
    raise TypeError(f'Object of type {o.__class__.__name__} '
TypeError: Object of type Atom is not JSON serializable

- ifc-native/m-vs-mm: failed; expected Different exact canonical hashes, equivalent physical corners without viewer-origin rewriting; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 329, in compare_units
    if canonical_hash(metres) == canonical_hash(millimetres):
       ^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 49, in canonical_hash
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/json/__init__.py", line 238, in dumps
    **kw).encode(obj)
          ^^^^^^^^^^^
  File "/usr/lib/python3.11/json/encoder.py", line 200, in encode
    chunks = self.iterencode(o, _one_shot=True)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/json/encoder.py", line 258, in iterencode
    return _iterencode(o, 0)
           ^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/json/encoder.py", line 180, in default
    raise TypeError(f'Object of type {o.__class__.__name__} '
TypeError: Object of type Atom is not JSON serializable

- ifc-native/rotated-m-vs-mm: failed; expected Different exact canonical hashes, equivalent physical corners without viewer-origin rewriting; observed Traceback (most recent call last):
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 213, in check
    errors = action()
             ^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 329, in compare_units
    if canonical_hash(metres) == canonical_hash(millimetres):
       ^^^^^^^^^^^^^^^^^^^^^^
  File "/qualification/sources/w2-debug/experiments/ifc/run.py", line 49, in canonical_hash
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/json/__init__.py", line 238, in dumps
    **kw).encode(obj)
          ^^^^^^^^^^^
  File "/usr/lib/python3.11/json/encoder.py", line 200, in encode
    chunks = self.iterencode(o, _one_shot=True)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/json/encoder.py", line 258, in iterencode
    return _iterencode(o, 0)
           ^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/json/encoder.py", line 180, in default
    raise TypeError(f'Object of type {o.__class__.__name__} '
TypeError: Object of type Atom is not JSON serializable


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
- Coordinator terminal record uses null for the unrecorded original disk budget. The independently checked 1 GiB packaging budget is not an original-run limit.
