(function coverageRuntime() {
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
    ANAマイル: "point.ana-mile",
    JALマイル: "point.jal-mile",
    リクルートポイント: "point.recruit",
    永久不滅ポイント: "point.saison",
    nanaco: "emoney.nanaco",
    WAON: "emoney.waon",
    Suica: "storedvalue.suica",
    Revolut: "wallet.revolut-jp",
    "ANA Pay": "wallet.anapay",
    Kyash: "wallet.kyash",
  });

  const serviceNames = Object.freeze({
    "wallet.anapay": "ANA Pay",
    "wallet.ana-pay": "ANA Pay",
    "wallet.kyash": "Kyash",
    "wallet.revolut": "Revolut",
    "wallet.revolut-jp": "Revolut",
    "point.ana-mile": "ANAマイル",
    "point.jal-mile": "JALマイル",
    "point.recruit": "リクルートポイント",
    "point.moppy": "モッピーポイント",
    "point.saison": "永久不滅ポイント",
    "point.saison-permanent": "永久不滅ポイント",
    "emoney.nanaco": "nanaco",
    "emoney.waon": "WAON",
    "storedvalue.nanaco": "nanaco",
    "storedvalue.waon": "WAON",
  });

  const cardLabels = Object.freeze({
    "instrument.card.aeon": "イオンカード",
    "instrument.card.aeon-card-select": "イオンカードセレクト",
    "instrument.card.aeon-jmb-card-jmb-waon-integrated": "イオンJMBカード（JMB WAON一体型）",
    "instrument.card.aeon-suica-card": "イオンSuicaカード",
    "instrument.card.cosmo-the-card-opus": "コスモ・ザ・カード・オーパス",
    "instrument.card.au-pay-card": "au PAY カード",
    "instrument.card.au-pay-gold-card": "au PAY ゴールドカード",
    "instrument.card.d": "dカード",
    "instrument.card.d-card-gold": "dカード GOLD",
    "instrument.card.d-card-platinum": "dカード PLATINUM",
    "instrument.card.paypay-card": "PayPayカード",
    "instrument.card.paypay-card-gold": "PayPayカード ゴールド",
    "instrument.card.view-card-standard": "ビューカード スタンダード",
    "instrument.card.jre-card": "JRE CARD",
    "instrument.card.bic-camera-suica-card": "ビックカメラSuicaカード",
    "instrument.card.lumine-card": "ルミネカード",
    "instrument.card.jal-card-suica": "JALカードSuica",
    "instrument.card.rakuten-card": "楽天カード",
    "instrument.card.rakuten-gold-card": "楽天ゴールドカード",
    "instrument.card.rakuten-pink-card": "楽天PINKカード",
    "instrument.card.rakuten-premium-card": "楽天プレミアムカード",
    "instrument.card.rakuten-ana-mileage-club-card": "楽天ANAマイレージクラブカード",
    "instrument.card.rakuten-bank-card-credit-function": "楽天銀行カード（クレジット機能付き）",
    "instrument.card.mitsui-sumitomo-card-nl": "三井住友カード（NL）",
    "instrument.card.mitsui-sumitomo-card-gold-nl": "三井住友カード ゴールド（NL）",
    "instrument.card.mitsui-sumitomo-card-platinum": "三井住友カード プラチナ",
    "instrument.card.mitsui-sumitomo-card-platinum-preferred": "三井住友カード プラチナプリファード",
    "instrument.card.olive-flexible-pay-general": "Oliveフレキシブルペイ（一般）",
    "instrument.card.olive-flexible-pay-gold": "Oliveフレキシブルペイ ゴールド",
    "instrument.card.olive-flexible-pay-platinum-preferred": "Oliveフレキシブルペイ プラチナプリファード",
    "instrument.card.amazon-mastercard": "Amazon Mastercard",
    "instrument.card.ana-visa-platinum-premium-card": "ANA VISAプラチナ プレミアムカード",
    "instrument.card.jp-bank-card-general": "JP BANKカード（一般）",
  });

  const cardProviders = Object.freeze({
    "card.aeon": Object.freeze({
      label: "イオンカード",
      cards: Object.freeze([
        "instrument.card.aeon",
        "instrument.card.aeon-card-select",
        "instrument.card.aeon-jmb-card-jmb-waon-integrated",
        "instrument.card.aeon-suica-card",
        "instrument.card.cosmo-the-card-opus",
      ]),
    }),
    "card.aupay": Object.freeze({
      label: "au PAY カード",
      cards: Object.freeze([
        "instrument.card.au-pay-card",
        "instrument.card.au-pay-gold-card",
      ]),
    }),
    "card.d": Object.freeze({
      label: "dカード",
      cards: Object.freeze([
        "instrument.card.d",
        "instrument.card.d-card-gold",
        "instrument.card.d-card-platinum",
      ]),
    }),
    "card.paypay": Object.freeze({
      label: "PayPayカード",
      cards: Object.freeze([
        "instrument.card.paypay-card",
        "instrument.card.paypay-card-gold",
      ]),
    }),
    "card.view": Object.freeze({
      label: "ビューカード",
      cards: Object.freeze([
        "instrument.card.view-card-standard",
        "instrument.card.jre-card",
        "instrument.card.bic-camera-suica-card",
        "instrument.card.lumine-card",
        "instrument.card.jal-card-suica",
      ]),
    }),
    "card.rakuten": Object.freeze({
      label: "楽天カード",
      cards: Object.freeze([
        "instrument.card.rakuten-card",
        "instrument.card.rakuten-gold-card",
        "instrument.card.rakuten-pink-card",
        "instrument.card.rakuten-premium-card",
        "instrument.card.rakuten-ana-mileage-club-card",
        "instrument.card.rakuten-bank-card-credit-function",
      ]),
    }),
    "card.smbc": Object.freeze({
      label: "三井住友カード",
      cards: Object.freeze([
        "instrument.card.mitsui-sumitomo-card-nl",
        "instrument.card.mitsui-sumitomo-card-gold-nl",
        "instrument.card.mitsui-sumitomo-card-platinum",
        "instrument.card.mitsui-sumitomo-card-platinum-preferred",
        "instrument.card.olive-flexible-pay-general",
        "instrument.card.olive-flexible-pay-gold",
        "instrument.card.olive-flexible-pay-platinum-preferred",
        "instrument.card.amazon-mastercard",
        "instrument.card.ana-visa-platinum-premium-card",
        "instrument.card.jp-bank-card-general",
      ]),
    }),
  });

  const brandMarkOverrides = Object.freeze({
    "point.jal-mile": Object.freeze({ className: "is-jal", title: "JAL", subtitle: "JALマイル" }),
    "mile.jal": Object.freeze({ className: "is-jal", title: "JAL", subtitle: "JAL MILEAGE BANK" }),
    "wallet.revolut": Object.freeze({ className: "is-revolut", title: "Revolut", subtitle: "" }),
    "wallet.revolut-jp": Object.freeze({ className: "is-revolut", title: "Revolut", subtitle: "" }),
    "point.saison": Object.freeze({ className: "is-saison", title: "永久不滅ポイント", subtitle: "SAISON" }),
    "point.saison-permanent": Object.freeze({ className: "is-saison", title: "永久不滅ポイント", subtitle: "SAISON" }),
  });

  const CARD_SKU_STORAGE_KEY = "point-route.card-skus.v1";
  let byId = new Map();
  let byName = new Map();
  let ready = false;

  const readSelectedCardSkus = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(CARD_SKU_STORAGE_KEY) || "[]");
      return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
    } catch {
      return new Set();
    }
  };

  const writeSelectedCardSkus = () => {
    const ids = [...document.querySelectorAll('input[data-card-sku-owned="true"]:checked')]
      .map((input) => input.dataset.cardSku)
      .filter(Boolean);
    try { localStorage.setItem(CARD_SKU_STORAGE_KEY, JSON.stringify([...new Set(ids)])); } catch {}
  };

  const inferId = (frame) => {
    if (frame.dataset.liquidAssetId) return frame.dataset.liquidAssetId;
    const option = frame.closest(".p0-product-option");
    const optionInput = option?.querySelector(
      "input[data-p0-product], input[data-payment-stack-owned], input[data-card-sku-owned]",
    );
    if (optionInput?.dataset.cardSku) return optionInput.dataset.cardSku;
    if (optionInput?.value) return optionInput.value;
    const walletChip = frame.closest("[data-wallet-chip]");
    if (walletChip?.dataset.walletChip) return walletChip.dataset.walletChip;
    const image = frame.querySelector("img");
    if (image?.src) {
      const filename = new URL(image.src, window.location.href).pathname.split("/").pop();
      if (filename && oldSourceIds[filename]) return oldSourceIds[filename];
    }
    const row = frame.closest(
      ".p0-product-option, .lot-card, .route-chain-node, [data-wallet-chip]",
    );
    const label = row
      ?.querySelector(".p0-product-name strong, .lot-identity strong, strong, span")
      ?.textContent?.trim();
    if (labelIds[label]) return labelIds[label];
    return byName.get(normalize(label))?.id ?? "";
  };

  const brandMark = (spec) => {
    const mark = document.createElement("span");
    mark.className = `liquid-brand-mark ${spec.className}`;
    const wrap = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = spec.title;
    wrap.appendChild(strong);
    if (spec.subtitle) {
      const small = document.createElement("small");
      small.textContent = spec.subtitle;
      wrap.appendChild(small);
    }
    mark.appendChild(wrap);
    return mark;
  };

  const sourceFor = (asset, cardLayout) => {
    if (cardLayout) return asset.path;
    const crispKinds = new Set([
      "checked_in_official_artwork",
      "official_exact_image",
      "official-explicit-image",
    ]);
    if (crispKinds.has(asset.source_kind) && asset.source_asset_path)
      return asset.source_asset_path;
    return asset.path;
  };

  const hydrateFrame = (frame) => {
    if (!(frame instanceof HTMLElement) || !ready) return;
    const id = inferId(frame);
    const asset = byId.get(id);
    if (!asset) return;
    const cardLayout =
      asset.entity_type === "credit_card" || String(asset.id).startsWith("instrument.card.") || String(id).startsWith("card.");
    frame.classList.toggle("is-liquid-card", cardLayout);
    frame.dataset.liquidAssetId = id;

    const markSpec = brandMarkOverrides[id] || brandMarkOverrides[asset.id];
    if (markSpec && !cardLayout) {
      if (frame.dataset.liquidGlassPath === `brand:${id}`) return;
      frame.replaceChildren(brandMark(markSpec));
      frame.dataset.liquidGlassPath = `brand:${id}`;
      return;
    }

    const source = sourceFor(asset, cardLayout);
    if (!source || frame.dataset.liquidGlassPath === source) return;
    const original = [...frame.childNodes].map((node) => node.cloneNode(true));
    const image = document.createElement("img");
    image.src = source;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener(
      "error",
      () => {
        if (frame.dataset.liquidGlassPath !== source) return;
        if (source !== asset.path && asset.path) {
          delete frame.dataset.liquidGlassPath;
          image.src = asset.path;
          frame.dataset.liquidGlassPath = asset.path;
          return;
        }
        frame.replaceChildren(...original.map((node) => node.cloneNode(true)));
        frame.dataset.liquidGlassFailed = source;
        delete frame.dataset.liquidGlassPath;
      },
      { once: true },
    );
    frame.replaceChildren(image);
    frame.dataset.liquidGlassPath = source;
  };

  const renameOption = (option) => {
    const input = option.querySelector("input");
    if (!input?.value || !serviceNames[input.value]) return;
    const strong = option.querySelector(".p0-product-name strong");
    if (strong) strong.textContent = serviceNames[input.value];
    const small = option.querySelector(".p0-product-name small");
    if (small && /^(?:ウォレット|ポイント|電子マネー|stored|wallet|point)/iu.test(small.textContent || ""))
      small.textContent = "";
  };

  const makeProviderDetails = (option, familyId, config) => {
    if (option.dataset.cardProviderEnhanced === "true") return;
    const products = config.cards
      .map((id) => byId.get(id))
      .filter((asset) => asset && asset.entity_type === "credit_card");
    if (!products.length) return;

    const selectedSkus = readSelectedCardSkus();
    const details = document.createElement("details");
    details.className = "card-provider-group";
    details.dataset.cardProvider = familyId;

    const summary = document.createElement("summary");
    const logo = document.createElement("span");
    logo.className = "payment-logo is-liquid-card";
    logo.dataset.liquidAssetId = familyId;
    summary.appendChild(logo);
    const copy = document.createElement("span");
    copy.className = "card-provider-copy";
    const strong = document.createElement("strong");
    strong.textContent = config.label;
    const small = document.createElement("small");
    small.textContent = `${products.length}枚から選択`;
    copy.append(strong, small);
    summary.appendChild(copy);
    details.appendChild(summary);

    const proxy = document.createElement("input");
    proxy.type = "checkbox";
    proxy.value = familyId;
    proxy.hidden = true;
    proxy.dataset.paymentStackOwned = "true";
    proxy.setAttribute("aria-hidden", "true");
    details.appendChild(proxy);

    const grid = document.createElement("div");
    grid.className = "card-provider-products";
    products.forEach((asset) => {
      const child = document.createElement("label");
      child.className = "p0-product-option card-sku-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.cardSkuOwned = "true";
      checkbox.dataset.cardSku = asset.id;
      checkbox.checked = selectedSkus.has(asset.id);
      const childLogo = document.createElement("span");
      childLogo.className = "payment-logo is-liquid-card";
      childLogo.dataset.liquidAssetId = asset.id;
      const name = document.createElement("span");
      name.className = "p0-product-name";
      const productName = document.createElement("strong");
      productName.textContent = cardLabels[asset.id] || asset.display_name;
      const note = document.createElement("small");
      note.textContent = "このカードを選択";
      name.append(productName, note);
      child.append(checkbox, childLogo, name);
      checkbox.addEventListener("change", () => {
        proxy.checked = [...grid.querySelectorAll('input[data-card-sku-owned="true"]')].some((item) => item.checked);
        writeSelectedCardSkus();
      });
      grid.appendChild(child);
    });
    proxy.checked = [...grid.querySelectorAll('input[data-card-sku-owned="true"]')].some((item) => item.checked);
    details.appendChild(grid);
    option.dataset.cardProviderEnhanced = "true";
    option.replaceWith(details);
    hydrateFrame(logo);
    grid.querySelectorAll(".payment-logo").forEach(hydrateFrame);
  };

  const enhancePaymentPicker = () => {
    if (!ready) return;
    document
      .querySelectorAll("#payment-stack-owned .payment-stack-picker > .p0-product-option")
      .forEach((option) => {
        renameOption(option);
        const input = option.querySelector('input[data-payment-stack-owned="true"]');
        if (!input?.value) return;
        const provider = cardProviders[input.value];
        if (provider) makeProviderDetails(option, input.value, provider);
      });
    document
      .querySelectorAll("#payment-stack-owned .payment-stack-picker > .p0-product-option")
      .forEach(renameOption);
  };

  const hydrateAll = (root = document) => {
    root.querySelectorAll?.(".payment-logo").forEach(hydrateFrame);
  };

  const observe = () => {
    const observer = new MutationObserver((records) => {
      let shouldEnhance = false;
      records.forEach((record) =>
        record.addedNodes.forEach((added) => {
          if (!(added instanceof Element)) return;
          if (added.matches(".payment-logo")) hydrateFrame(added);
          hydrateAll(added);
          if (added.matches(".p0-product-option, .payment-stack-picker") || added.querySelector?.(".p0-product-option"))
            shouldEnhance = true;
        }),
      );
      if (shouldEnhance) enhancePaymentPicker();
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
    const manifestById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
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
      (asset.labels ?? []).forEach((label) => byName.set(normalize(label), asset));
    });
    ready = true;
    installStylesheet();
    hydrateAll();
    enhancePaymentPicker();
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
})();
