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
