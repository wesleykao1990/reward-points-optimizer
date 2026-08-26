from pathlib import Path

path = Path("scripts/complete_liquid_glass_assets.mjs")
text = path.read_text()
old = '''  if (invalid.length > 0) {\n    writeJson(join(OUTPUT_ROOT, "validation-failures.json"), invalid);\n    throw new Error(`asset_validation_failed:${invalid.length}`);\n  }'''
new = '''  if (invalid.length > 0) {\n    writeJson(join(OUTPUT_ROOT, "validation-failures.json"), invalid);\n    console.error("LIQUID_GLASS_VALIDATION_FAILURES=" + JSON.stringify(invalid));\n    throw new Error(`asset_validation_failed:${invalid.length}`);\n  }'''
if old in text:
    text = text.replace(old, new, 1)
elif "LIQUID_GLASS_VALIDATION_FAILURES=" not in text:
    raise SystemExit("validation failure block not found")
path.write_text(text)
print("Liquid Glass validation diagnostics enabled")
