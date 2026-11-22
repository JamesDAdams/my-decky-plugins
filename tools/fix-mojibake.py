"""Repair the UTF-8 -> cp1252 -> UTF-8 corruption that PowerShell pipelines cause.

Writing a source file through `Get-Content -Raw | Set-Content -Encoding utf8` in a
non-UTF-8 console turns every non-ASCII byte into mojibake: `—` becomes `â€”`,
`é` becomes `Ã©`, `→` becomes `â†’`. This script walks each run of high characters,
re-decodes the run with cp1252 and then with UTF-8, and keeps the repair only when
that round trip is exact.

Usage:
    python tools/fix-mojibake.py --check FILE...    # report, change nothing
    python tools/fix-mojibake.py FILE...            # repair in place
"""

from __future__ import annotations

import sys


def _candidates() -> set[str]:
    out: set[str] = set()
    for byte in range(0x80, 0x100):
        try:
            out.add(bytes([byte]).decode("cp1252"))
        except UnicodeDecodeError:  # undefined cp1252 slots (0x81, 0x8d, 0x8f...)
            continue
    return out


CANDIDATES = _candidates()


def repair(text: str) -> tuple[str, int]:
    """Return (repaired text, number of runs repaired)."""
    out: list[str] = []
    repaired = 0
    index = 0
    length = len(text)
    while index < length:
        if text[index] not in CANDIDATES:
            out.append(text[index])
            index += 1
            continue
        end = index
        while end < length and text[end] in CANDIDATES:
            end += 1
        run = text[index:end]
        try:
            out.append(run.encode("cp1252").decode("utf-8"))
            repaired += 1
        except (UnicodeEncodeError, UnicodeDecodeError):
            out.append(run)  # legitimate accented text, not mojibake
        index = end
    return "".join(out), repaired


def main(argv: list[str]) -> int:
    check = "--check" in argv
    paths = [a for a in argv if not a.startswith("--")]
    total = 0
    for path in paths:
        with open(path, encoding="utf-8") as handle:
            original = handle.read()
        fixed, count = repair(original)
        if count and not check:
            with open(path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(fixed)
        if count:
            print(f"{'would repair' if check else 'repaired'} {path}: {count} run(s)")
        total += count
    return 0 if total or check else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
