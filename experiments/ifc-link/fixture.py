"""Permitted synthetic fixture; reuses W2 geometry, never old run outputs."""
import argparse
import sys
from pathlib import Path

import ifcopenshell

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ifc"))
from ifc_model import add_unfamiliar_bounded_property, direct_inputs, export_model  # noqa: E402


def synthetic_ifc(output, variant="rotated-mm"):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    base, enriched = output / "base.ifc", output / "synthetic.ifc"
    export_model(direct_inputs(variant), "read-only-link-202", base)
    add_unfamiliar_bounded_property(base, enriched)
    model = ifcopenshell.open(str(enriched))
    model.header.file_name.time_stamp = "2026-10-27T00:00:00"
    model.write(str(enriched))
    return enriched


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(synthetic_ifc(args.output))
