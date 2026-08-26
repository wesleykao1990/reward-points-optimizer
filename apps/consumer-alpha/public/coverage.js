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
    "ポイント(moppy)": "point.moppy",
    Moppy: "point.moppy",
    "ポイント(saison)": "point.saison",
    永久不滅ポイント: "point.saison-permanent",
    "電子マネー(nanaco)": "emoney.nanaco",
    "電子マネー(waon)": "emoney.waon",
    Suica: "storedvalue.suica",
    ANAマイル: "mile.ana",
    JALマイル: "mile.jal",
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
    image.addEventListener(
      "error",
      () => {
        if (frame.dataset.liquidGlassPath !== asset.path) return;
        frame.replaceChildren(...original.map((node) => node.cloneNode(true)));
        frame.dataset.liquidGlassFailed = asset.path;
        delete frame.dataset.liquidGlassPath;
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
      manifest.asset_count !== 246 ||
      !Array.isArray(manifest.assets)
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
})();
