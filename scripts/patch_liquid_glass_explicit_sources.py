from pathlib import Path

path = Path("scripts/complete_liquid_glass_assets.mjs")
text = path.read_text()

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

old_page = '''function sourcePageFor(asset) {\n  return (\n    PAGE_OVERRIDES[asset.id] ??\n    asset.source_page_url ??'''
new_page = '''function sourcePageFor(asset) {\n  return (\n    EXPLICIT_SOURCE_PAGE_OVERRIDES[asset.id] ??\n    PAGE_OVERRIDES[asset.id] ??\n    asset.source_page_url ??'''
if old_page in text:
    text = text.replace(old_page, new_page, 1)
elif "EXPLICIT_SOURCE_PAGE_OVERRIDES[asset.id]" not in text:
    raise SystemExit("sourcePageFor marker missing")

old_remote = "return acquireRemote(resolved, pageUrl, resolved.source_image_url);"
new_remote = "return acquireRemote(\n          resolved,\n          pageUrl,\n          EXPLICIT_IMAGE_OVERRIDES[resolved.id] ?? resolved.source_image_url,\n        );"
if old_remote in text:
    text = text.replace(old_remote, new_remote, 1)
elif "EXPLICIT_IMAGE_OVERRIDES[resolved.id]" not in text:
    raise SystemExit("acquireRemote call marker missing")

path.write_text(text)
print("Pinned direct first-party artwork for the remaining Liquid Glass acquisition gaps")
