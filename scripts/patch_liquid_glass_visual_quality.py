from pathlib import Path
import re

path = Path("scripts/complete_liquid_glass_assets.mjs")
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"{label} marker missing")
    text = text.replace(old, new, 1)


def insert_object_entries(marker: str, entries: dict[str, str], label: str) -> None:
    global text
    start = text.find(marker)
    if start < 0:
        raise SystemExit(f"{label} marker missing")
    end = text.find("\n});", start)
    if end < 0:
        raise SystemExit(f"{label} closing marker missing")
    block = text[start:end]
    additions = []
    for key, value in entries.items():
        if f'"{key}"' not in block:
            additions.append(f'  "{key}": "{value}",')
    if additions:
        text = text[: start + len(marker)] + "\n" + "\n".join(additions) + text[start + len(marker) :]


# Five product families are live in the database-backed wallet picker but were
# absent from the frozen 35-alias visual manifest. Keep the canonical catalogue
# count unchanged and make the visual alias layer cover every currently
# selectable P0 wallet family.
replace_once(
    "const EXPECTED_ALIASES = 35;",
    "const EXPECTED_ALIASES = 40;",
    "expected alias count",
)

aliases_start = text.find("const ALIASES = Object.freeze([")
aliases_end = text.find("].map(([id, displayName, aliasOf])", aliases_start)
if aliases_start < 0 or aliases_end < 0:
    raise SystemExit("ALIASES block missing")
alias_block = text[aliases_start:aliases_end]
missing_aliases = []
for line, key in [
    ('  ["point.ana-mile", "ANAマイル", null],', "point.ana-mile"),
    ('  ["point.jal-mile", "JALマイル", null],', "point.jal-mile"),
    ('  ["point.recruit", "Recruit Point", null],', "point.recruit"),
    ('  ["emoney.nanaco", "nanaco電子マネー", "instrument.jp.nanaco"],', "emoney.nanaco"),
    ('  ["emoney.waon", "WAON電子マネー", "instrument.emoney.waon"],', "emoney.waon"),
]:
    if f'"{key}"' not in alias_block:
        missing_aliases.append(line)
if missing_aliases:
    insertion = "\n".join(missing_aliases) + "\n"
    text = text[:aliases_end] + insertion + text[aliases_end:]

insert_object_entries(
    "const LOCAL_OFFICIAL_ART = Object.freeze({",
    {
        "point.ana-mile": "reference-official/ana-mileage.png",
    },
    "LOCAL_OFFICIAL_ART",
)
insert_object_entries(
    "const PAGE_OVERRIDES = Object.freeze({",
    {
        "point.ana-mile": "https://www.ana.co.jp/ja/jp/amc/",
        "point.jal-mile": "https://www.jal.co.jp/ja-jp/mileage.html",
        "point.recruit": "https://point.recruit.co.jp/",
    },
    "PAGE_OVERRIDES",
)
insert_object_entries(
    "const EXPLICIT_IMAGE_OVERRIDES = Object.freeze({",
    {
        "point.jal-mile": "https://www.jal.co.jp/ja-jp/mileage/_jcr_content/root/contents/responsivegrid/responsivegrid_10289_967948825/column_676520245/col-1-2-2/column/col-1-2-1/img_copy.coreimg.png/1780482085551.png",
        "point.recruit": "https://img.point.recruit.co.jp/recruitid/assets/dynamic/img/logo/point/rpt01_a.svg",
    },
    "EXPLICIT_IMAGE_OVERRIDES",
)

# Physical cards keep ISO/IEC ID-1 proportions. Brand/program/payment assets
# use a more compact 3:2 glass badge so a logo is not shrunk into a tiny strip
# inside a credit-card-sized canvas.
replace_once(
    '''function isCreditCard(asset) {\n  return asset.entity_type === "credit_card";\n}\n''',
    '''function isCreditCard(asset) {\n  return asset.entity_type === "credit_card";\n}\n\nfunction usesCardLayout(asset) {\n  return isCreditCard(asset) || String(asset.id).startsWith("card.");\n}\n''',
    "card layout helper",
)

