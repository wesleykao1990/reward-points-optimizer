#!/usr/bin/env python3
"""Write or verify package SHA-256 checksums.

`--check` is strictly non-mutating and exits non-zero for a mismatch, missing file,
or untracked package file. Unknown arguments fail through argparse.
"""

from __future__ import annotations

import argparse
import sys
from hashlib import sha256
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "SHA256SUMS.txt"
EXCLUDED_NAMES = {OUT.name}
EXCLUDED_PARTS = {
    "__pycache__",
    ".git",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".turbo",
    ".venv",
    "coverage",
    "dist",
    "node_modules",
}


def package_files() -> list[Path]:
    return sorted(
        path
        for path in BASE.rglob("*")
        if path.is_file()
        and path.name not in EXCLUDED_NAMES
        and path.suffix != ".tsbuildinfo"
        and not any(part in EXCLUDED_PARTS for part in path.parts)
    )


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def current_rows() -> dict[str, str]:
    return {path.relative_to(BASE).as_posix(): digest(path) for path in package_files()}


def write_checksums() -> int:
    rows = current_rows()
    OUT.write_text(
        "".join(f"{value}  {name}\n" for name, value in sorted(rows.items())),
        encoding="utf-8",
    )
    print(f"Wrote {len(rows)} checksums to {OUT}")
    return 0


def read_expected() -> dict[str, str]:
    if not OUT.is_file():
        raise FileNotFoundError(f"Checksum file does not exist: {OUT}")
    expected: dict[str, str] = {}
    for line_number, raw in enumerate(OUT.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip():
            continue
        parts = raw.split("  ", 1)
        if len(parts) != 2 or len(parts[0]) != 64:
            raise ValueError(f"Malformed checksum line {line_number}: {raw!r}")
        checksum, name = parts
        if name in expected:
            raise ValueError(f"Duplicate checksum entry: {name}")
        expected[name] = checksum
    return expected


def check_checksums() -> int:
    try:
        expected = read_expected()
    except Exception as exc:
        print(f"CHECKSUM CHECK FAILED: {exc}", file=sys.stderr)
        return 1
    actual = current_rows()
    missing = sorted(set(expected) - set(actual))
    untracked = sorted(set(actual) - set(expected))
    mismatched = sorted(name for name in set(expected) & set(actual) if expected[name] != actual[name])
    if missing or untracked or mismatched:
        print("CHECKSUM CHECK FAILED", file=sys.stderr)
        if missing:
            print(f"  missing files: {missing}", file=sys.stderr)
        if untracked:
            print(f"  untracked files: {untracked}", file=sys.stderr)
        if mismatched:
            print(f"  mismatched files: {mismatched}", file=sys.stderr)
        return 1
    print(f"Verified {len(actual)} package checksums without modifying {OUT}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--write", action="store_true", help="Intentionally replace SHA256SUMS.txt")
    modes.add_argument("--check", action="store_true", help="Verify without writing any file")
    args = parser.parse_args()
    return write_checksums() if args.write else check_checksums()


if __name__ == "__main__":
    raise SystemExit(main())
