"""Focused tests for the networked Agent Feed artifact verifier."""

from __future__ import annotations

import base64
import hashlib
import tempfile
import unittest
from pathlib import Path
from urllib.request import Request

from scripts.verify_agent_feed_artifact import (
    ArtifactVerificationError,
    PinnedRedirectHandler,
    download_artifact,
    verify_artifact_bytes,
    verify_artifact_file,
    validate_artifact_url,
)


def metadata(payload: bytes, *, url: str = "https://github.com/example/release/artifact.tgz") -> dict[str, object]:
    return {
        "url": url,
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "integrity": "sha512-" + base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii"),
    }


class FakeResponse:
    def __init__(self, payload: bytes, *, content_length: str | None = None, final_url: str | None = None) -> None:
        self.payload = payload
        self.content_length = content_length
        self.final_url = final_url or "https://github.com/example/release/artifact.tgz"
        self.offset = 0
        self.read_sizes: list[int] = []

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, amount: int = -1) -> bytes:
        self.read_sizes.append(amount)
        if amount < 0:
            amount = len(self.payload) - self.offset
        chunk = self.payload[self.offset : self.offset + amount]
        self.offset += len(chunk)
        return chunk

    def getheader(self, name: str, default: str | None = None) -> str | None:
        if name.lower() == "content-length":
            return self.content_length if self.content_length is not None else default
        return default

    def geturl(self) -> str:
        return self.final_url


class FakeOpener:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response
        self.request: Request | None = None
        self.timeout: float | None = None

    def open(self, request: Request, timeout: float) -> FakeResponse:
        self.request = request
        self.timeout = timeout
        return self.response


class ArtifactVerifierTests(unittest.TestCase):
    PAYLOAD = b"schema bytes that are intentionally small\n"

    def test_verify_bytes_success(self) -> None:
        expected = metadata(self.PAYLOAD)
        digest = verify_artifact_bytes(self.PAYLOAD, expected)
        self.assertEqual(digest.bytes, len(self.PAYLOAD))
        self.assertEqual(digest.sha256, expected["sha256"])
        self.assertEqual(digest.integrity, expected["integrity"])

    def test_one_byte_tampering_fails(self) -> None:
        expected = metadata(self.PAYLOAD)
        tampered = self.PAYLOAD[:-1] + bytes([self.PAYLOAD[-1] ^ 1])
        with self.assertRaises(ArtifactVerificationError):
            verify_artifact_bytes(tampered, expected)

    def test_wrong_length_fails(self) -> None:
        expected = metadata(self.PAYLOAD)
        expected["bytes"] = len(self.PAYLOAD) + 1
        with self.assertRaisesRegex(ArtifactVerificationError, "byte length"):
            verify_artifact_bytes(self.PAYLOAD, expected)

    def test_wrong_sha256_fails(self) -> None:
        expected = metadata(self.PAYLOAD)
        expected["sha256"] = "0" * 64
        with self.assertRaisesRegex(ArtifactVerificationError, "SHA-256"):
            verify_artifact_bytes(self.PAYLOAD, expected)

    def test_wrong_sha512_sri_fails(self) -> None:
        expected = metadata(self.PAYLOAD)
        expected["integrity"] = "sha512-" + base64.b64encode(b"wrong digest").decode("ascii")
        with self.assertRaisesRegex(ArtifactVerificationError, "integrity"):
            verify_artifact_bytes(self.PAYLOAD, expected)

    def test_file_verification_uses_same_byte_function(self) -> None:
        expected = metadata(self.PAYLOAD)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "schema.tgz"
            path.write_bytes(self.PAYLOAD)
            self.assertEqual(verify_artifact_file(path, expected).sha256, expected["sha256"])
            path.write_bytes(self.PAYLOAD + b"x")
            with self.assertRaises(ArtifactVerificationError):
                verify_artifact_file(path, expected)

    def test_download_is_bounded_and_verified_by_caller(self) -> None:
        expected = metadata(self.PAYLOAD)
        response = FakeResponse(self.PAYLOAD, content_length=str(len(self.PAYLOAD)))
        opener = FakeOpener(response)
        payload = download_artifact(
            expected["url"],
            expected_bytes=expected["bytes"],
            timeout=3,
            opener=opener,
        )
        self.assertEqual(payload, self.PAYLOAD)
        self.assertEqual(opener.timeout, 3)
        self.assertIsNotNone(opener.request)
        self.assertEqual(opener.request.get_header("Accept"), "application/octet-stream")
        verify_artifact_bytes(payload, expected)
        self.assertTrue(all(size <= len(self.PAYLOAD) + 1 for size in response.read_sizes))

    def test_download_rejects_wrong_content_length_before_reading(self) -> None:
        expected = metadata(self.PAYLOAD)
        response = FakeResponse(self.PAYLOAD, content_length=str(len(self.PAYLOAD) + 1))
        with self.assertRaisesRegex(ArtifactVerificationError, "Content-Length"):
            download_artifact(
                expected["url"],
                expected_bytes=expected["bytes"],
                opener=FakeOpener(response),
            )
        self.assertEqual(response.read_sizes, [])

    def test_download_rejects_oversized_payload(self) -> None:
        expected = metadata(self.PAYLOAD)
        response = FakeResponse(self.PAYLOAD + b"x", content_length=None)
        with self.assertRaisesRegex(ArtifactVerificationError, "pinned artifact length"):
            download_artifact(
                expected["url"],
                expected_bytes=expected["bytes"],
                opener=FakeOpener(response),
            )

    def test_invalid_initial_url_fails_closed(self) -> None:
        for url in (
            "http://github.com/example/release/artifact.tgz",
            "https://user:pass@github.com/example/release/artifact.tgz",
            "https://github.com/example/release/artifact.tgz?mutable=1",
            "https://evil.example/example/release/artifact.tgz",
            "https://evil.githubusercontent.com/example/release/artifact.tgz",
            "https://github.com/example/release/artifact.tgz\nmalicious",
        ):
            with self.subTest(url=url), self.assertRaises(ArtifactVerificationError):
                validate_artifact_url(url)

    def test_redirect_policy_allows_release_asset_but_rejects_hostile_target(self) -> None:
        handler = PinnedRedirectHandler()
        request = Request("https://github.com/example/release/artifact.tgz")
        safe = handler.redirect_request(
            request,
            None,
            302,
            "Found",
            {},
            "https://release-assets.githubusercontent.com/assets/artifact.tgz?token=one",
        )
        self.assertIsNotNone(safe)
        for target in (
            "http://release-assets.githubusercontent.com/assets/artifact.tgz",
            "https://evil.example/assets/artifact.tgz",
        ):
            with self.subTest(target=target), self.assertRaises(ArtifactVerificationError):
                handler.redirect_request(request, None, 302, "Found", {}, target)


if __name__ == "__main__":
    unittest.main()