new_css = r'''function liquidGlassCss() {
  return `.payment-logo {
  width: 64px !important;
  height: auto !important;
  aspect-ratio: 3 / 2;
  flex: 0 0 64px !important;
  padding: 0 !important;
  overflow: visible;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.payment-logo.is-liquid-card {
  width: 70px !important;
  aspect-ratio: 85.6 / 53.98;
  flex-basis: 70px !important;
}

.payment-logo img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.route-node-logo {
  width: 54px !important;
  flex-basis: 54px !important;
}

.route-node-logo.is-liquid-card {
  width: 58px !important;
  flex-basis: 58px !important;
}

@media (max-width: 370px) {
  .payment-logo {
    width: 58px !important;
    flex-basis: 58px !important;
  }
  .payment-logo.is-liquid-card {
    width: 64px !important;
    flex-basis: 64px !important;
  }
}
`;
}
'''
text, count = re.subn(
    r"function liquidGlassCss\(\) \{.*?\n\}\n\nfunction coverageRuntime\(\) \{",
    new_css + "\nfunction coverageRuntime() {",
    text,
    count=1,
    flags=re.S,
)
if count != 1 and "width: 64px !important;" not in text:
    raise SystemExit("liquidGlassCss replacement failed")

new_coverage = r'''function coverageRuntime() {
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .replace(/[\s・･/／()（）._-]+/gu, "")
      .toLocaleLowerCase("ja-JP");

  const safeCoverage = (body) => {
    if (
      !body ||
      body.version !== "credit-card-coverage.v1" ||
      !body.catalogue ||
      !body.optimization ||
      !integer(body.catalogue.total) ||
      !integer(body.optimization.covered) ||
      !integer(body.optimization.total) ||
      body.catalogue.total !== body.optimization.total ||
      !Array.isArray(body.catalogue.tiers) ||
      !Array.isArray(body.optimization.tiers)
    )
      throw new Error("coverage_invalid");
    const catalogueByTier = new Map();
    body.catalogue.tiers.forEach((row) => {
      if (!row || !/^P[0-2]$/u.test(row.tier) || !integer(row.count))
        throw new Error("coverage_invalid");
      catalogueByTier.set(row.tier, row.count);
    });
    const optimizationByTier = new Map();
    body.optimization.tiers.forEach((row) => {
      if (
        !row ||
        !/^P[0-2]$/u.test(row.tier) ||
        !integer(row.covered) ||
        !integer(row.total) ||
        row.covered > row.total ||
        catalogueByTier.get(row.tier) !== row.total
      )
        throw new Error("coverage_invalid");
      optimizationByTier.set(row.tier, row.covered);
    });
    return {
      catalogueTotal: body.catalogue.total,
      optimizationCovered: body.optimization.covered,
      optimizationTotal: body.optimization.total,
      catalogueByTier,
      optimizationByTier,
    };
  };

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  const renderTiers = (coverage) => {
    const container = document.getElementById("card-coverage-tiers");
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    ["P0", "P1", "P2"].forEach((tier) => {
      const total = coverage.catalogueByTier.get(tier) ?? 0;
      const covered = coverage.optimizationByTier.get(tier) ?? 0;
      const chip = document.createElement("span");
      chip.className = "demo-chip";
      chip.textContent = `${tier} 最適化 ${covered}/${total}`;
      container.appendChild(chip);
    });
  };

  const oldSourceIds = Object.freeze({
    "dpoint.png": "point.d",
    "dbarai.png": "wallet.dbarai",
    "dcard.png": "card.d",
    "jrepoint.webp": "point.jre",
    "viewcard.gif": "card.view",
    "nanaco.png": "point.nanaco",
    "paypay.svg": "wallet.paypay",
    "paypaycard.png": "card.paypay",
    "ponta.png": "point.ponta",
    "rakutenpoint.svg": "point.rakuten",
    "rakutenpay.svg": "wallet.rakutenpay",
    "rakutencard.svg": "card.rakuten",
    "vpoint.svg": "point.v",
    "waon.png": "point.waon",
    "aeonpay.png": "wallet.aeonpay",
    "aeoncard.png": "card.aeon",
    "aupay.png": "wallet.aupay",
    "aupaycard.png": "card.aupay",
    "famipay.svg": "wallet.famipay",
    "smbccard.png": "card.smbc",
  });

  const labelIds = Object.freeze({
    dポイント: "point.d",
    "d Point": "point.d",
    "d POINT": "point.d",
    "JRE POINT": "point.jre",
    nanacoポイント: "point.nanaco",
    "nanaco Points": "point.nanaco",
    PayPayポイント: "point.paypay",
    "PayPay Points": "point.paypay",
    Pontaポイント: "point.ponta",
    Ponta: "point.ponta",
    Vポイント: "point.v",
    "V Point": "point.v",
    "WAON POINT": "point.waon",
    楽天ポイント: "point.rakuten",
    "Rakuten Point": "point.rakuten",
    楽天ペイ: "wallet.rakutenpay",
    "Rakuten Pay": "wallet.rakutenpay",
    PayPay: "wallet.paypay",
    "AEON Pay": "wallet.aeonpay",
    "au PAY": "wallet.aupay",
    d払い: "wallet.dbarai",
    FamiPay: "wallet.famipay",
    "ポイント(moppy)": "point.moppy",
    Moppy: "point.moppy",
    "ポイント(saison)": "point.saison",
    永久不滅ポイント: "point.saison-permanent",
    "電子マネー(nanaco)": "emoney.nanaco",
    "電子マネー(waon)": "emoney.waon",
    Suica: "storedvalue.suica",
    ANAマイル: "point.ana-mile",
    JALマイル: "point.jal-mile",
  });

  let byId = new Map();
  let byName = new Map();
  let ready = false;

  const inferId = (frame) => {
    if (frame.dataset.liquidAssetId) return frame.dataset.liquidAssetId;
    const option = frame.closest(".p0-product-option");
    const optionInput = option?.querySelector(
      "input[data-p0-product], input[data-payment-stack-owned]",
    );
    if (optionInput?.value) return optionInput.value;
    const walletChip = frame.closest("[data-wallet-chip]");
    if (walletChip?.dataset.walletChip) return walletChip.dataset.walletChip;
    const image = frame.querySelector("img");
    if (image?.src) {
      const filename = new URL(image.src, window.location.href).pathname
        .split("/")
        .pop();
      if (filename && oldSourceIds[filename]) return oldSourceIds[filename];
    }
    const row = frame.closest(
      ".p0-product-option, .lot-card, .route-chain-node, [data-wallet-chip]",
    );
    const label = row
      ?.querySelector(
        ".p0-product-name strong, .lot-identity strong, strong, span",
      )
      ?.textContent?.trim();
    if (labelIds[label]) return labelIds[label];
    return byName.get(normalize(label))?.id ?? "";
  };

  const hydrateFrame = (frame) => {
    if (!(frame instanceof HTMLElement) || !ready) return;
    const id = inferId(frame);
    const asset = byId.get(id);
    if (!asset || frame.dataset.liquidGlassPath === asset.path) return;
    const original = [...frame.childNodes].map((node) => node.cloneNode(true));
    const image = document.createElement("img");
    image.src = asset.path;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    const cardLayout =
      asset.entity_type === "credit_card" || String(asset.id).startsWith("card.");
    frame.classList.toggle("is-liquid-card", cardLayout);
    image.addEventListener(
      "error",
      () => {
        if (frame.dataset.liquidGlassPath !== asset.path) return;
        frame.replaceChildren(...original.map((node) => node.cloneNode(true)));
        frame.classList.remove("is-liquid-card");
        frame.dataset.liquidGlassFailed = asset.path;
        delete frame.dataset.liquidGlassPath;
        delete frame.dataset.liquidAssetId;
      },
      { once: true },
    );
    frame.replaceChildren(image);
    frame.dataset.liquidAssetId = id;
    frame.dataset.liquidGlassPath = asset.path;
  };

  const hydrateAll = (root = document) => {
    root.querySelectorAll?.(".payment-logo").forEach(hydrateFrame);
  };

  const observe = () => {
    const observer = new MutationObserver((records) => {
      records.forEach((record) =>
        record.addedNodes.forEach((added) => {
          if (!(added instanceof Element)) return;
          if (added.matches(".payment-logo")) hydrateFrame(added);
          hydrateAll(added);
        }),
      );
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  const installStylesheet = () => {
    if (document.querySelector('link[href="/liquid-glass.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/liquid-glass.css";
    document.head.appendChild(link);
  };

  const loadAssets = async () => {
    const response = await fetch("/assets/liquid-glass/manifest.json", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("asset_manifest_unavailable");
    const manifest = await response.json();
    if (
      manifest.version !== "liquid-glass-assets.v2" ||
      !Number.isSafeInteger(manifest.asset_count) ||
      manifest.asset_count < 251 ||
      !Array.isArray(manifest.assets) ||
      manifest.assets.length !== manifest.asset_count
    )
      throw new Error("asset_manifest_invalid");
    const manifestById = new Map(
      manifest.assets.map((asset) => [asset.id, asset]),
    );
    byId = new Map(manifestById);
    manifest.assets.forEach((asset) => {
      if (!String(asset.id).startsWith("card.")) return;
      if (!String(asset.resolved_id).startsWith("instrument.card.")) return;
      const canonical = manifestById.get(asset.resolved_id);
      if (canonical) byId.set(asset.id, canonical);
    });
    byName = new Map();
    manifest.assets.forEach((asset) => {
      byName.set(normalize(asset.display_name), asset);
      (asset.labels ?? []).forEach((label) =>
        byName.set(normalize(label), asset),
      );
    });
    ready = true;
    installStylesheet();
    hydrateAll();
  };

  const loadCoverage = async () => {
    try {
      const response = await fetch("/catalogue-coverage", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("coverage_unavailable");
      const coverage = safeCoverage(await response.json());
      setText("card-catalogue-coverage", `${coverage.catalogueTotal}枚`);
      setText(
        "card-optimization-coverage",
        `${coverage.optimizationCovered}/${coverage.optimizationTotal}枚`,
      );
      setText(
        "card-coverage-note",
        "カタログ収録はカードの存在・名称の収録状況、最適化対応は公式根拠がAgent Feedから反映され、還元計算に使える状態を示します。",
      );
      renderTiers(coverage);
    } catch {
      setText("card-catalogue-coverage", "—");
      setText("card-optimization-coverage", "—");
      setText("card-coverage-note", "カード収録状況を読み込めませんでした。");
    }
  };

  observe();
  void loadAssets().catch(() => {});
  void loadCoverage();
}
'''
text, count = re.subn(
    r"function coverageRuntime\(\) \{.*?\n\}\n\nfunction coverageSource\(\) \{",
    new_coverage + "\nfunction coverageSource() {",
    text,
    count=1,
    flags=re.S,
)
if count != 1 and "manifest.asset_count < 251" not in text:
    raise SystemExit("coverageRuntime replacement failed")

