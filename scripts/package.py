"""Package only the local extension and the Czech quick-start manual."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "extension/manifest.json").read_text())["version"]
name = f"termin-{version}"
output = root / "dist"
output.mkdir(exist_ok=True)
archive = output / f"{name}.zip"
files = sorted(path for path in (root / "extension").rglob("*") if path.is_file())
files.append(root / "NAVOD.md")
assert all(not path.is_symlink() for path in files)
assert all(path.suffix in {".json", ".js", ".html", ".css", ".md", ".png"} for path in files)
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
    for path in files:
        bundle.write(path, f"{name}/{path.relative_to(root).as_posix()}")
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    for path in files:
        assert bundle.read(f"{name}/{path.relative_to(root).as_posix()}") == path.read_bytes()
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / "SHA256SUMS.txt").write_text(f"{digest}  {archive.name}\n")
print(f"Created and verified {archive.relative_to(root)} ({len(files)} files, {archive.stat().st_size:,} bytes)")
