"""Package and release the Decky plugins of this repository.

One plugin is any folder under `plugins/` that holds both `plugin.json` (the loader
metadata, including the loader key `name`) and `package.json` (the version).

    python tools/release.py list                     # one line per plugin
    python tools/release.py matrix                   # GitHub Actions matrix (JSON)
    python tools/release.py package <plugin> --out-dir <dir>
    python tools/release.py notes <plugin>           # release body on stdout

`<plugin>` is either the folder name (`scskiller`) or its path.

The archive is named `<plugin.json name>-decky-<version>.zip` and contains one
top-level folder with the loader key (`SCSKiller/...`), so Decky's "Install from zip
file" drops it in `homebrew/plugins/SCSKiller`.

Every entry uses forward slashes: Decky's installer cannot extract the backslashes
that `Compress-Archive` writes. Timestamps are fixed, so the same sources always
produce the same bytes and an artifact can be compared with the copy committed in
`releases/`.

Beside `plugin.json`, `package.json`, `main.py`, the READMEs, `LICENSE`, `dist/` and
`src/`, an archive ships the extra files (runtime helpers) listed in
`package.json` -> `decky.ship`, so the dev probes in `tools/` stay out of an install.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PLUGINS = REPO / "plugins"
RELEASES = REPO / "releases"

# What a Decky install needs, plus the sources the earlier archives shipped.
ROOT_FILES = ("plugin.json", "package.json", "main.py", "README.md", "README.fr.md", "LICENSE")
ROOT_DIRS = ("dist", "src")
SKIP_PARTS = {"node_modules", "__pycache__", ".stage", ".rollup.cache", "screenshots", "tests", "shots"}
FIXED_TIME = (1980, 1, 1, 0, 0, 0)
MAX_COMMITS = 20


@dataclass(frozen=True)
class Plugin:
    folder: str
    name: str
    version: str
    description: str
    ship: tuple[str, ...] = ()

    @property
    def path(self) -> Path:
        return PLUGINS / self.folder

    @property
    def tag(self) -> str:
        return f"{self.name}-v{self.version}"

    @property
    def asset(self) -> str:
        return f"{self.name}-decky-{self.version}.zip"


def load(folder: Path) -> Plugin:
    meta = json.loads((folder / "plugin.json").read_text(encoding="utf-8"))
    package = json.loads((folder / "package.json").read_text(encoding="utf-8"))
    publish = meta.get("publish") or {}
    decky = package.get("decky") or {}
    return Plugin(
        folder=folder.name,
        name=meta["name"],
        version=package["version"],
        description=str(publish.get("description") or "").strip(),
        ship=tuple(str(entry).replace("\\", "/") for entry in decky.get("ship") or ()),
    )


def discover() -> list[Plugin]:
    plugins = []
    for folder in sorted(PLUGINS.iterdir()):
        if (folder / "plugin.json").is_file() and (folder / "package.json").is_file():
            plugins.append(load(folder))
    return plugins


def resolve(selector: str) -> Plugin:
    folder = Path(selector)
    if not folder.is_dir():
        folder = PLUGINS / selector
    if not folder.is_dir():
        raise SystemExit(f"no such plugin folder: {selector}")
    return load(folder.resolve())


def members(plugin: Plugin) -> list[Path]:
    """Relative paths to put in the archive, sorted."""
    found: set[Path] = set()
    for name in ROOT_FILES:
        path = plugin.path / name
        if path.is_file():
            found.add(Path(name))
    for name in ROOT_DIRS:
        base = plugin.path / name
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            rel = path.relative_to(plugin.path)
            if path.is_file() and not (set(rel.parts) & SKIP_PARTS):
                found.add(rel)
    # Dev probes live next to the runtime helpers, so a helper ships only when the
    # plugin lists it in `package.json` -> decky.ship (e.g. "tools/switch.ps1").
    for name in plugin.ship:
        path = plugin.path / name
        if not path.is_file():
            raise SystemExit(f"{plugin.folder}: package.json decky.ship lists a missing file: {name}")
        found.add(Path(name))
    return sorted(found, key=lambda p: p.as_posix())


def package(plugin: Plugin, out_dir: Path) -> Path:
    files = members(plugin)
    missing = [name for name in ("plugin.json", "dist/index.js") if Path(name) not in files]
    if missing:
        raise SystemExit(
            f"{plugin.folder}: missing {' and '.join(missing)} - build the bundle first (npm run build)"
        )
    out_dir.mkdir(parents=True, exist_ok=True)
    archive = out_dir / plugin.asset
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for rel in files:
            info = zipfile.ZipInfo(f"{plugin.name}/{rel.as_posix()}", date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            bundle.writestr(info, (plugin.path / rel).read_bytes())
    print(f"{archive} ({archive.stat().st_size} bytes, {len(files)} entries)")
    return archive


def git(*args: str) -> str:
    try:
        done = subprocess.run(
            ["git", *args], cwd=REPO, capture_output=True, text=True, check=False
        )
    except OSError:
        return ""
    return done.stdout.strip() if done.returncode == 0 else ""


def changes(plugin: Plugin) -> list[str]:
    tags = [
        tag
        for tag in git("tag", "--list", f"{plugin.name}-v*", "--sort=-v:refname").split()
        if tag != plugin.tag
    ]
    scope = f"plugins/{plugin.folder}"
    if tags:
        log = git("log", "--oneline", "--no-merges", f"{tags[0]}..HEAD", "--", scope)
        if not log:
            log = git("log", "--oneline", "--no-merges", "-n", str(MAX_COMMITS), f"{tags[0]}..HEAD")
        return [line for line in log.splitlines() if line][:MAX_COMMITS]
    log = git("log", "--oneline", "--no-merges", "-n", str(MAX_COMMITS), "--", scope)
    return [line for line in log.splitlines() if line]


def notes(plugin: Plugin) -> str:
    lines = [f"{plugin.description}", ""] if plugin.description else []
    lines += [
        "## Install",
        "",
        f"1. Download **{plugin.asset}** below.",
        '2. Decky Loader: open the plugin list menu and choose **Install from zip file**.',
        "3. Restart Steam so the loader reloads the plugin (and its Python backend).",
        "",
        f"The same archive is committed in the repository at `releases/{plugin.asset}`.",
        "",
        "## Changes",
        "",
    ]
    commits = changes(plugin)
    if commits:
        lines += [f"* {commit}" for commit in commits]
        if len(commits) >= MAX_COMMITS:
            lines.append("* ...")
    else:
        lines.append("* First packaged release.")
    lines += ["", "---", "Built and published by `.github/workflows/release.yml`."]
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="one line per plugin")

    matrix = sub.add_parser("matrix", help="JSON matrix for GitHub Actions")

    pack = sub.add_parser("package", help="build the installable zip")
    pack.add_argument("plugin")
    pack.add_argument("--out-dir", default=str(RELEASES))

    body = sub.add_parser("notes", help="release body on stdout")
    body.add_argument("plugin")

    args = parser.parse_args(argv)

    if args.command == "list":
        for plugin in discover():
            print(f"{plugin.folder:24} {plugin.name:16} {plugin.version:10} {plugin.tag:26} {plugin.asset}")
        return 0

    if args.command == "matrix":
        # `fromJSON` needs an object with an `include` key; a bare array fails the
        # job expansion silently (the run goes red without any job).
        include = [
            {"folder": p.folder, "name": p.name, "version": p.version, "tag": p.tag, "asset": p.asset}
            for p in discover()
        ]
        print(json.dumps({"include": include}))
        return 0

    if args.command == "package":
        package(resolve(args.plugin), Path(args.out_dir))
        return 0

    if args.command == "notes":
        sys.stdout.write(notes(resolve(args.plugin)))
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
