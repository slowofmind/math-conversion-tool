"""nvda_reference.py — step 2 of golden generation (plan T1, T1b).

Runs the MathCAT NVDA ADD-ON's OWN convertSSMLTextForNVDA, unmodified, against
MathCAT SSML, and joins the result the way NVDA's speech viewer does
(speechViewer.py: plain strings only, separated by two spaces).

Since 2026-11-09 the proofing engine models the NVDA add-on, not the MathCAT
built into NVDA (mathcat-proofing-v2/NOTE-MATHCAT-UPGRADE-0.7.7.md). Before
that, this script ran NVDA's own source/mathPres/MathCAT/speech.py at
release-2026.2.

Where the code comes from: the add-on package exactly as the NVDA Add-on Store
serves it (URL and sha256 from the Store's record, addons/MathCAT/0.7.7.json in
github.com/nvaccess/addon-datastore). The download is checked against that
sha256 before use. From the package's globalPlugins/MathCAT/MathCAT.py, three
top-level definitions are taken VERBATIM (source text cut out with Python's
ast module, not retyped): RE_MATHML_SPEECH, PROSODY_COMMANDS and
convertSSMLTextForNVDA. They are run with small stand-ins for what they call
from NVDA and libmathcat; only the synth's name, its supported commands and
the language matter to the text.

The Store lists the add-on's licence as GPL v2 (its repository's LICENSE file
says MIT), so its code is DOWNLOADED at run time and never stored here (M20).
The JS port in mathcat.js is an independent reimplementation of the behavior
and is checked against this reference, not derived from copied code.

usage:  python3 -X utf8 nvda_reference.py            (writes golden.json)
        python3 -X utf8 nvda_reference.py --ssml-cases (writes ssml-cases-golden.json)
"""
import ast, hashlib, io, json, os, re, sys, types, typing, urllib.request, zipfile

ADDON_VERSION = "0.7.7"
ADDON_URL = ("https://github.com/daisy/MathCATForPython/releases/download/"
             f"V{ADDON_VERSION}/MathCAT-{ADDON_VERSION}.nvda-addon")
ADDON_SHA256 = "1022780d030052a2799d55fb3d76402fda593ac5250f55730f33af021b13678b"
ADDON_FILE = "globalPlugins/MathCAT/MathCAT.py"
REFERENCE = f"MathCAT NVDA add-on {ADDON_VERSION}"
SOURCE = f"{ADDON_URL} :: {ADDON_FILE}"
TAKEN = ("RE_MATHML_SPEECH", "PROSODY_COMMANDS", "convertSSMLTextForNVDA")
HERE = os.path.dirname(os.path.abspath(__file__))

# NVDA synthDrivers/oneCore.py supportedCommands (NVDA 2026.x)
ONECORE = ["CharacterModeCommand", "LangChangeCommand", "BreakCommand",
           "PitchCommand", "RateCommand", "VolumeCommand", "PhonemeCommand"]


def fetch_addon_source():
    data = urllib.request.urlopen(ADDON_URL, timeout=60).read()
    got = hashlib.sha256(data).hexdigest()
    if got != ADDON_SHA256:
        sys.exit(f"REFUSED: add-on package sha256 {got} is not the Store's {ADDON_SHA256}")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return z.read(ADDON_FILE).decode("utf-8")


def take_verbatim(src):
    """The exact source text of the TAKEN top-level definitions, in file order."""
    tree = ast.parse(src)
    found = {}
    for node in tree.body:
        name = None
        if isinstance(node, ast.FunctionDef):
            name = node.name
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            name = node.target.id
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
        if name in TAKEN:
            found[name] = ast.get_source_segment(src, node)
    missing = [n for n in TAKEN if n not in found]
    if missing:
        sys.exit(f"REFUSED: not found in the add-on's {ADDON_FILE}: {missing}")
    return [found[n] for n in TAKEN]


def stand_ins(synth_name, supported):
    """Names the taken definitions use. Command classes only need to be
    distinct non-string types; the viewer drops every non-string item."""
    ns = {"re": re, "Type": typing.Type}
    names = ["BaseProsodyCommand", "BeepCommand", "BreakCommand", "VolumeCommand",
             "RateCommand", "CharacterModeCommand", "LangChangeCommand",
             "PhonemeCommand", "PitchCommand", "SpeechCommand", "SynthCommand"]
    for n in names:
        ns[n] = type(n, (), {"__init__": lambda self, *a, **k: None})

    class Synth:
        name = synth_name
        supportedCommands = {ns[n] for n in supported}
        def _get_rate(self):
            return 50                          # NVDA default rate
    ns["SynthDriver"] = Synth
    ns["getSynth"] = lambda: Synth()
    # The add-on sets MathCAT's Language to getLanguageToUse(mathml) before
    # speaking; for English pages that is "en", so both reads below give "en".
    ns["libmathcat"] = types.SimpleNamespace(GetPreference=lambda name: "en",
                                             SetPreference=lambda name, value: None)
    ns["getLanguageToUse"] = lambda mathMl="": "en"
    ns["getCurrentLanguage"] = lambda: "en_US"
    ns["_monkeyPatchESpeak"] = lambda: None   # eSpeak-only workaround; no text effect
    ns["log"] = types.SimpleNamespace(exception=lambda *a, **k: None, info=lambda *a, **k: None)
    return ns


def load_nvda_convert(synth_name="oneCore", supported=ONECORE):
    ns = stand_ins(synth_name, supported)
    for piece in take_verbatim(fetch_addon_source()):
        exec(compile(piece, f"<{ADDON_FILE}>", "exec"), ns)   # verbatim add-on source
    return ns["convertSSMLTextForNVDA"]


def viewer_line(convert, ssml):
    seq = convert(ssml)
    return "  ".join(x for x in seq if isinstance(x, str))   # speechViewer.py


def main():
    convert = load_nvda_convert()
    if "--ssml-cases" in sys.argv:
        cases = json.load(io.open(os.path.join(HERE, "ssml-cases.json"), encoding="utf-8"))
        out = [{"name": c["name"], "ssml": c["ssml"], "viewerRaw": viewer_line(convert, c["ssml"])}
               for c in cases]
        target = "ssml-cases-golden.json"
    else:
        fixtures = {f["name"]: f for f in json.load(io.open(os.path.join(HERE, "fixtures.json"), encoding="utf-8"))}
        ssml = json.load(io.open(os.path.join(HERE, "ssml.json"), encoding="utf-8"))
        out = []
        for s in ssml:
            row = {"name": s["name"], "mathml": fixtures[s["name"]]["mathml"],
                   "ssml": s["ssml"], "error": s["error"]}
            row["viewerRaw"] = viewer_line(convert, s["ssml"]) if s["ssml"] is not None else None
            # the same fixture as NVDA would receive it (root attributes dropped)
            row["nvdaMathml"] = s["nvdaMathml"]
            row["nvdaError"] = s["nvdaError"]
            row["nvdaViewerRaw"] = viewer_line(convert, s["nvdaSsml"]) if s["nvdaSsml"] is not None else None
            out.append(row)
        target = "golden.json"
    meta = {"generatedBy": "nvda_reference.py", "reference": REFERENCE, "synth": "oneCore",
            "source": SOURCE, "addonSha256": ADDON_SHA256}
    with io.open(os.path.join(HERE, target), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"meta": meta, "rows": out}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"wrote {target}: {len(out)} rows")


if __name__ == "__main__":
    main()
