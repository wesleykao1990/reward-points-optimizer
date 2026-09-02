(() => {
  const CARD_SKU_STORAGE_KEY = "point-route.card-skus.v1";
  const state = {
    ready: false,
    catalogueById: new Map(),
    manifestById: new Map(),
    cards: [],
    scheduled: false,
    rendering: false,
  };

  const exactCardLabels = Object.freeze({
    "instrument.card.aeon": "イオンカード",
    "instrument.card.aeon-card-select": "イオンカードセレクト",
    "instrument.card.aeon-jmb-card-jmb-waon-integrated":
      "イオンJMBカード（JMB WAON一体型）",
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
    "instrument.card.rakuten-ana-mileage-club-card":
      "楽天ANAマイレージクラブカード",
    "instrument.card.rakuten-bank-card-credit-function":
      "楽天銀行カード（クレジット機能付き）",
    "instrument.card.mitsui-sumitomo-card-nl": "三井住友カード（NL）",
    "instrument.card.mitsui-sumitomo-card-gold-nl":
      "三井住友カード ゴールド（NL）",
    "instrument.card.mitsui-sumitomo-card-platinum": "三井住友カード プラチナ",
    "instrument.card.mitsui-sumitomo-card-platinum-preferred":
      "三井住友カード プラチナプリファード",
    "instrument.card.olive-flexible-pay-general":
      "Oliveフレキシブルペイ（一般）",
    "instrument.card.olive-flexible-pay-gold": "Oliveフレキシブルペイ ゴールド",
    "instrument.card.olive-flexible-pay-platinum-preferred":
      "Oliveフレキシブルペイ プラチナプリファード",
    "instrument.card.marriott-bonvoy-american-express-premium-card":
      "Marriott Bonvoy アメリカン・エキスプレス・プレミアム・カード",
    "instrument.card.hilton-honors-american-express-card":
      "ヒルトン・オナーズ アメリカン・エキスプレス・カード",
    "instrument.card.hilton-honors-american-express-premium-card":
      "ヒルトン・オナーズ アメリカン・エキスプレス・プレミアム・カード",
  });

  const providerTranslations = Object.freeze({
    "American Express": "American Express",
    "Credit Saison": "セゾンカード",
    "JAL Card": "JALカード",
    ANA: "ANAカード",
    "EPOS Card": "エポスカード",
    "Mitsubishi UFJ NICOS": "三菱UFJニコス",
    "Sumitomo Mitsui Trust Club": "三井住友トラストクラブ",
    Viewcard: "ビューカード",
  });

  const knownProvider = (issuer = "") => {
    if (/AEON/iu.test(issuer))
      return {
        key: "family:card.aeon",
        label: "イオンカード",
        engineFamily: "card.aeon",
        order: 10,
      };
    if (/au Financial/iu.test(issuer))
      return {
        key: "family:card.aupay",
        label: "au PAY カード",
        engineFamily: "card.aupay",
        order: 20,
      };
    if (/NTT DOCOMO/iu.test(issuer))
      return {
        key: "family:card.d",
        label: "dカード",
        engineFamily: "card.d",
        order: 30,
      };
    if (/PayPay/iu.test(issuer))
      return {
        key: "family:card.paypay",
        label: "PayPayカード",
        engineFamily: "card.paypay",
        order: 40,
      };
    if (/Rakuten/iu.test(issuer))
      return {
        key: "family:card.rakuten",
        label: "楽天カード",
        engineFamily: "card.rakuten",
        order: 50,
      };
    if (/Viewcard/iu.test(issuer))
      return {
        key: "family:card.view",
        label: "ビューカード",
        engineFamily: "card.view",
        order: 60,
      };
    if (/Sumitomo Mitsui Card/iu.test(issuer))
      return {
        key: "family:card.smbc",
        label: "三井住友カード",
        engineFamily: "card.smbc",
        order: 70,
      };
    if (/American Express/iu.test(issuer))
      return {
        key: "issuer:american-express",
        label: "American Express",
        engineFamily: null,
        order: 80,
      };
    const base =
      String(issuer || "その他")
        .split(" / ")[0]
        .trim() || "その他";
    return {
      key: `issuer:${base.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "-")}`,
      label: providerTranslations[base] || base,
      engineFamily: null,
      order: 100,
    };
  };

  const readSelectedSkus = () => {
    try {
      const value = JSON.parse(
        localStorage.getItem(CARD_SKU_STORAGE_KEY) || "[]",
      );
      return new Set(
        Array.isArray(value)
          ? value.filter((item) => typeof item === "string")
          : [],
      );
    } catch {
      return new Set();
    }
  };

  const writeSelectedSkus = (selected) => {
    try {
      localStorage.setItem(
        CARD_SKU_STORAGE_KEY,
        JSON.stringify([...selected].sort()),
      );
    } catch {}
  };

  const cardLabel = (card) =>
    exactCardLabels[card.item_id] || card.display_name;

  const manifestAsset = (id) => {
    const asset = state.manifestById.get(id);
    if (!asset) return null;
    if (
      String(asset.id).startsWith("card.") &&
      String(asset.resolved_id).startsWith("instrument.card.")
    )
      return state.manifestById.get(asset.resolved_id) || asset;
    return asset;
  };

  const setManifestAsset = (frame, id, cardLayout = false) => {
    if (!(frame instanceof HTMLElement)) return;
    const asset = manifestAsset(id);
    if (!asset?.path) return;
    frame.classList.add("db-manifest-asset");
    frame.classList.toggle("is-liquid-card", cardLayout);
    frame.dataset.liquidAssetId = id;
    frame.dataset.liquidGlassPath = asset.path;
    if (
      frame.dataset.dbManifestPath === asset.path &&
      frame.querySelector("img")
    )
      return;
    const img = document.createElement("img");
    img.src = asset.path;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    frame.replaceChildren(img);
    frame.dataset.dbManifestPath = asset.path;
  };

  const serviceName = (id, fallback) =>
    state.catalogueById.get(id)?.display_name || fallback || id;

  const normalizeServiceOptions = () => {
    document
      .querySelectorAll(
        "#p0-mobile-pay-picker .p0-product-option, #p0-point-picker .p0-product-option, #payment-stack-owned .payment-stack-picker .p0-product-option",
      )
      .forEach((option) => {
        if (option.closest(".db-card-catalogue")) return;
        const input = option.querySelector(
          'input[data-p0-product], input[data-payment-stack-owned="true"]',
        );
        if (!input?.value || input.value.startsWith("card.")) return;
        const row = state.catalogueById.get(input.value);
        if (!row) return;
        const strong = option.querySelector(".p0-product-name strong");
        if (strong)
          strong.textContent = serviceName(input.value, strong.textContent);
        const small = option.querySelector(".p0-product-name small");
        if (
          small &&
          /^(?:ウォレット|ポイント|電子マネー|電子マネー残高|wallet|point)/iu.test(
            small.textContent || "",
          )
        )
          small.remove();
        setManifestAsset(
          option.querySelector(".payment-logo"),
          input.value,
          false,
        );
      });
  };

  const providerGroups = () => {
    const groups = new Map();
    state.cards.forEach((card) => {
      const descriptor = knownProvider(card.provider_name || "");
      if (!groups.has(descriptor.key))
        groups.set(descriptor.key, { ...descriptor, cards: [] });
      groups.get(descriptor.key).cards.push(card);
    });
    return [...groups.values()]
      .map((group) => ({
        ...group,
        cards: group.cards.sort((a, b) =>
          cardLabel(a).localeCompare(cardLabel(b), "ja"),
        ),
      }))
      .sort(
        (a, b) => a.order - b.order || a.label.localeCompare(b.label, "ja"),
      );
  };

  const proxyMap = (picker, selector) =>
    new Map(
      [...picker.querySelectorAll(selector)]
        .filter((input) => input.value?.startsWith("card."))
        .map((input) => [input.value, input]),
    );

  const extractProxyHolder = (picker, selector) => {
    const inputs = [...picker.querySelectorAll(selector)].filter((input) =>
      input.value?.startsWith("card."),
    );
    const holder = document.createElement("div");
    holder.className = "db-card-proxies";
    holder.hidden = true;
    inputs.forEach((input) => {
      holder.appendChild(input);
    });
    return holder;
  };

  const defaultSkuForProvider = (provider) => {
    if (provider.engineFamily) {
      const alias = state.manifestById.get(provider.engineFamily);
      if (
        alias?.resolved_id &&
        provider.cards.some((card) => card.item_id === alias.resolved_id)
      )
        return alias.resolved_id;
    }
    return provider.cards[0]?.item_id || null;
  };

  const renderProvider = (provider, proxy, selected, mode) => {
    const details = document.createElement("details");
    details.className = "db-card-provider";
    details.dataset.providerKey = provider.key;
    const selectedCount = provider.cards.filter((card) =>
      selected.has(card.item_id),
    ).length;
    if (selectedCount > 0) details.open = true;

    const summary = document.createElement("summary");
    const summaryLogo = document.createElement("span");
    summaryLogo.className = "payment-logo is-liquid-card db-provider-logo";
    const heroId = defaultSkuForProvider(provider);
    if (heroId) setManifestAsset(summaryLogo, heroId, true);
    summary.appendChild(summaryLogo);

    const copy = document.createElement("span");
    copy.className = "db-provider-copy";
    const strong = document.createElement("strong");
    strong.textContent = provider.label;
    const small = document.createElement("small");
    small.textContent = selectedCount
      ? `${selectedCount}/${provider.cards.length}枚選択中`
      : provider.engineFamily
        ? `${provider.cards.length}枚から選択`
        : `${provider.cards.length}枚・カタログ収録`;
    copy.append(strong, small);
    summary.appendChild(copy);
    details.appendChild(summary);

    const grid = document.createElement("div");
    grid.className = "db-card-products";
    provider.cards.forEach((card) => {
      const label = document.createElement("label");
      label.className = "p0-product-option db-card-sku-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(card.item_id);
      checkbox.dataset.cardSkuOwned = "true";
      checkbox.dataset.cardSku = card.item_id;
      checkbox.setAttribute("aria-label", `${cardLabel(card)}を選択`);
      const logo = document.createElement("span");
      logo.className = "payment-logo is-liquid-card";
      setManifestAsset(logo, card.item_id, true);
      const name = document.createElement("span");
      name.className = "p0-product-name";
      const title = document.createElement("strong");
      title.textContent = cardLabel(card);
      const note = document.createElement("small");
      note.textContent = provider.engineFamily
        ? "このカードを選択"
        : "カタログ収録（最適化は準備中）";
      name.append(title, note);
      label.append(checkbox, logo, name);
      checkbox.addEventListener("change", () => {
        const next = readSelectedSkus();
        if (checkbox.checked) next.add(card.item_id);
        else next.delete(card.item_id);
        writeSelectedSkus(next);
        if (proxy) {
          const any = provider.cards.some((candidate) =>
            next.has(candidate.item_id),
          );
          if (proxy.checked !== any) {
            proxy.checked = any;
            proxy.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        scheduleEnhance();
      });
      grid.appendChild(label);
    });
    details.appendChild(grid);
    return details;
  };

  const renderCardPicker = (picker, mode) => {
    if (!picker) return;
    const selector =
      mode === "earn"
        ? "input[data-p0-product]"
        : 'input[data-payment-stack-owned="true"]';
    const proxies = proxyMap(picker, selector);
    const selected = readSelectedSkus();
    const groups = providerGroups();

    groups.forEach((provider) => {
      const proxy = provider.engineFamily
        ? proxies.get(provider.engineFamily)
        : null;
      if (
        proxy?.checked &&
        !provider.cards.some((card) => selected.has(card.item_id))
      ) {
        const defaultSku = defaultSkuForProvider(provider);
        if (defaultSku) selected.add(defaultSku);
      }
    });
    writeSelectedSkus(selected);

    const proxyHolder = extractProxyHolder(picker, selector);
    const catalogue = document.createElement("div");
    catalogue.className = "db-card-catalogue";
    catalogue.dataset.mode = mode;
    groups.forEach((provider) => {
      const proxy = provider.engineFamily
        ? proxies.get(provider.engineFamily) || null
        : null;
      catalogue.appendChild(renderProvider(provider, proxy, selected, mode));
    });
    picker.replaceChildren(proxyHolder, catalogue);
  };

  const syncProxyChecks = () => {
    const selected = readSelectedSkus();
    const groups = providerGroups();
    groups.forEach((provider) => {
      if (!provider.engineFamily) return;
      const any = provider.cards.some((card) => selected.has(card.item_id));
      document
        .querySelectorAll(
          `input[data-p0-product][value="${provider.engineFamily}"], input[data-payment-stack-owned="true"][value="${provider.engineFamily}"]`,
        )
        .forEach((input) => {
          input.checked = any;
        });
    });
  };

  const findSpendCardPicker = () =>
    document.querySelector("#payment-stack-owned .payment-stack-picker");

  const enhance = () => {
    if (!state.ready || state.rendering) return;
    state.rendering = true;
    try {
      normalizeServiceOptions();
      const earnPicker = document.getElementById("p0-card-picker");
      if (
        earnPicker &&
        !earnPicker.querySelector(":scope > .db-card-catalogue")
      )
        renderCardPicker(earnPicker, "earn");
      const spendPicker = findSpendCardPicker();
      if (
        spendPicker &&
        !spendPicker.querySelector(":scope > .db-card-catalogue")
      )
        renderCardPicker(spendPicker, "spend");
      syncProxyChecks();
      normalizeServiceOptions();
    } finally {
      state.rendering = false;
    }
  };

  function scheduleEnhance() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => {
      state.scheduled = false;
      enhance();
    });
  }

  const load = async () => {
    const [catalogueResponse, manifestResponse] = await Promise.all([
      fetch("/catalogue-ui", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }),
      fetch("/assets/liquid-glass/manifest.json", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }),
    ]);
    if (!catalogueResponse.ok || !manifestResponse.ok)
      throw new Error("catalogue_sync_unavailable");
    const catalogue = await catalogueResponse.json();
    const manifest = await manifestResponse.json();
    if (
      catalogue.version !== "consumer-catalogue-ui.v1" ||
      !Array.isArray(catalogue.items)
    )
      throw new Error("catalogue_sync_invalid");
    if (
      manifest.version !== "liquid-glass-assets.v2" ||
      !Array.isArray(manifest.assets)
    )
      throw new Error("manifest_invalid");
    state.catalogueById = new Map(
      catalogue.items.map((item) => [item.item_id, item]),
    );
    state.cards = catalogue.items.filter(
      (item) => item.item_kind === "credit_card",
    );
    state.manifestById = new Map(
      manifest.assets.map((asset) => [asset.id, asset]),
    );
    state.ready = true;
    scheduleEnhance();
  };

  const observer = new MutationObserver(() => scheduleEnhance());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.getElementById("wallet-reset-button")?.addEventListener(
    "click",
    () => {
      try {
        localStorage.removeItem(CARD_SKU_STORAGE_KEY);
      } catch {}
      scheduleEnhance();
    },
    { capture: true },
  );
  void load().catch((error) => console.error("catalogue_sync_error", error));
})();
