from pathlib import Path
import json
import re

root = Path('.')

# Load the DB-backed catalogue synchronizer and its final visual overrides.
index_path = root / 'apps/consumer-alpha/public/index.html'
index = index_path.read_text()
css_marker = '    <link rel="stylesheet" href="/styles.css">'
css_link = '    <link rel="stylesheet" href="/catalogue-sync.css">'
if css_link not in index:
    if css_marker not in index:
        raise SystemExit('index stylesheet marker missing')
    index = index.replace(css_marker, css_marker + '\n' + css_link, 1)
script_marker = '    <script src="/coverage.js" defer></script>'
sync_script = '    <script src="/catalogue-sync.js" defer></script>'
if sync_script not in index:
    if script_marker not in index:
        raise SystemExit('coverage script marker missing')
    index = index.replace(script_marker, script_marker + '\n' + sync_script, 1)
index_path.write_text(index)

# Expose the canonical DB-backed catalogue endpoint before the catch-all handler.
vercel_path = root / 'vercel.json'
vercel = json.loads(vercel_path.read_text())
rewrites = vercel.setdefault('rewrites', [])
entry = {'source': '/catalogue-ui', 'destination': '/api/catalogue-ui'}
if entry not in rewrites:
    catchall = next((i for i, row in enumerate(rewrites) if row.get('source') == '/api/:path*'), len(rewrites))
    rewrites.insert(catchall, entry)
functions = vercel.setdefault('functions', {})
functions['api/catalogue-ui.mjs'] = {'maxDuration': 15}
vercel_path.write_text(json.dumps(vercel, ensure_ascii=False, indent=2) + '\n')

# The catalogue now includes the two current Hilton Honors Amex products.
generator_path = root / 'scripts/complete_liquid_glass_assets.mjs'
generator = generator_path.read_text()
generator = generator.replace('const EXPECTED_CANONICAL = 211;', 'const EXPECTED_CANONICAL = 213;', 1)
alias_replacements = {
    '["point.moppy", "ポイント (moppy)", null]': '["point.moppy", "モッピーポイント", null]',
    '["point.saison", "ポイント (saison)", null]': '["point.saison", "永久不滅ポイント", null]',
    '["point.recruit", "Recruit Point", null]': '["point.recruit", "リクルートポイント", null]',
    '["emoney.nanaco", "nanaco電子マネー", "instrument.jp.nanaco"]': '["emoney.nanaco", "nanaco", "instrument.jp.nanaco"]',
    '["emoney.waon", "WAON電子マネー", "instrument.emoney.waon"]': '["emoney.waon", "WAON", "instrument.emoney.waon"]',
}
for old, new in alias_replacements.items():
    generator = generator.replace(old, new)
if 'const EXPECTED_CANONICAL = 213;' not in generator:
    raise SystemExit('generator expected-canonical marker missing')
generator_path.write_text(generator)

# Always render the generated Liquid Glass SVG in the UI. The previous service
# path deliberately bypassed the glass SVG for raw logo source bytes, which is
# why 使う displayed plain logos while cards used generated assets.
coverage_path = root / 'apps/consumer-alpha/public/coverage.js'
coverage = coverage_path.read_text()
source_pattern = re.compile(
    r'  const sourceFor = \(asset, cardLayout\) => \{.*?\n  \};\n\n  const hydrateFrame =',
    re.S,
)
replacement = '''  const sourceFor = (asset) => asset.path;\n\n  const hydrateFrame ='''
coverage, count = source_pattern.subn(replacement, coverage, count=1)
if count != 1 and 'const sourceFor = (asset) => asset.path;' not in coverage:
    raise SystemExit('coverage sourceFor block missing')
coverage = coverage.replace(
    '    const markSpec = brandMarkOverrides[id] || brandMarkOverrides[asset.id];',
    '    const markSpec = null;',
    1,
)
coverage_path.write_text(coverage)

# Stop leaking canonical ASCII IDs into labels anywhere the recommendation
# engine itself emits a family label. Browser lists are DB-backed via
# /catalogue-ui; these are the synchronous engine-side equivalents.
point_path = root / 'apps/consumer-alpha/src/point-spend-recommendation.ts'
point = point_path.read_text()
map_marker = 'function dynamicFamilyDefinition(\n'
if 'DYNAMIC_FAMILY_DISPLAY_OVERRIDES' not in point:
    override = '''const DYNAMIC_FAMILY_DISPLAY_OVERRIDES: Readonly<\n  Record<string, { readonly label: string; readonly kind: P0WalletCatalogueKind }>\n> = Object.freeze({\n  "wallet.anapay": { label: "ANA Pay", kind: "mobile_pay" },\n  "wallet.kyash": { label: "Kyash", kind: "mobile_pay" },\n  "wallet.revolut": { label: "Revolut", kind: "mobile_pay" },\n  "wallet.revolut-jp": { label: "Revolut", kind: "mobile_pay" },\n  "point.ana-mile": { label: "ANAマイル", kind: "point" },\n  "point.jal-mile": { label: "JALマイル", kind: "point" },\n  "point.recruit": { label: "リクルートポイント", kind: "point" },\n  "point.moppy": { label: "モッピーポイント", kind: "point" },\n  "point.saison": { label: "永久不滅ポイント", kind: "point" },\n  "point.saison-permanent": { label: "永久不滅ポイント", kind: "point" },\n  "emoney.nanaco": { label: "nanaco", kind: "emoney" },\n  "emoney.waon": { label: "WAON", kind: "emoney" },\n  "storedvalue.nanaco": { label: "nanaco", kind: "stored_value" },\n  "storedvalue.waon": { label: "WAON", kind: "stored_value" },\n});\n\n'''
    if map_marker not in point:
        raise SystemExit('dynamicFamilyDefinition marker missing')
    point = point.replace(map_marker, override + map_marker, 1)
needle = '''function dynamicFamilyDefinition(\n  familyId: string,\n): { readonly label: string; readonly kind: P0WalletCatalogueKind } | null {\n  if (!isCanonicalProductFamilyId(familyId)) return null;'''
replacement = '''function dynamicFamilyDefinition(\n  familyId: string,\n): { readonly label: string; readonly kind: P0WalletCatalogueKind } | null {\n  if (!isCanonicalProductFamilyId(familyId)) return null;\n  const override = DYNAMIC_FAMILY_DISPLAY_OVERRIDES[familyId];\n  if (override) return override;'''
if needle in point:
    point = point.replace(needle, replacement, 1)
elif 'const override = DYNAMIC_FAMILY_DISPLAY_OVERRIDES[familyId];' not in point:
    raise SystemExit('dynamic family body marker missing')
point_path.write_text(point)

# Touch the authoritative completion workflow so this repair commit immediately
# launches the resumable 213+40 asset generation/deployment run.
completion_path = root / '.github/workflows/liquid-glass-assets-completion.yml'
completion = completion_path.read_text()
trigger = '# payment-catalogue-repair-trigger-v1'
if trigger not in completion:
    completion = completion.rstrip() + '\n\n' + trigger + '\n'
completion_path.write_text(completion)

print('Payment catalogue, labels, and Liquid Glass source path repaired')
