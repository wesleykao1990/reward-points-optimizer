from pathlib import Path

path = Path("scripts/complete_liquid_glass_assets.mjs")
text = path.read_text()

scope_patch = r'''
const LIQUID_GLASS_SCOPE_EXCLUDED_IDS = new Set([
  "program.jp.amazonpoint",
  "program.jp.zozopoint",
  "instrument.payment.bank-transfer",
  "instrument.payment.bitcoin",
  "instrument.payment.carrier-billing",
  "instrument.payment.cash-on-delivery",
  "instrument.payment.convenience-store",
  "instrument.payment.credit-card",
  "instrument.payment.debit-card",
  "instrument.payment.netbank-atm",
  "instrument.payment.paidy",
  "instrument.payment.pay-easy",
  "instrument.payment.paypal",
  "instrument.payment.postal-transfer",
  "instrument.payment.postpay",
  "instrument.payment.shopping-loan",
  "instrument.payment.zozocard",
  "instrument.value.amazon-gift-card",
  "instrument.value.biccamera-gift-card",
  "instrument.value.yahoo-shopping-voucher",
]);

function liquidGlassCanonicalScope(assets) {
  const selected = assets.filter(
    (asset) => !LIQUID_GLASS_SCOPE_EXCLUDED_IDS.has(asset.asset_id),
  );
  if (selected.length !== EXPECTED_CANONICAL)
    throw new Error(
      `liquid_glass_scope_invalid:${selected.length}:catalogue=${assets.length}`,
    );
  return selected;
}

'''

marker = "async function waitForCatalogue() {"
if "LIQUID_GLASS_SCOPE_EXCLUDED_IDS" not in text:
    if marker not in text:
        raise SystemExit("waitForCatalogue marker missing")
    text = text.replace(marker, scope_patch + marker, 1)

old_count = "body.assets.length === EXPECTED_CANONICAL"
new_count = "liquidGlassCanonicalScope(body.assets).length === EXPECTED_CANONICAL"
if old_count in text:
    text = text.replace(old_count, new_count, 1)
elif new_count not in text:
    raise SystemExit("catalogue count condition missing")

old_map = "const canonical = catalogue.assets.map((asset) => ({"
new_map = "const canonical = liquidGlassCanonicalScope(catalogue.assets).map((asset) => ({"
if old_map in text:
    text = text.replace(old_map, new_map, 1)
elif new_map not in text:
    raise SystemExit("canonical map marker missing")

# Keep the MIME normalization repair used by prior completion attempts.
old_mime = 'const mime = sniffMime(bytes, `image/${extname(filename).slice(1)}`);'
new_mime = 'const extension = extname(filename).toLocaleLowerCase("en-US");\n  const declaredMime = extension === ".svg" ? "image/svg+xml" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".ico" ? "image/x-icon" : `image/${extension.slice(1)}`;\n  const mime = sniffMime(bytes, declaredMime);'
if old_mime in text:
    text = text.replace(old_mime, new_mime, 1)

# The generator must not rewrite the workflow file that triggered it.
text = text.replace('".github/workflows/liquid-glass-assets-completion.yml", ', '')

path.write_text(text)
print("Liquid Glass generator patched for frozen 211 canonical + 35 alias scope")
