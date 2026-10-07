from pathlib import Path

p = Path("scripts/complete_liquid_glass_assets.mjs")
t = p.read_text()
version = "reference-refraction-v3"

def one(old, new, label):
    global t
    if old in t:
        t = t.replace(old, new, 1)
        return
    if new not in t:
        raise SystemExit(f"{label} marker missing")

one(
    "const CARD_HEIGHT = 539.8;\n",
    'const CARD_HEIGHT = 539.8;\nconst LIQUID_GLASS_DESIGN_VERSION = "reference-refraction-v3";\n',
    "version",
)

one(
    '    `data-layout="${usesCardLayout(asset) ? "card" : "service"}"`,\n',
    '    `data-layout="${usesCardLayout(asset) ? "card" : "service"}"`,\n'
    '    `data-liquid-glass-style="${LIQUID_GLASS_DESIGN_VERSION}"`,\n',
    "style attribute",
)

one(
    ')}" preserveAspectRatio="xMidYMid meet" clip-path="url(#art-${id})"/>`',
    ')}" preserveAspectRatio="xMidYMid meet" clip-path="url(#art-${id})" filter="url(#glassify-${id})"/>`',
    "artwork filter",
)

card_old = '''<rect x="18" y="18" width="820" height="503.8" rx="58" fill="url(#glass-${id})" stroke="#ffffff" stroke-opacity="0.9" stroke-width="5"/>
  <rect x="28" y="28" width="800" height="483.8" rx="50" fill="#ffffff" fill-opacity="0.74"/>
  ${inner}
  <path d="M48 80C230 16 568 20 808 77C660 184 420 211 92 192C66 157 52 117 48 80Z" fill="url(#shine-${id})"/>
  <path d="M43 448C240 355 522 358 824 222V470C824 495 806 508 779 508H77C59 508 48 486 43 448Z" fill="#75b8d8" fill-opacity="0.09"/>
  <path d="M42 393C279 245 538 311 822 160" fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="8"/>
  <rect x="24" y="24" width="808" height="491.8" rx="54" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="3"/>'''
card_new = '''${inner}
  <rect x="20" y="20" width="816" height="499.8" rx="57" fill="url(#glass-${id})" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.58" stroke-width="3"/>
  <path d="M52 100C228 32 590 34 808 92C650 168 392 188 86 166" fill="none" stroke="#ffffff" stroke-opacity="0.30" stroke-width="12" stroke-linecap="round"/>'''
one(card_old, card_new, "card surface")

service_old = '''<rect x="12" y="12" width="648" height="424" rx="72" fill="url(#glass-${id})" stroke="#ffffff" stroke-opacity="0.92" stroke-width="4"/>
  <rect x="22" y="22" width="628" height="404" rx="64" fill="#ffffff" fill-opacity="0.50"/>
  ${inner}
  <path d="M34 68C178 16 438 18 638 66C514 151 326 164 70 150C52 126 40 96 34 68Z" fill="url(#shine-${id})"/>
  <path d="M30 374C176 300 410 308 646 184V392C646 414 628 424 606 424H64C46 424 34 407 30 374Z" fill="#75b8d8" fill-opacity="0.08"/>
  <path d="M31 334C196 229 420 270 642 148" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="6"/>
  <rect x="18" y="18" width="636" height="412" rx="68" fill="none" stroke="#ffffff" stroke-opacity="0.58" stroke-width="2.5"/>'''
one(service_old, '''${inner}''', "service surface")

one(
    '  <filter id="shadow-${id}" x="-20%" y="-25%" width="140%" height="160%"><feDropShadow',
    '''  <filter id="glassify-${id}" x="-18%" y="-20%" width="136%" height="148%">
    <feDropShadow dx="0" dy="${isCard ? 8 : 7}" stdDeviation="${isCard ? 7 : 6}" flood-color="#17364d" flood-opacity="0.22"/>
    <feGaussianBlur in="SourceAlpha" stdDeviation="1.7" result="alphaBlur"/>
    <feSpecularLighting in="alphaBlur" surfaceScale="2.2" specularConstant="0.48" specularExponent="22" lighting-color="#ffffff" result="spec"><fePointLight x="-70" y="-90" z="190"/></feSpecularLighting>
    <feComposite in="spec" in2="SourceAlpha" operator="in" result="specClip"/>
    <feBlend in="SourceGraphic" in2="specClip" mode="screen"/>
  </filter>
  <filter id="shadow-${id}" x="-20%" y="-25%" width="140%" height="160%"><feDropShadow''',
    "glass filter",
)

old_gate = '  return cachedAsset.svg_text.includes(expectedViewBox);'
new_gate = '''  const svg = cachedAsset.svg_text;
  return svg.includes(expectedViewBox) &&
    svg.includes(`data-liquid-glass-style="${LIQUID_GLASS_DESIGN_VERSION}"`) &&
    !svg.includes("M48 80C230 16 568 20 808 77C660 184 420 211 92 192") &&
    !svg.includes("M34 68C178 16 438 18 638 66C514 151 326 164 70 150");'''
one(old_gate, new_gate, "cache gate")

anchor = '''  if (!svg.includes("data-source-kind="))
    invalid.push(`${asset.id}:missing_provenance`);
'''
extra = '''  if (!svg.includes(`data-liquid-glass-style="${LIQUID_GLASS_DESIGN_VERSION}"`))
    invalid.push(`${asset.id}:stale_liquid_glass_style`);
  if (svg.includes("M48 80C230 16 568 20 808 77C660 184 420 211 92 192") ||
      svg.includes("M34 68C178 16 438 18 638 66C514 151 326 164 70 150"))
    invalid.push(`${asset.id}:legacy_generic_wrapper`);
'''
if "stale_liquid_glass_style" not in t:
    if t.count(anchor) != 2:
        raise SystemExit("validation anchors missing")
    t = t.replace(anchor, anchor + extra)

prod = '''          if (!svg.includes(expectedViewBox))
            throw new Error(`production_layout_invalid:${id}`);
'''
prod_extra = '''          if (!svg.includes(`data-liquid-glass-style="${LIQUID_GLASS_DESIGN_VERSION}"`))
            throw new Error(`production_style_invalid:${id}`);
'''
if "production_style_invalid" not in t:
    one(prod, prod + prod_extra, "production style")

p.write_text(t)
print(f"Applied {version}; cached official source bytes remain reusable")