new_svg = r'''function liquidGlassSvg(asset, source, sourceFile) {
  const id = safeSlug(asset.id);
  const title = escapeXml(asset.display_name);
  const sourceAttributes = [
    `data-asset-id="${escapeXml(asset.id)}"`,
    `data-source-kind="${escapeXml(source.sourceKind)}"`,
    `data-layout="${usesCardLayout(asset) ? "card" : "service"}"`,
    source.pageUrl ? `data-source-page="${escapeXml(source.pageUrl)}"` : "",
    source.imageUrl ? `data-source-image="${escapeXml(source.imageUrl)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const isCard = usesCardLayout(asset);
  const width = isCard ? 856 : 672;
  const height = isCard ? 539.8 : 448;
  const art = isCard
    ? { x: 34, y: 34, width: 788, height: 471.8, rx: 46 }
    : { x: 48, y: 52, width: 576, height: 344, rx: 52 };
  const artworkHref = source.bytes && source.bytes.length <= 1500000
    ? `data:${source.mime};base64,${source.bytes.toString("base64")}`
    : sourceFile?.publicPath;
  const inner = artworkHref
    ? `<image x="${art.x}" y="${art.y}" width="${art.width}" height="${art.height}" href="${escapeXml(
        artworkHref,
      )}" preserveAspectRatio="xMidYMid meet" clip-path="url(#art-${id})"/>`
    : `<g aria-hidden="true"><rect x="${isCard ? 118 : 82}" y="${
        isCard ? 155 : 126
      }" width="${isCard ? 620 : 508}" height="${isCard ? 230 : 196}" rx="${
        isCard ? 78 : 64
      }" fill="#ffffff" fill-opacity="0.62"/><text x="${
        isCard ? 428 : 336
      }" y="${isCard ? 302 : 254}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${
        isCard ? 92 : 78
      }" font-weight="800" fill="#203244">${escapeXml(genericSymbol(asset))}</text></g>`;
  const outer = isCard
    ? `<rect x="18" y="18" width="820" height="503.8" rx="58" fill="url(#glass-${id})" stroke="#ffffff" stroke-opacity="0.9" stroke-width="5"/>
  <rect x="28" y="28" width="800" height="483.8" rx="50" fill="#ffffff" fill-opacity="0.74"/>
  ${inner}
  <path d="M48 80C230 16 568 20 808 77C660 184 420 211 92 192C66 157 52 117 48 80Z" fill="url(#shine-${id})"/>
  <path d="M43 448C240 355 522 358 824 222V470C824 495 806 508 779 508H77C59 508 48 486 43 448Z" fill="#75b8d8" fill-opacity="0.09"/>
  <path d="M42 393C279 245 538 311 822 160" fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="8"/>
  <rect x="24" y="24" width="808" height="491.8" rx="54" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="3"/>`
    : `<rect x="12" y="12" width="648" height="424" rx="72" fill="url(#glass-${id})" stroke="#ffffff" stroke-opacity="0.92" stroke-width="4"/>
  <rect x="22" y="22" width="628" height="404" rx="64" fill="#ffffff" fill-opacity="0.50"/>
  ${inner}
  <path d="M34 68C178 16 438 18 638 66C514 151 326 164 70 150C52 126 40 96 34 68Z" fill="url(#shine-${id})"/>
  <path d="M30 374C176 300 410 308 646 184V392C646 414 628 424 606 424H64C46 424 34 407 30 374Z" fill="#75b8d8" fill-opacity="0.08"/>
  <path d="M31 334C196 229 420 270 642 148" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="6"/>
  <rect x="18" y="18" width="636" height="412" rx="68" fill="none" stroke="#ffffff" stroke-opacity="0.58" stroke-width="2.5"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title-${id}" ${sourceAttributes}>
<title id="title-${id}">${title}</title>
<defs>
  <linearGradient id="glass-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.96"/><stop offset="0.56" stop-color="#edf4fb" stop-opacity="0.76"/><stop offset="1" stop-color="#d9e8f4" stop-opacity="0.68"/></linearGradient>
  <linearGradient id="shine-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.82"/><stop offset="0.46" stop-color="#ffffff" stop-opacity="0.12"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
  <filter id="shadow-${id}" x="-20%" y="-25%" width="140%" height="160%"><feDropShadow dx="0" dy="${isCard ? 13 : 9}" stdDeviation="${
    isCard ? 13 : 10
  }" flood-color="#24445f" flood-opacity="0.18"/></filter>
  <clipPath id="art-${id}"><rect x="${art.x}" y="${art.y}" width="${art.width}" height="${art.height}" rx="${art.rx}"/></clipPath>
</defs>
<g filter="url(#shadow-${id})">
  ${outer}
</g>
</svg>
`;
}
'''
text, count = re.subn(
    r"function liquidGlassSvg\(asset, source, sourceFile\) \{.*?\n\}\n\nfunction outputPathFor\(asset\) \{",
    new_svg + "\nfunction outputPathFor(asset) {",
    text,
    count=1,
    flags=re.S,
)
if count != 1 and 'data-layout=' not in text:
    raise SystemExit("liquidGlassSvg replacement failed")

