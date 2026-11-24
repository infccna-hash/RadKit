#!/usr/bin/env python3
"""Check a RadKit share against the REAL Orthanc anonymizer (the test-suite only has a mock).

Usage (on the server, or any machine that can reach the app):
    pip install pydicom
    python3 scripts/check_share_anon.py http://HOST/s/<token> "BENSMAIN YASSINE" P123456 19800101 [more canaries...]

Give it the patient's real name (Latin AND Arabic spellings if known), IDs, birth date in the spellings used
locally (19800101, 01/01/1980, 1980/01/01), institution... It downloads the share ZIP and the public JSON
payloads, walks EVERY DICOM element (sequences and private tags included) and reports any canary it finds.
Exit code 0 = clean, 1 = identifier found, 2 = could not check.

What it cannot see: text burned into the pixels (ultrasound, scanned documents). That still needs a human look,
which is why RadKit asks for confirmation before sharing those modalities.
"""
import io
import json
import re
import sys
import unicodedata
import urllib.request
import zipfile

try:
    import pydicom
except ImportError:
    sys.exit("pydicom is required: pip install pydicom")


# Same folding as api/src/lib/deid.js: any script (Latin, Arabic...), combining marks removed (accents, harakat),
# Arabic letter variants folded, tatweel dropped, Arabic-Indic digits mapped to 0-9.
AR_FOLD = str.maketrans({"\u0623": "\u0627", "\u0625": "\u0627", "\u0622": "\u0627", "\u0671": "\u0627",
                         "\u0649": "\u064a", "\u0629": "\u0647", "\u0624": "\u0648", "\u0626": "\u064a",
                         "\u0640": None,
                         **{chr(0x660 + i): str(i) for i in range(10)}, **{chr(0x6F0 + i): str(i) for i in range(10)}})


def norm(s):
    t = unicodedata.normalize("NFKD", str(s))
    t = "".join(ch for ch in t if not unicodedata.category(ch).startswith("M")).lower()
    return t.translate(AR_FOLD)


def canary_tokens(args):
    """Words of >=3 letters/digits in any script; dates and IDs keep / . - inside them."""
    out = set()
    for c in args:
        for w in re.split(r"[^\w/.-]+", norm(c)):
            w = w.strip("/.-_")
            if len(w) >= 3:
                out.add(w)
    return out


def patterns(tokens):
    return {t: re.compile(rf"(?<![^\W_]){re.escape(t)}(?![^\W_])") for t in tokens}


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    m = re.match(r"(https?://[^/]+)/s/([\w-]+)", sys.argv[1])
    if not m:
        print("First argument must be a share link: http://HOST/s/<token>")
        return 2
    base, token = m.groups()
    tokens = canary_tokens(sys.argv[2:])
    pats = patterns(tokens)
    hits = []

    def scan(where, text):
        n = norm(text)
        for t, p in pats.items():
            if p.search(n):
                hits.append((where, t, str(text)[:80]))

    # 1) public JSON payloads (share page + lite viewer manifest)
    for path in (f"/api/public/shares/{token}", f"/api/public/shares/{token}/lite"):
        try:
            with urllib.request.urlopen(base + path, timeout=120) as r:
                scan(path, json.dumps(json.load(r), ensure_ascii=False))
        except Exception as e:  # noqa: BLE001
            print(f"! {path}: {e}")
            return 2

    # 2) the anonymized DICOM copy, element by element
    try:
        with urllib.request.urlopen(f"{base}/api/public/shares/{token}/download", timeout=3600) as r:
            data = r.read()
        z = zipfile.ZipFile(io.BytesIO(data))
        bad = z.testzip()
        if bad:
            print(f"! corrupt ZIP member: {bad}")
            return 2
    except Exception as e:  # noqa: BLE001
        print(f"! download: {e}")
        return 2

    def walk(ds, prefix, fname):
        for el in ds:
            name = el.keyword or str(el.tag)
            if el.VR == "SQ":
                for i, item in enumerate(el.value or []):
                    walk(item, f"{prefix}{name}[{i}].", fname)
            elif el.VR not in ("OB", "OW", "OF", "OD", "OL", "UN") and el.value not in (None, ""):
                scan(f"{fname}:{prefix}{name}", el.value)

    files = 0
    for member in z.namelist():
        if member.endswith("/"):
            continue
        try:
            ds = pydicom.dcmread(io.BytesIO(z.read(member)), force=True, stop_before_pixels=True)
        except Exception:  # noqa: BLE001
            continue
        files += 1
        walk(ds, "", member.rsplit("/", 1)[-1])

    print(f"checked {files} DICOM files + 2 JSON payloads for {len(tokens)} canaries: {sorted(tokens)}")
    if not hits:
        print("OK: no identifier found")
        return 0
    seen = set()
    for where, t, text in hits:
        key = (where.split(":", 1)[-1], t)
        if key in seen:
            continue
        seen.add(key)
        print(f"LEAK  {t!r:14} in {where}  ->  {text}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
