from pathlib import Path

path = Path("scripts/complete_liquid_glass_assets.mjs")
text = path.read_text()

# Keep exact first-party URLs for provenance and as a fallback, but prefer the
# official bytes/screenshots already vendored into the repository whenever they
# are available. This avoids CDN/hotlink flakiness during generation.
explicit_block = r'''
const EXPLICIT_IMAGE_OVERRIDES = Object.freeze({
  "instrument.card.majica-ucs": "https://www.ucscard.co.jp/assets/images/lineup/ucscard/mv_pc.png",
  "instrument.card.ana-super-flyers-gold-card": "https://www.ana.co.jp/amc/anacard/googlepay/popup01/images/gold_05.gif",
  "instrument.card.ana-card-general": "https://www.ana.co.jp/amc/anacard/googlepay/popup01/images/general_10.gif",
  "instrument.card.ana-wide-gold-card": "https://www.ana.co.jp/amc/anacard/googlepay/popup01/images/gold_03.gif",
  "program.jp.crie-card-discount": "https://c-united.co.jp/crie-maison/crie/card/img/card/mv.jpg",
  "program.jp.bicpoint": "https://www.biccamera.co.jp/shopguide/campaign/camp-caution/img/pointcard/bic_pointcard.png",
  "program.jp.muji-good": "https://www.muji.com/jp/ja/service/goodprogram/assets/img/logo-mujigoodprogram.svg",
  "program.jp.nitori": "https://www.nitori-net.jp/ecstatic/include/characteristic/loyalty-program/img01.png",
  "instrument.card.rakuten-bank-card-credit-function": "https://www.rakuten-bank.co.jp/card/rc/images/update-img-01.png",
  "instrument.crie.card": "https://c-united.co.jp/crie-maison/crie/card/img/card/mv.jpg",
  "program.jp.takashimaya-point": "https://www.takashimaya.co.jp/base/pc/store/special/card_list/img/img_takashimaya_point.png",
  "program.jp.mi-point": "https://www.mistore.jp/on/demandware.static/-/Sites-seamless-Library/ja_JP/dw9d1221a6/content/campaign/mip_cp/images/main.jpg",
  "wallet.anapay": "https://www.ana.co.jp/amc/ana-pay/img/image_top/mv/tittle_231107.png",
  "mile.ana": "https://www.ana.co.jp/amc/ana-pay/img/image_top/logo/logo_ana.png",
});

const EXPLICIT_SOURCE_PAGE_OVERRIDES = Object.freeze({
  "instrument.card.majica-ucs": "https://www.ucscard.co.jp/lineup/ucscard/",
  "instrument.card.rakuten-bank-card-credit-function": "https://www.rakuten-bank.co.jp/card/rc/update.html",
  "program.jp.bicpoint": "https://www.biccamera.com/bc/c/info/point/no_check.jsp",
  "program.jp.muji-good": "https://www.muji.com/jp/ja/service/goodprogram/",
  "program.jp.nitori": "https://www.nitori-net.jp/ec/characteristic/loyalty-program/",
  "program.jp.mi-point": "https://www.mistore.jp/shopping/campaign/mip_cp.html",
  "program.jp.takashimaya-point": "https://www.takashimaya.co.jp/store/special/card_list/",
  "program.jp.crie-card-discount": "https://c-united.co.jp/crie/card/",
  "instrument.crie.card": "https://c-united.co.jp/crie/card/",
});

'''

marker = "const LOCAL_OFFICIAL_ART = Object.freeze({"
if "const EXPLICIT_IMAGE_OVERRIDES" not in text:
    if marker not in text:
        raise SystemExit("LOCAL_OFFICIAL_ART marker missing")
    text = text.replace(marker, explicit_block + marker, 1)

if '"program.jp.bicpoint": "https://www.biccamera.com/bc/c/info/point/no_check.jsp"' not in text:
    text = text.replace(
        'const EXPLICIT_SOURCE_PAGE_OVERRIDES = Object.freeze({\n',
        'const EXPLICIT_SOURCE_PAGE_OVERRIDES = Object.freeze({\n'
        '  "program.jp.bicpoint": "https://www.biccamera.com/bc/c/info/point/no_check.jsp",\n'
        '  "program.jp.muji-good": "https://www.muji.com/jp/ja/service/goodprogram/",\n',
        1,
    )

old_page = '''function sourcePageFor(asset) {\n  return (\n    PAGE_OVERRIDES[asset.id] ??\n    asset.source_page_url ??'''
new_page = '''function sourcePageFor(asset) {\n  return (\n    EXPLICIT_SOURCE_PAGE_OVERRIDES[asset.id] ??\n    PAGE_OVERRIDES[asset.id] ??\n    asset.source_page_url ??'''
if old_page in text:
    text = text.replace(old_page, new_page, 1)