new_batch_validation = r'''function batchValidationErrors(asset) {
  const invalid = [];
  const path = join(PUBLIC_ROOT, asset.path.replace(/^\//u, ""));
  if (!existsSync(path)) {
    invalid.push(`${asset.id}:missing_file`);
    return invalid;
  }
  const svg = readFileSync(path, "utf8");
  const expectedViewBox = usesCardLayout(asset)
    ? 'viewBox="0 0 856 539.8"'
    : 'viewBox="0 0 672 448"';
  if (!svg.includes(expectedViewBox))
    invalid.push(`${asset.id}:wrong_layout`);
  if (!svg.includes("data-source-kind="))
    invalid.push(`${asset.id}:missing_provenance`);
  if (asset.source_kind !== "poimichi_generic_category" && !asset.source_sha256)
    invalid.push(`${asset.id}:missing_original_bytes`);
  if (asset.entity_type === "credit_card") {
    if (["official_favicon_fallback", "poimichi_generic_category"].includes(asset.source_kind))
      invalid.push(`${asset.id}:non_card_source`);
    const dimensions = asset.source_dimensions;
    if (dimensions?.width && dimensions?.height) {
      const ratio = dimensions.width / dimensions.height;
      const cardLike =
        (ratio >= 1.1 && ratio <= 2.1) || (ratio >= 0.47 && ratio <= 0.92);
      if (!cardLike) invalid.push(`${asset.id}:source_not_card_shaped:${ratio}`);
    }
  }
  return invalid;
}
'''
text, count = re.subn(
    r"function batchValidationErrors\(asset\) \{.*?\n\}\n\nasync function generateAssets\(catalogue\) \{",
    new_batch_validation + "\nasync function generateAssets(catalogue) {",
    text,
    count=1,
    flags=re.S,
)
if count != 1 and "wrong_layout" not in text:
    raise SystemExit("batch validation replacement failed")

