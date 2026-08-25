(() => {
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;

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

  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("ja-JP")
      .replace(/[\s・･()（）／/_.-]+/gu, "")
      .trim();

  const OLD_SOURCE_IDS = Object.freeze({
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

  const LABEL_IDS = Object.freeze({
    dポイント: "point.d",
    "d point": "point.d",
    "jre point": "point.jre",
    nanacoポイント: "point.nanaco",
    "nanaco points": "point.nanaco",
    paypayポイント: "point.paypay",
    "paypay points": "point.paypay",
    pontaポイント: "point.ponta",
    ponta: "point.ponta",
    楽天ポイント: "point.rakuten",
    "rakuten point": "point.rakuten",
    vポイント: "point.v",
    "v point": "point.v",
    "waon point": "point.waon",
    楽天ペイ: "wallet.rakutenpay",
    "rakuten pay": "wallet.rakutenpay",
    paypay: "wallet.paypay",
    "aeon pay": "wallet.aeonpay",
    "au pay": "wallet.aupay",
    d払い: "wallet.dbarai",
    famipay: "wallet.famipay",
    ポイントmoppy: "point.moppy",
    moppy: "point.moppy",
    ポイントsaison: "point.saison",
    永久不滅ポイント: "point.saison-permanent",
    電子マネーnanaco: "emoney.nanaco",
    電子マネーwaon: "emoney.waon",
    suica: "storedvalue.suica",
    anaマイル: "mile.ana",
    jalマイル: "mile.jal",
  });

  let assetById = new Map();
  let assetByName = new Map();
  let manifestReady = false;

  const preferredAsset = (previous, next) => {
    if (!previous) return next;
    if (next.type === "service" && previous.type !== "service") return next;
    if (next.canonical === true && previous.canonical !== true) return next;
    return previous;
  };

  const buildAssetIndex = (manifest) => {
    if (
      !manifest ||
      manifest.version !== "liquid-glass-generated-manifest.v1" ||
      manifest.ready_count !== manifest.expected_asset_count ||
      !Array.isArray(manifest.assets)
    )
      throw new Error("liquid_glass_manifest_invalid");
    const byId = new Map();
    const byName = new Map();
    manifest.assets.forEach((asset) => {
      if (!asset || asset.status !== "ready" || typeof asset.path !== "string")
        return;
      byId.set(asset.id, preferredAsset(byId.get(asset.id), asset));
      const key = normalize(asset.name);
      if (key) byName.set(key, preferredAsset(byName.get(key), asset));
    });
    assetById = byId;
    assetByName = byName;
    manifestReady = true;
  };

  const rowLabel = (frame) => {
    const row = frame.closest(
      ".p0-product-option, .lot-card, .route-chain-node, [data-wallet-chip], .catalogue-family-card",
    );
    return (
      row
        ?.querySelector(
          ".p0-product-name strong, .lot-identity strong, strong, span",
        )
        ?.textContent?.trim() ?? ""
    );
  };

  const inferAssetId = (frame) => {
    if (frame.dataset.assetId) return frame.dataset.assetId;
    const option = frame.closest(".p0-product-option");
    const optionInput = option?.querySelector("input[data-p0-product]");
    if (optionInput?.value) return optionInput.value;
    const walletChip = frame.closest("[data-wallet-chip]");
    if (walletChip?.dataset.walletChip) return walletChip.dataset.walletChip;
    const image = frame.querySelector("img");
    if (image?.src) {
      const filename = new URL(image.src, window.location.href).pathname
        .split("/")
        .pop();
      if (filename && OLD_SOURCE_IDS[filename]) return OLD_SOURCE_IDS[filename];
    }
    const label = rowLabel(frame);
    const explicit = LABEL_IDS[normalize(label)];
    if (explicit) return explicit;
    return assetByName.get(normalize(label))?.id ?? "";
  };

  const hydrateLogoFrame = (frame) => {
    if (
      !manifestReady ||
      !(frame instanceof HTMLElement) ||
      frame.dataset.liquidGlassState === "ready" ||
      frame.dataset.liquidGlassState === "loading"
    )
      return;
    const id = inferAssetId(frame);
    const label = rowLabel(frame);
    const asset = assetById.get(id) ?? assetByName.get(normalize(label));
    if (!asset) return;

    const original = [...frame.childNodes].map((child) => child.cloneNode(true));
    const image = document.createElement("img");
    image.src = asset.path;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.dataset.liquidGlassAsset = asset.id;
    frame.dataset.assetId = asset.id;
    frame.dataset.liquidGlassState = "loading";
    image.addEventListener(
      "load",
      () => {
        frame.dataset.liquidGlassState = "ready";
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        frame.replaceChildren(...original.map((node) => node.cloneNode(true)));
        frame.dataset.liquidGlassState = "failed";
      },
      { once: true },
    );
    frame.replaceChildren(image);
  };

  const hydratePaymentLogos = (root = document) => {
    root.querySelectorAll?.(".payment-logo").forEach(hydrateLogoFrame);
  };

  const observePaymentLogos = () => {
    const observer = new MutationObserver((records) => {
      records.forEach((record) =>
        record.addedNodes.forEach((added) => {
          if (!(added instanceof Element)) return;
          if (added.matches(".payment-logo")) hydrateLogoFrame(added);
          hydratePaymentLogos(added);
        }),
      );
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  const loadLiquidGlassAssets = async () => {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/liquid-glass.css";
    document.head.appendChild(stylesheet);
    try {
      const response = await fetch("/assets/liquid-glass/manifest.json", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      buildAssetIndex(await response.json());
      hydratePaymentLogos();
      observePaymentLogos();
    } catch {
      // The original first-party logo remains visible when the generated pack
      // is temporarily unavailable during a deployment transition.
    }
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

  void loadLiquidGlassAssets();
  void loadCoverage();
})();
