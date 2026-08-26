from pathlib import Path

path = Path("scripts/complete_liquid_glass_assets.mjs")
text = path.read_text()
old = '''    source_catalogue_deployment_commit_sha: catalogue.deployment_commit_sha,\n    aspect_ratio: usesCardLayout(asset) ? "85.60:53.98" : "3:2",\n    width: CARD_WIDTH,\n    height: CARD_HEIGHT,\n    canonical_count: EXPECTED_CANONICAL,'''
new = '''    source_catalogue_deployment_commit_sha: catalogue.deployment_commit_sha,\n    aspect_ratio: "mixed",\n    width: null,\n    height: null,\n    geometries: {\n      card: { aspect_ratio: "85.60:53.98", width: 856, height: 539.8 },\n      service: { aspect_ratio: "3:2", width: 672, height: 448 },\n    },\n    canonical_count: EXPECTED_CANONICAL,'''
if old not in text:
    if 'aspect_ratio: "mixed"' in text and 'geometries:' in text:
        print("Liquid Glass mixed manifest geometry already fixed")
        raise SystemExit(0)
    raise SystemExit("Liquid Glass manifest geometry target not found")
path.write_text(text.replace(old, new, 1))
print("Fixed Liquid Glass manifest geometry for mixed card/service layouts")
