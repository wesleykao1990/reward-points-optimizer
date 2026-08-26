from pathlib import Path
import re

path = Path("scripts/complete_liquid_glass_assets.mjs")
text = path.read_text()

# The recovery pipeline already carries the official-source plumbing in main.
# Keep these six card IDs pinned to the reference-faithful card-face captures
# instead of older square/logo payment assets that share the same IDs.
marker = "const LOCAL_OFFICIAL_ART = Object.freeze({"
if marker not in text:
    raise SystemExit("LOCAL_OFFICIAL_ART marker missing")

local_entries = {
    "instrument.card.aeon": "reference-official/aeon-card-face.png",
    "instrument.card.d": "reference-official/d-card-face.png",
    "instrument.card.mitsui-sumitomo-card-nl": "reference-official/smbc-nl-card-face.png",
    "instrument.card.paypay-card": "reference-official/paypay-card-face.png",
    "instrument.card.rakuten-card": "reference-official/rakuten-card-face.png",
    "instrument.card.view-card-standard": "reference-official/view-card-standard-face.png",
}

block_start = text.index(marker)
block_end = text.index("\n});", block_start)
block = text[block_start:block_end]

# Remove every stale duplicate for the affected IDs, then insert exactly one
# authoritative mapping for each. This is intentionally idempotent.
for asset_id in local_entries:
    block = re.sub(
        rf'\n\s*"{re.escape(asset_id)}"\s*:\s*"[^"]+"\s*,?',
        "",
        block,
    )

insert_lines = "\n".join(
    f'  "{asset_id}": "{filename}",'
    for asset_id, filename in local_entries.items()
)
block = block.replace(marker, f"{marker}\n{insert_lines}", 1)
text = text[:block_start] + block + text[block_end:]

required_markers = [
    "const EXPLICIT_IMAGE_OVERRIDES = Object.freeze({",
    "const EXPLICIT_SOURCE_PAGE_OVERRIDES = Object.freeze({",
    "EXPLICIT_SOURCE_PAGE_OVERRIDES[asset.id]",
    "EXPLICIT_IMAGE_OVERRIDES[resolved.id] ?? resolved.source_image_url",
    "referer: candidate.referer",
]
for required in required_markers:
    if required not in text:
        raise SystemExit(f"required explicit-source recovery marker missing: {required}")

path.write_text(text)
print("Normalized reference-faithful card artwork overrides")