# Reuse durable source bytes, but regenerate non-card SVG wrappers so the new
# compact service geometry takes effect without refetching successful batches.
old_reuse = '''      if (\n        cachedAsset &&\n        (!cachedAsset.source_sha256 ||\n          cachedSourceRow?.source_sha256 === cachedAsset.source_sha256)\n      ) {'''
new_reuse = '''      if (\n        cachedAsset &&\n        usesCardLayout(asset) &&\n        (!cachedAsset.source_sha256 ||\n          cachedSourceRow?.source_sha256 === cachedAsset.source_sha256)\n      ) {'''
replace_once(old_reuse, new_reuse, "durable wrapper reuse")

# Per-asset manifest metadata must describe the actual wrapper geometry.
generate_start = text.find("async function generateAssets(catalogue)")
generate_end = text.find("\nfunction validateManifest(manifest)", generate_start)
if generate_start < 0 or generate_end < 0:
    raise SystemExit("generateAssets range missing")
generate_block = text[generate_start:generate_end]
generate_block = generate_block.replace(
    'aspect_ratio: "85.60:53.98",',
    'aspect_ratio: usesCardLayout(asset) ? "85.60:53.98" : "3:2",',
)
text = text[:generate_start] + generate_block + text[generate_end:]

# Validate both geometry classes and guarantee that every family currently
# selectable in the database-backed wallet UI has an asset. This closes the
# exact hole that produced the ポ fallbacks.
new_validate = r'''function validateManifest(manifest) {
  if (manifest.asset_count !== EXPECTED_ASSETS)
    throw new Error(`manifest_asset_count_invalid:${manifest.asset_count}`);
  if (manifest.canonical_count !== EXPECTED_CANONICAL)
    throw new Error("manifest_canonical_count_invalid");
  if (manifest.alias_count !== EXPECTED_ALIASES)
    throw new Error("manifest_alias_count_invalid");
  if (new Set(manifest.assets.map((asset) => asset.id)).size !== EXPECTED_ASSETS)
    throw new Error("manifest_ids_not_unique");

  const requiredWalletFamilies = [
    "card.aeon", "card.aupay", "card.d", "card.paypay", "card.rakuten", "card.smbc", "card.view",
    "emoney.nanaco", "emoney.waon",
    "point.ana-mile", "point.d", "point.jal-mile", "point.jre", "point.moppy", "point.nanaco",
    "point.paypay", "point.ponta", "point.rakuten", "point.recruit", "point.saison", "point.v", "point.waon",
    "wallet.aeonpay", "wallet.anapay", "wallet.aupay", "wallet.dbarai", "wallet.famipay", "wallet.kyash",
    "wallet.paypay", "wallet.rakutenpay", "wallet.revolut-jp",
  ];
  const manifestIds = new Set(manifest.assets.map((asset) => asset.id));
  const invalid = [];
  for (const familyId of requiredWalletFamilies)
    if (!manifestIds.has(familyId)) invalid.push(`${familyId}:live_wallet_asset_missing`);

  for (const asset of manifest.assets) {
    const path = join(PUBLIC_ROOT, asset.path.replace(/^\//u, ""));
    if (!existsSync(path)) {
      invalid.push(`${asset.id}:missing_file`);
      continue;
    }
    const svg = readFileSync(path, "utf8");
    const expectedViewBox = usesCardLayout(asset)
      ? 'viewBox="0 0 856 539.8"'
      : 'viewBox="0 0 672 448"';
    if (!svg.includes(expectedViewBox))
      invalid.push(`${asset.id}:wrong_layout`);
    if (!svg.includes("data-source-kind="))
      invalid.push(`${asset.id}:missing_provenance`);
    if (asset.source_kind !== "poimichi_generic_category" && !asset.source_sha256)
      invalid.push(`${asset.id}:missing_original_bytes`);
    if (asset.entity_type === "credit_card") {
      if (["official_favicon_fallback", "poimichi_generic_category"].includes(asset.source_kind))
        invalid.push(`${asset.id}:non_card_source`);
      const dimensions = asset.source_dimensions;
      if (dimensions?.width && dimensions?.height) {
        const ratio = dimensions.width / dimensions.height;
        const cardLike =
          (ratio >= 1.1 && ratio <= 2.1) || (ratio >= 0.47 && ratio <= 0.92);
        if (!cardLike) invalid.push(`${asset.id}:source_not_card_shaped:${ratio}`);
      }
    }
  }
  if (invalid.length > 0) {
    writeJson(join(OUTPUT_ROOT, "validation-failures.json"), invalid);
    console.error("LIQUID_GLASS_VALIDATION_FAILURES=" + JSON.stringify(invalid));
    throw new Error(`asset_validation_failed:${invalid.length}`);
  }
}
'''
text, count = re.subn(
    r"function validateManifest\(manifest\) \{.*?\n\}\n\n\nasync function persistValidationResults",
    new_validate + "\n\nasync function persistValidationResults",
    text,
    count=1,
    flags=re.S,
)
if count != 1 and "live_wallet_asset_missing" not in text:
    raise SystemExit("validateManifest replacement failed")

# Production smoke test understands both card and service geometry, and checks
# the three formerly missing point aliases plus electronic-money aliases.
replace_once(
    '''        for (const id of [\n          "point.d",\n          "point.moppy",\n          "card.rakuten",\n          "instrument.card.d-card-gold",\n        ]) {''',
    '''        for (const id of [\n          "point.d",\n          "point.moppy",\n          "point.ana-mile",\n          "point.jal-mile",\n          "point.recruit",\n          "emoney.nanaco",\n          "emoney.waon",\n          "card.rakuten",\n          "instrument.card.d-card-gold",\n        ]) {''',
    "production smoke IDs",
)
replace_once(
    '''          if (!svg.includes('viewBox="0 0 856 539.8"'))\n            throw new Error(`production_ratio_invalid:${id}`);''',
    '''          const expectedViewBox = usesCardLayout(asset)\n            ? 'viewBox="0 0 856 539.8"'\n            : 'viewBox="0 0 672 448"';\n          if (!svg.includes(expectedViewBox))\n            throw new Error(`production_layout_invalid:${id}`);''',
    "production layout smoke",
)

path.write_text(text)
print("Hardened Liquid Glass visual quality, geometry, and live-wallet coverage")
