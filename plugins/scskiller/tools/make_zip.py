"""Zip a plugin folder with forward-slash entries (Decky's installer requires them).

Usage: python tools/make_zip.py <folder-to-zip> <output.zip> [root-name]

`folder-to-zip` is the staged plugin directory; the archive contains `root-name/...`
(defaults to the folder name).
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__.strip())
        return 2
    folder = Path(argv[1])
    output = Path(argv[2])
    root = argv[3] if len(argv) > 3 else folder.name
    if not folder.is_dir():
        print(f"not a folder: {folder}")
        return 2
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(folder.rglob("*")):
            if path.is_file():
                archive.write(path, f"{root}/{path.relative_to(folder).as_posix()}")
    print(f"{output} ({output.stat().st_size} bytes, {len(zipfile.ZipFile(output).infolist())} entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
