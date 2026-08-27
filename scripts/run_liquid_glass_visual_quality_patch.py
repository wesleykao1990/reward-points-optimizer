from pathlib import Path

# The visual-quality patch intentionally embeds JavaScript regex literals such
# as /\s/u inside Python replacement strings. Python re.sub interprets those
# backslashes when the replacement is passed as a plain string. Execute an
# in-memory corrected copy that supplies replacement text through callables,
# preserving the JavaScript bytes verbatim.
source_path = Path("scripts/patch_liquid_glass_visual_quality.py")
source = source_path.read_text()

replacements = {
    '    new_css + "\\nfunction coverageRuntime() {",\n':
        '    lambda _match: new_css + "\\nfunction coverageRuntime() {",\n',
    '    new_coverage + "\\nfunction coverageSource() {",\n':
        '    lambda _match: new_coverage + "\\nfunction coverageSource() {",\n',
    '    new_svg + "\\nfunction outputPathFor(asset) {",\n':
        '    lambda _match: new_svg + "\\nfunction outputPathFor(asset) {",\n',
    '    new_batch_validation + "\\nasync function generateAssets(catalogue) {",\n':
        '    lambda _match: new_batch_validation + "\\nasync function generateAssets(catalogue) {",\n',
    '    new_validate + "\\n\\nasync function persistValidationResults",\n':
        '    lambda _match: new_validate + "\\n\\nasync function persistValidationResults",\n',
}

for old, new in replacements.items():
    if old in source:
        source = source.replace(old, new, 1)

namespace = {
    "__name__": "__main__",
    "__file__": str(source_path),
}
exec(compile(source, str(source_path), "exec"), namespace)

# Recovery hardening after the visual-quality patch:
# 1. The broad per-asset aspect-ratio replacement can also touch the manifest's
#    static geometry map, where no `asset` variable exists. Normalize that map
#    back to its literal card geometry so generation can finish after all
#    checkpoints instead of crashing during manifest assembly.
# 2. A failed run may already have persisted fully validated service wrappers.
#    Reuse any cached wrapper whose SVG has the expected current geometry,
#    rather than regenerating those successful batches on every retry.
target_path = Path("scripts/complete_liquid_glass_assets.mjs")
target = target_path.read_text()

bad_geometry = (
    '      card: { aspect_ratio: usesCardLayout(asset) ? "85.60:53.98" : "3:2", '
    'width: 856, height: 539.8 },'
)
good_geometry = (
    '      card: { aspect_ratio: "85.60:53.98", width: 856, height: 539.8 },'
)
if bad_geometry in target:
    target = target.replace(bad_geometry, good_geometry, 1)
elif good_geometry not in target:
    raise SystemExit("Liquid Glass manifest card geometry marker missing")

helper = '''function cachedAssetHasExpectedLayout(asset, cachedAsset) {
  if (!cachedAsset || typeof cachedAsset.svg_text !== "string") return false;
  const expectedViewBox = usesCardLayout(asset)
    ? 'viewBox="0 0 856 539.8"'
    : 'viewBox="0 0 672 448"';
  return cachedAsset.svg_text.includes(expectedViewBox);
}

'''
generate_marker = "async function generateAssets(catalogue) {"
if "function cachedAssetHasExpectedLayout(asset, cachedAsset)" not in target:
    if generate_marker not in target:
        raise SystemExit("Liquid Glass generateAssets marker missing")
    target = target.replace(generate_marker, helper + generate_marker, 1)

old_reuse = '''        cachedAsset &&
        usesCardLayout(asset) &&
        (!cachedAsset.source_sha256 ||'''
new_reuse = '''        cachedAsset &&
        cachedAssetHasExpectedLayout(asset, cachedAsset) &&
        (!cachedAsset.source_sha256 ||'''
if old_reuse in target:
    target = target.replace(old_reuse, new_reuse, 1)
elif "cachedAssetHasExpectedLayout(asset, cachedAsset) &&" not in target:
    raise SystemExit("Liquid Glass durable reuse marker missing")

target_path.write_text(target)
print("Liquid Glass post-batch recovery crash fixed; valid cached wrappers are reusable")