elif "EXPLICIT_SOURCE_PAGE_OVERRIDES[asset.id]" not in text:
    raise SystemExit("sourcePageFor marker missing")

local_entries = {
    "instrument.card.majica-ucs": "reference-official/majica-ucs.png",
    "instrument.card.ana-card-general": "reference-official/ana-card-general.jpg",
    "instrument.card.ana-super-flyers-gold-card": "reference-official/ana-super-flyers-gold-card.jpg",
    "instrument.card.ana-wide-gold-card": "reference-official/ana-wide-gold-card.jpg",
    "program.jp.bicpoint": "reference-official/bic-point.png",
    "program.jp.muji-good": "reference-official/muji-good-program.png",
    "program.jp.nitori": "reference-official/nitori-members.jpg",
    "instrument.card.rakuten-bank-card-credit-function": "reference-official/rakuten-bank-card.png",
    "program.jp.takashimaya-point": "reference-official/takashimaya-point.png",
    "program.jp.mi-point": "reference-official/mi-point.jpg",
    "wallet.anapay": "reference-official/ana-pay.png",
    "mile.ana": "reference-official/ana-mileage.png",
    "instrument.card.aeon": "reference-official/aeon-card-face.png",
    "instrument.card.d": "reference-official/d-card-face.jpg",
    "instrument.card.mitsui-sumitomo-card-nl": "reference-official/smbc-nl-card-face.png",
    "instrument.card.paypay-card": "reference-official/paypay-card-face.png",
    "instrument.card.rakuten-ana-mileage-club-card": "reference-official/rakuten-amc-card-face.png",
    "instrument.card.rakuten-card": "reference-official/rakuten-card-face.png",
    "instrument.card.rakuten-gold-card": "reference-official/rakuten-gold-card-face.png",
    "instrument.card.rakuten-pink-card": "reference-official/rakuten-pink-card-face.png",
    "instrument.card.rakuten-premium-card": "reference-official/rakuten-premium-card-face.png",
    "instrument.card.view-card-standard": "reference-official/view-card-standard-face.jpg",
}
for asset_id, filename in local_entries.items():
    entry = f'  "{asset_id}": "{filename}",\n'
    if entry not in text:
        if marker not in text:
            raise SystemExit("LOCAL_OFFICIAL_ART marker missing")
        text = text.replace(marker, marker + "\n" + entry.rstrip("\n"), 1)

old_remote = "return acquireRemote(resolved, pageUrl, resolved.source_image_url);"
new_remote = "return acquireRemote(\n          resolved,\n          pageUrl,\n          EXPLICIT_IMAGE_OVERRIDES[resolved.id] ?? resolved.source_image_url,\n        );"
if old_remote in text:
    text = text.replace(old_remote, new_remote, 1)
elif "EXPLICIT_IMAGE_OVERRIDES[resolved.id]" not in text:
    raise SystemExit("acquireRemote call marker missing")

old_headers = '''      headers: {\n        "user-agent": USER_AGENT,\n        accept: options.accept ?? "*/*",\n      },'''
new_headers = '''      headers: {\n        "user-agent": USER_AGENT,\n        accept: options.accept ?? "*/*",\n        ...(options.referer ? { referer: options.referer } : {}),\n      },'''
if old_headers in text:
    text = text.replace(old_headers, new_headers, 1)
elif "...(options.referer ? { referer: options.referer } : {})" not in text:
    raise SystemExit("fetchBytes headers marker missing")

old_evaluate_fetch = '''      timeout: 22_000,\n    });'''
new_evaluate_fetch = '''      timeout: 22_000,\n      referer: candidate.referer,\n    });'''
if old_evaluate_fetch in text:
    text = text.replace(old_evaluate_fetch, new_evaluate_fetch, 1)
elif "referer: candidate.referer" not in text:
    raise SystemExit("evaluateCandidate fetch marker missing")

old_explicit_candidate = '''      descriptor: "official-explicit-image",\n      alt: asset.display_name,\n    });'''
new_explicit_candidate = '''      descriptor: "official-explicit-image",\n      alt: asset.display_name,\n      referer: pageUrl,\n    });'''
if old_explicit_candidate in text:
    text = text.replace(old_explicit_candidate, new_explicit_candidate, 1)
elif "referer: pageUrl" not in text:
    raise SystemExit("explicit candidate marker missing")

path.write_text(text)
print("Using vendored official artwork for all previously blocked sources")
