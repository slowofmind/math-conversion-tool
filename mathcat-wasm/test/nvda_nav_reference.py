"""nvda_nav_reference.py — step 2 of navigation golden generation
(PLAN-MATHCAT-NAVIGATION.md N-T1).

Adds NVDA's own text to every row of nav-ssml.json (from gen-nav-ssml.mjs):
the arriving speech and each navigation step's SSML are passed through the
MathCAT NVDA add-on's convertSSMLTextForNVDA (0.7.7; before 2026-11-09, NVDA's
at release-2026.2) and joined as the speech viewer does. The loader is
nvda_reference.py's: the add-on's source comes from the Store's package at run
time and is never stored (M20).

Also records the add-on's message for each failed step, by role (MathCAT.py):
entry -> "Error in starting navigation of math: see NVDA error log for details" (reportFocus)
key   -> "Error in navigating math: see NVDA error log for details" (script_navigate)

MathCAT-generated ids (MathCAT's own nodes) differ on every load, so tests
must compare text and highlight, and navId only when it was sent by us.

usage:  python -X utf8 nvda_nav_reference.py      (writes nav-golden.json)
"""
import io, json, os
from nvda_reference import load_nvda_convert, viewer_line, REFERENCE, SOURCE, ADDON_SHA256, HERE

NVDA_MESSAGE = {"entry": "Error in starting navigation of math: see NVDA error log for details",
                "key": "Error in navigating math: see NVDA error log for details"}


def main():
    convert = load_nvda_convert()
    src = json.load(io.open(os.path.join(HERE, "nav-ssml.json"), encoding="utf-8"))
    for row in src["rows"]:
        if "arrive" not in row:
            continue
        a = row["arrive"]
        a["viewerRaw"] = viewer_line(convert, a["ssml"]) if a["ssml"] is not None else None
        for s in row["steps"]:
            s["viewerRaw"] = viewer_line(convert, s["ssml"]) if s["ssml"] is not None else None
            s["nvdaMessage"] = NVDA_MESSAGE[s["role"]] if s["error"] else None
    meta = {"generatedBy": "gen-nav-ssml.mjs + nvda_nav_reference.py", "reference": REFERENCE,
            "synth": "oneCore", "source": SOURCE, "addonSha256": ADDON_SHA256,
            "sequence": src["sequence"]}
    with io.open(os.path.join(HERE, "nav-golden.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"meta": meta, "rows": src["rows"]}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    steps = [s for r in src["rows"] for s in r.get("steps", [])]
    print(f"wrote nav-golden.json: {len(src['rows'])} rows, {len(steps)} steps, "
          f"{sum(1 for s in steps if s['viewerRaw'] is not None)} with text")


if __name__ == "__main__":
    main()
