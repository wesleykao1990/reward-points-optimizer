#!/usr/bin/env python3
"""Verify the bytes of the pinned Agent Feed schema release artifact.

The package validator intentionally remains offline and checks that the lock is
internally consistent.  This verifier is the separate, networked check: it
loads the committed protocol lock, fetches only its HTTPS artifact URL, and
compares the downloaded bytes with the independently committed length,
SHA-256, and SHA-512 SRI values.

The downloader is deliberately bounded.  It rejects non-HTTPS URLs, URL
credentials/query strings/fragments, redirects outside GitHub's release asset
hosts, invalid Content-Length values, oversized responses, and downloads that
exceed the deadline.  The byte and file verification functions do not perform
network access and are suitable for hostile-input tests.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import hmac
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Mapping, NamedTuple, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import (
    HTTPRedirectHandler,
    Request,
    build_opener,
)

BASE = Path(__file__).resolve().parents[1]
DEFAULT_LOCK = BASE / "packages/agent-feed-consumer/protocol-lock.json"

# The published tarball is tiny, but the bound must not depend solely on a
# mutable or malformed lock value.  The extra byte read below detects a
# response that is longer than the pinned length without buffering it.
MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024
DOWNLOAD_TIMEOUT_SECONDS = 30.0
READ_CHUNK_BYTES = 64 * 1024
MAX_REDIRECTS = 5

# GitHub's release URL normally redirects to one of the latter hosts.  Keep
# the policy narrow enough that a compromised redirect cannot send CI to an
# arbitrary HTTPS host, while allowing GitHub's documented release-asset
# infrastructure.
ALLOWED_REDIRECT_HOSTS = frozenset(
    {
        "github.com",
        "www.github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
        "github-releases.githubusercontent.com",
    }
)
HEX_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
SRI_SHA512 = re.compile(r"^sha512-[A-Za-z0-9+/]+=*$")


class ArtifactVerificationError(ValueError):
    """Raised when an artifact or its fetch policy fails closed."""


class ArtifactDigest(NamedTuple):
    """The measurements computed from one artifact byte stream."""

    bytes: int
    sha256: str
    integrity: str


class ResponseLike(Protocol):
    """The small response surface needed by :func:`download_artifact`."""

    def read(self, amount: int = -1) -> bytes: ...

    def getheader(self, name: str, default: str | None = None) -> str | None: ...

    def geturl(self) -> str: ...


class OpenerLike(Protocol):
    def open(self, request: Request, timeout: float) -> ResponseLike: ...


def _artifact_value(artifact: Mapping[str, Any], key: str) -> Any:
    try:
        return artifact[key]
    except (KeyError, TypeError) as exc:
        raise ArtifactVerificationError(f"artifact metadata is missing {key!r}") from exc


def validate_artifact_metadata(artifact: Mapping[str, Any]) -> None:
    """Validate the metadata required to compare an artifact's bytes.

    This does not assert the digest values themselves; those are checked by
    ``verify_artifact_bytes``.  It does reject ambiguous metadata so a caller
    cannot accidentally compare against a malformed or unbounded expectation.
    """

    if not isinstance(artifact, Mapping):
        raise ArtifactVerificationError("schema_artifact must be an object")

    url = _artifact_value(artifact, "url")
    if not isinstance(url, str):
        raise ArtifactVerificationError("artifact URL must be a string")
    validate_artifact_url(url)

    expected_bytes = _artifact_value(artifact, "bytes")
    if isinstance(expected_bytes, bool) or not isinstance(expected_bytes, int):
        raise ArtifactVerificationError("artifact byte length must be an integer")
    if expected_bytes <= 0:
        raise ArtifactVerificationError("artifact byte length must be positive")
    if expected_bytes > MAX_DOWNLOAD_BYTES:
        raise ArtifactVerificationError(
            f"artifact byte length exceeds safety limit ({MAX_DOWNLOAD_BYTES} bytes)"
        )

    sha256 = _artifact_value(artifact, "sha256")
    if not isinstance(sha256, str) or HEX_SHA256.fullmatch(sha256) is None:
        raise ArtifactVerificationError("artifact SHA-256 must be 64 hexadecimal characters")

    integrity = _artifact_value(artifact, "integrity")
    if not isinstance(integrity, str) or SRI_SHA512.fullmatch(integrity) is None:
        raise ArtifactVerificationError("artifact integrity must be a sha512 SRI value")
    encoded = integrity.removeprefix("sha512-")
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ArtifactVerificationError("artifact integrity is not valid base64") from exc
    if len(decoded) != hashlib.sha512().digest_size:
        raise ArtifactVerificationError("artifact integrity must encode a SHA-512 digest")


def _hostname_allowed(hostname: str) -> bool:
    return hostname.lower() in ALLOWED_REDIRECT_HOSTS


def validate_artifact_url(url: str, *, redirect: bool = False) -> None:
    """Require a safe HTTPS URL for the pinned release and its redirects."""

    if not isinstance(url, str) or not url:
        raise ArtifactVerificationError("artifact URL must be a non-empty string")
    if any(character.isspace() or ord(character) < 0x20 for character in url):
        raise ArtifactVerificationError("artifact URL must not contain whitespace or control characters")
    try:
        parsed = urlsplit(url)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise ArtifactVerificationError(f"invalid artifact URL: {exc}") from exc
    if parsed.scheme.lower() != "https":
        raise ArtifactVerificationError("artifact URL must use HTTPS")
    if hostname is None or not _hostname_allowed(hostname):
        raise ArtifactVerificationError(
            f"artifact URL host is not an allowed GitHub release host: {hostname!r}"
        )
    if parsed.username is not None or parsed.password is not None:
        raise ArtifactVerificationError("artifact URL must not contain credentials")
    if port is not None and port != 443:
        raise ArtifactVerificationError("artifact URL must use the default HTTPS port")
    if parsed.query or parsed.fragment:
        # The committed release URL has neither.  Redirected signed asset URLs
        # can carry a query token, so permit it only after the first hop.
        if not redirect:
            raise ArtifactVerificationError("pinned artifact URL must not contain query or fragment")
    if not parsed.path or parsed.path == "/":
        raise ArtifactVerificationError("artifact URL must include a release asset path")


class PinnedRedirectHandler(HTTPRedirectHandler):
    """Follow only HTTPS redirects that stay within GitHub's asset hosts."""

    max_redirections = MAX_REDIRECTS

    def redirect_request(
        self,
        req: Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> Request:
        validate_artifact_url(newurl, redirect=True)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _read_bounded(
    response: ResponseLike,
    *,
    expected_bytes: int,
    timeout: float,
) -> bytes:
    """Read at most ``expected_bytes + 1`` bytes before rejecting."""

    if timeout <= 0:
        raise ArtifactVerificationError("download timeout must be positive")
    content_length = response.getheader("Content-Length")
    if content_length is not None:
        try:
            declared_length = int(content_length)
        except (TypeError, ValueError) as exc:
            raise ArtifactVerificationError("response Content-Length is invalid") from exc
        if declared_length < 0:
            raise ArtifactVerificationError("response Content-Length is negative")
        if declared_length > MAX_DOWNLOAD_BYTES:
            raise ArtifactVerificationError("response exceeds the download size limit")
        if declared_length != expected_bytes:
            raise ArtifactVerificationError(
                f"response Content-Length {declared_length} does not match pinned length {expected_bytes}"
            )

    deadline = time.monotonic() + timeout
    chunks: list[bytes] = []
    total = 0
    read_limit = expected_bytes + 1
    while True:
        remaining = read_limit - total
        if remaining <= 0:
            raise ArtifactVerificationError("response exceeds the pinned artifact length")
        if time.monotonic() > deadline:
            raise ArtifactVerificationError("artifact download exceeded the time limit")
        chunk = response.read(min(READ_CHUNK_BYTES, remaining))
        if not isinstance(chunk, bytes):
            raise ArtifactVerificationError("response returned non-byte data")
        if not chunk:
            break
        total += len(chunk)
        if total > expected_bytes:
            raise ArtifactVerificationError("response exceeds the pinned artifact length")
        chunks.append(chunk)
    if time.monotonic() > deadline:
        raise ArtifactVerificationError("artifact download exceeded the time limit")
    return b"".join(chunks)


def download_artifact(
    url: str,
    *,
    expected_bytes: int,
    timeout: float = DOWNLOAD_TIMEOUT_SECONDS,
    opener: OpenerLike | None = None,
) -> bytes:
    """Fetch one pinned artifact with bounded size/time and safe redirects."""

    validate_artifact_url(url)
    if isinstance(expected_bytes, bool) or not isinstance(expected_bytes, int):
        raise ArtifactVerificationError("expected artifact byte length must be an integer")
    if expected_bytes <= 0 or expected_bytes > MAX_DOWNLOAD_BYTES:
        raise ArtifactVerificationError("expected artifact byte length is outside the safety limit")

    try:
        request = Request(
            url,
            headers={
                "Accept": "application/octet-stream",
                "User-Agent": "rewards-optimizer-agent-feed-verifier/1",
            },
            method="GET",
        )
    except (TypeError, ValueError) as exc:
        raise ArtifactVerificationError(f"could not construct artifact request: {exc}") from exc
    selected_opener = opener or build_opener(PinnedRedirectHandler())
    try:
        response = selected_opener.open(request, timeout=timeout)
        with response:
            final_url = response.geturl()
            validate_artifact_url(final_url, redirect=True)
            return _read_bounded(response, expected_bytes=expected_bytes, timeout=timeout)
    except ArtifactVerificationError:
        raise
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise ArtifactVerificationError(f"artifact download failed: {exc}") from exc


def _digest_bytes(payload: bytes) -> ArtifactDigest:
    if not isinstance(payload, bytes):
        raise ArtifactVerificationError("artifact payload must be bytes")
    sha256 = hashlib.sha256(payload).hexdigest()
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")
    return ArtifactDigest(bytes=len(payload), sha256=sha256, integrity=integrity)


def _check_digest(digest: ArtifactDigest, artifact: Mapping[str, Any]) -> None:
    validate_artifact_metadata(artifact)
    expected_bytes = _artifact_value(artifact, "bytes")
    expected_sha256 = _artifact_value(artifact, "sha256").lower()
    expected_integrity = _artifact_value(artifact, "integrity")
    failures: list[str] = []
    if digest.bytes != expected_bytes:
        failures.append(f"byte length {digest.bytes} != pinned {expected_bytes}")
    if not hmac.compare_digest(digest.sha256, expected_sha256):
        failures.append("SHA-256 does not match the protocol lock")
    if not hmac.compare_digest(digest.integrity, expected_integrity):
        failures.append("SHA-512 SRI does not match the protocol lock")
    if failures:
        raise ArtifactVerificationError("; ".join(failures))


def verify_artifact_bytes(payload: bytes, artifact: Mapping[str, Any]) -> ArtifactDigest:
    """Verify in-memory bytes against lock metadata without network access."""

    digest = _digest_bytes(payload)
    _check_digest(digest, artifact)
    return digest


def _iter_file(path: Path, *, expected_bytes: int) -> bytes:
    try:
        with path.open("rb") as handle:
            data = handle.read(expected_bytes + 1)
            if len(data) > expected_bytes:
                raise ArtifactVerificationError("artifact file exceeds the pinned length")
            if handle.read(1):
                raise ArtifactVerificationError("artifact file exceeds the pinned length")
            return data
    except ArtifactVerificationError:
        raise
    except OSError as exc:
        raise ArtifactVerificationError(f"could not read artifact file {path}: {exc}") from exc


def verify_artifact_file(path: str | Path, artifact: Mapping[str, Any]) -> ArtifactDigest:
    """Verify a local artifact file against lock metadata without network access."""

    validate_artifact_metadata(artifact)
    expected_bytes = _artifact_value(artifact, "bytes")
    return verify_artifact_bytes(_iter_file(Path(path), expected_bytes=expected_bytes), artifact)


def load_artifact_lock(path: str | Path = DEFAULT_LOCK) -> dict[str, Any]:
    """Read the canonical protocol lock and return its schema artifact pin."""

    lock_path = Path(path)
    try:
        with lock_path.open("r", encoding="utf-8") as handle:
            lock = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise ArtifactVerificationError(f"could not read protocol lock {lock_path}: {exc}") from exc
    if not isinstance(lock, dict):
        raise ArtifactVerificationError("protocol lock must be a JSON object")
    artifact = lock.get("schema_artifact")
    if not isinstance(artifact, dict):
        raise ArtifactVerificationError("protocol lock is missing schema_artifact")
    validate_artifact_metadata(artifact)
    return artifact


def verify_locked_artifact(
    lock_path: str | Path = DEFAULT_LOCK,
    *,
    timeout: float = DOWNLOAD_TIMEOUT_SECONDS,
    opener: OpenerLike | None = None,
) -> ArtifactDigest:
    """Fetch and verify the schema artifact named by a protocol lock."""

    artifact = load_artifact_lock(lock_path)
    payload = download_artifact(
        _artifact_value(artifact, "url"),
        expected_bytes=_artifact_value(artifact, "bytes"),
        timeout=timeout,
        opener=opener,
    )
    return verify_artifact_bytes(payload, artifact)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--lock",
        type=Path,
        default=DEFAULT_LOCK,
        help=f"protocol lock to verify (default: {DEFAULT_LOCK})",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DOWNLOAD_TIMEOUT_SECONDS,
        help=f"per-download timeout in seconds (default: {DOWNLOAD_TIMEOUT_SECONDS:g})",
    )
    args = parser.parse_args(argv)
    try:
        artifact = load_artifact_lock(args.lock)
        digest = verify_locked_artifact(args.lock, timeout=args.timeout)
    except ArtifactVerificationError as exc:
        print(f"AGENT FEED ARTIFACT VERIFICATION FAILED: {exc}", file=sys.stderr)
        return 1
    print("Agent Feed schema artifact bytes verified")
    print(f"  URL: {_artifact_value(artifact, 'url')}")
    print(f"  bytes: {digest.bytes}")
    print(f"  SHA-256: {digest.sha256}")
    print(f"  SHA-512 SRI: {digest.integrity}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
