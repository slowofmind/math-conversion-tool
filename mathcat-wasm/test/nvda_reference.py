"""nvda_reference.py — step 2 of golden generation (plan T1, T1b).

Runs NVDA's OWN convertSSMLTextForNVDA (source/mathPres/MathCAT/speech.py at
release-2026.2), unmodified, against MathCAT SSML, and joins the result the
way NVDA's speech viewer does (speechViewer.py L183-203: plain strings only,
separated by two spaces). NVDA's imports are satisfied with small stub
modules; only the synth object's name and supported commands matter.

NVDA is GPL-2.0, so its source is DOWNLOADED at run time, never vendored.
The JS port in mathcat.js is an independent reimplementation of the behavior
and is checked against this reference, not derived from copied code.

usage:  python3 -X utf8 nvda_reference.py            (writes golden.json)
        python3 -X utf8 nvda_reference.py --ssml-cases (writes ssml-cases-golden.json)
"""
import io, json, os, sys, tempfile, types, urllib.request

NVDA_TAG = "release-2026.2"
SPEECH_PY = ("https://raw.githubusercontent.com/nvaccess/nvda/"
             f"{NVDA_TAG}/source/mathPres/MathCAT/speech.py")
HERE = os.path.dirname(os.path.abspath(__file__))


def install_stubs(synth_name, supported):
    """Provide the modules speech.py imports. Command classes only need to
    be distinct non-string types; the viewer drops every non-string item."""
    cmds = types.ModuleType("speech.commands")
    names = ["BaseProsodyCommand", "BeepCommand", "BreakCommand", "VolumeCommand",
             "RateCommand", "CharacterModeCommand", "LangChangeCommand",
             "PhonemeCommand", "PitchCommand", "SpeechCommand", "SynthCommand"]
    for n in names:
        setattr(cmds, n, type(n, (), {"__init__": lambda self, *a, **k: None}))
    speech = types.ModuleType("speech")
    speech.__path__ = []
    speech.commands = cmds
    speech.getCurrentLanguage = lambda: "en_US"
    sys.modules["speech"] = speech
    sys.modules["speech.commands"] = cmds

    class Synth:
        name = synth_name
        supportedCommands = {getattr(cmds, n) for n in supported}
        def _get_rate(self):
            return 50                          # NVDA default rate
    sdh = types.ModuleType("synthDriverHandler")
    sdh.getSynth = lambda: Synth()
    sdh.SynthDriver = Synth
    sys.modules["synthDriverHandler"] = sdh

    sx = types.ModuleType("speechXml")
    sx.toXmlLang = lambda s: s.replace("_", "-")
    sys.modules["speechXml"] = sx
    return cmds


# NVDA synthDrivers/oneCore.py supportedCommands (release-2026.2, L183-192)
ONECORE = ["CharacterModeCommand", "LangChangeCommand", "BreakCommand",
           "PitchCommand", "RateCommand", "VolumeCommand", "PhonemeCommand"]


def load_nvda_convert(synth_name="oneCore", supported=ONECORE):
    install_stubs(synth_name, supported)
    src = urllib.request.urlopen(SPEECH_PY, timeout=30).read().decode("utf-8")
    pkg = tempfile.mkdtemp()
    os.makedirs(os.path.join(pkg, "mathPres", "MathCAT"))
    open(os.path.join(pkg, "mathPres", "__init__.py"), "w").close()
    open(os.path.join(pkg, "mathPres", "MathCAT", "__init__.py"), "w").close()
    with io.open(os.path.join(pkg, "mathPres", "MathCAT", "localization.py"), "w", encoding="utf-8") as f:
        f.write("def getLanguageToUse():\n    return 'en'   # NVDA: 'Auto' -> 'en'\n")
    with io.open(os.path.join(pkg, "mathPres", "MathCAT", "speech.py"), "w", encoding="utf-8") as f:
        f.write(src)                           # verbatim NVDA source
    sys.path.insert(0, pkg)
    from mathPres.MathCAT.speech import convertSSMLTextForNVDA
    return convertSSMLTextForNVDA


def viewer_line(convert, ssml):
    seq = convert(ssml)
    return "  ".join(x for x in seq if isinstance(x, str))   # speechViewer.py L202


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
    meta = {"generatedBy": "nvda_reference.py", "nvda": NVDA_TAG, "synth": "oneCore",
            "source": SPEECH_PY}
    with io.open(os.path.join(HERE, target), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"meta": meta, "rows": out}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"wrote {target}: {len(out)} rows")


if __name__ == "__main__":
    main()
