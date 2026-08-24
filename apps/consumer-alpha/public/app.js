(() => {
  let sessionHistoryCount = 0;
  let informationFacts = [];
  let informationLoaded = false;
  let catalogueRules = [];
  let catalogueRulesLoaded = false;
  let campaignLinks = [];
  let campaignLinksLoaded = false;
  let consumerReference = null;

  const node = (tag, className) => {
    const value = document.createElement(tag);
    if (className) value.className = className;
    return value;
  };

  const text = (tag, value, className) => {
    const valueNode = node(tag, className);
    valueNode.textContent = String(value == null ? "" : value);
    return valueNode;
  };

  const paymentLogoSources = Object.freeze({
    "point.d": "/assets/payment-logos/dpoint.png",
    "point.jre": "/assets/payment-logos/jrepoint.webp",
    "point.nanaco": "/assets/payment-logos/nanaco.png",
    "point.paypay": "/assets/payment-logos/paypay.svg",
    "point.ponta": "/assets/payment-logos/ponta.png",
    "point.rakuten": "/assets/payment-logos/rakutenpoint.svg",
    "point.v": "/assets/payment-logos/vpoint.svg",
    "point.waon": "/assets/payment-logos/waon.png",
    "emoney.nanaco": "/assets/payment-logos/nanaco.png",
    "emoney.waon": "/assets/payment-logos/waon.png",
    "storedvalue.nanaco": "/assets/payment-logos/nanaco.png",
    "storedvalue.waon": "/assets/payment-logos/waon.png",
    "wallet.aeonpay": "/assets/payment-logos/aeonpay.png",
    "wallet.aupay": "/assets/payment-logos/aupay.png",
    "wallet.dbarai": "/assets/payment-logos/dbarai.png",
    "wallet.famipay": "/assets/payment-logos/famipay.svg",
    "wallet.paypay": "/assets/payment-logos/paypay.svg",
    "wallet.rakutenpay": "/assets/payment-logos/rakutenpay.svg",
    "card.aeon": "/assets/payment-logos/aeoncard.png",
    "card.aupay": "/assets/payment-logos/aupaycard.png",
    "card.d": "/assets/payment-logos/dcard.png",
    "card.paypay": "/assets/payment-logos/paypaycard.png",
    "card.rakuten": "/assets/payment-logos/rakutencard.svg",
    "card.smbc": "/assets/payment-logos/smbccard.png",
    "card.view": "/assets/payment-logos/viewcard.gif",
  });

  const paymentLogoSource = (familyId) => {
    if (paymentLogoSources[familyId]) return paymentLogoSources[familyId];
    const parts = String(familyId).split(".");
    while (parts.length > 2) {
      parts.pop();
      const parent = parts.join(".");
      if (paymentLogoSources[parent]) return paymentLogoSources[parent];
    }
    return null;
  };

  const paymentLogo = (familyId, label = "") => {
    const frame = node("span", "payment-logo");
    const source = paymentLogoSource(familyId);
    if (source) {
      const image = node("img");
      image.src = source;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      frame.appendChild(image);
    } else {
      frame.appendChild(
        text(
          "span",
          String(label || familyId)
            .trim()
            .slice(0, 1),
          "payment-logo-fallback",
        ),
      );
    }
    return frame;
  };

  const routeNodeFamilyIds = Object.freeze({
    "asset.mile.ana": "mile.ana",
    "asset.mile.jal": "mile.jal",
    "asset.mile.jal-campaign-bonus": "mile.jal",
    "asset.point.moppy": "point.moppy",
    "asset.point.moppy-campaign-rebate": "point.moppy",
    "asset.value.ana-pay": "wallet.anapay",
    "asset.value.nanaco": "emoney.nanaco",
    "asset.value.waon": "emoney.waon",
    "asset.value.revolut-jpy": "wallet.revolut",
    "asset.value.suica": "storedvalue.suica",
    "merchant.rakuten-market": "point.rakuten",
    "portal.jal-mileage-park": "portal.jal-mileage-park",
  });

  const routeNodeInitials = Object.freeze({
    "mile.ana": "ANA",
    "mile.jal": "JAL",
    "point.moppy": "M",
    "point.saison-permanent": "永",
    "point.jr-kyupo": "JR",
    "point.seven-mile": "7iD",
    "storedvalue.suica": "Su",
    "wallet.anapay": "ANA",
    "wallet.revolut": "R",
    "portal.jal-mileage-park": "JAL",
  });

  const routeNodeFamilyId = (nodeId) => {
    if (routeNodeFamilyIds[nodeId]) return routeNodeFamilyIds[nodeId];
    if (String(nodeId).startsWith("asset.point."))
      return `point.${String(nodeId).slice("asset.point.".length)}`;
    return String(nodeId || "route.unknown");
  };

  const routeNodeLogo = (nodeId, label) => {
    const familyId = routeNodeFamilyId(nodeId);
    const logo = paymentLogo(familyId, label);
    logo.classList.add("route-node-logo");
    const fallback = logo.querySelector(".payment-logo-fallback");
    if (fallback)
      fallback.textContent =
        routeNodeInitials[familyId] || String(label || "?").slice(0, 2);
    return logo;
  };

  const WALLET_STORAGE_KEY = "point-route.wallet.v1";
  let walletHydrated = false;
  let suppressWalletPersistence = false;
  let walletStorageAvailable = true;

  const safeStoredWalletIds = (value) => {
    const ids = Array.isArray(value)
      ? value
      : value && Array.isArray(value.family_ids)
        ? value.family_ids
        : [];
    return [...new Set(ids)]
      .filter(
        (familyId) =>
          typeof familyId === "string" &&
          /^(?:point|wallet|card|emoney|storedvalue)\.[a-z0-9._-]{1,95}$/u.test(
            familyId,
          ),
      )
      .slice(0, 32);
  };

  const readStoredWalletIds = () => {
    try {
      const raw = window.localStorage.getItem(WALLET_STORAGE_KEY);
      if (!raw) return [];
      return safeStoredWalletIds(JSON.parse(raw));
    } catch {
      walletStorageAvailable = false;
      return [];
    }
  };

  const writeStoredWalletIds = (familyIds) => {
    try {
      window.localStorage.setItem(
        WALLET_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          family_ids: safeStoredWalletIds(familyIds),
        }),
      );
      walletStorageAvailable = true;
      return true;
    } catch {
      walletStorageAvailable = false;
      return false;
    }
  };

  const removeStoredWalletIds = () => {
    try {
      window.localStorage.removeItem(WALLET_STORAGE_KEY);
      walletStorageAvailable = true;
      return true;
    } catch {
      walletStorageAvailable = false;
      return false;
    }
  };

  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

  // One outline set, 24x24 grid, 1.6px stroke, round caps. Stroke colour and
  // width live in the stylesheet so every glyph stays on the same system.
  const iconPaths = Object.freeze({
    arrow: ["M5 12h13", "m13 6.5 6 5.5-6 5.5"],
    check: ["m5.5 12.4 4.2 4.2 8.8-9.2"],
    slip: [
      "M6 3.5h12v15.8l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z",
      "M9 8h6",
      "M9 11.5h6",
    ],
    hourglass: [
      "M7 3.5h10",
      "M7 20.5h10",
      "M7.5 3.5c0 4 4.5 5.5 4.5 8.5s-4.5 4.5-4.5 8.5",
      "M16.5 3.5c0 4-4.5 5.5-4.5 8.5s4.5 4.5 4.5 8.5",
    ],
    storefront: [
      "M4 9.5 5.5 5h13L20 9.5",
      "M4.5 9.5h15V19a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z",
      "M9.5 20v-5.5h5V20",
    ],
    clock: [
      "M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4z",
      "M12 7.6V12l3 1.9",
    ],
    chevron: ["m6.5 9.5 5.5 5.5 5.5-5.5"],
  });

  const icon = (name, className) => {
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", className ? `glyph ${className}` : "glyph");
    (iconPaths[name] || []).forEach((definition) => {
      const path = document.createElementNS(SVG_NAMESPACE, "path");
      path.setAttribute("d", definition);
      svg.appendChild(path);
    });
    return svg;
  };

  // ---------------------------------------------------------------------
  // Motion helpers.
  //
  // Every reveal here is opt-in: the resting DOM is already the finished
  // state, and these functions only add the class that plays the arrival.
  // If script fails, or the visitor asked for reduced motion, the content
  // is simply there.
  // ---------------------------------------------------------------------
  const reducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Stagger index travels as a custom property so the cascade order lives
  // in the markup rather than in a pile of nth-child rules.
  const stagger = (elements, className = "reveal") => {
    if (reducedMotion()) return;
    [...elements].forEach((element, index) => {
      element.style.setProperty("--i", String(index));
      element.classList.remove(className);
      // Force a reflow so re-rendered lists replay rather than sit still.
      void element.offsetWidth;
      element.classList.add(className);
    });
  };

  // Figures count rather than appear. The same easing as the wipes, so the
  // number settles on the beat the panel does.
  const snapEase = (t) => {
    const u = 1 - t;
    return 3 * u * u * t * 0.05 + 3 * u * t * t * 0.97 + t * t * t;
  };

  const countTo = (element, target, format, duration = 900) => {
    if (reducedMotion() || target <= 0) {
      element.textContent = format(target);
      return;
    }
    const started = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      element.textContent = format(Math.round(target * snapEase(progress)));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const dropCurtain = () => {
    if (reducedMotion()) return;
    const curtain = node("div", "curtain");
    curtain.setAttribute("aria-hidden", "true");
    curtain.appendChild(node("i"));
    curtain.appendChild(node("i"));
    document.body.appendChild(curtain);
    const remove = () => curtain.remove();
    curtain.addEventListener("animationend", remove, { once: true });
    // Belt and braces: never let a stalled animation leave a sheet over
    // the interface.
    window.setTimeout(remove, 1400);
  };

  const clear = (element) => {
    while (element.firstChild) element.removeChild(element.firstChild);
  };

  const activateTab = (tabName) => {
    const validTabs = ["balance", "spend", "earn", "information", "settings"];
    if (!validTabs.includes(tabName)) return;
    document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
      const active = panel.dataset.tabPanel === tabName;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
      panel.setAttribute("aria-hidden", String(!active));
      panel.classList.remove("is-entering");
      if (active && !reducedMotion()) {
        void panel.offsetWidth;
        panel.classList.add("is-entering");
      }
    });
    document
      .querySelectorAll(".bottom-nav [data-tab-target]")
      .forEach((button) => {
        const active = button.dataset.tabTarget === tabName;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
        button.setAttribute("tabindex", active ? "0" : "-1");
        button.setAttribute("role", "tab");
        if (!button.id) button.id = `tab-button-${button.dataset.tabTarget}`;
        button.setAttribute("aria-controls", `tab-${button.dataset.tabTarget}`);
      });
    const activePanel = document.querySelector(`[data-tab-panel="${tabName}"]`);
    if (activePanel && activePanel.id !== "tab-balance")
      activePanel.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (tabName === "information") {
      void loadExperimentalRules();
      void loadInformationFacts();
      void loadLotteryLinks();
    }
  };

  const selectField = (options) => {
    const select = node("select");
    options.forEach((option) => {
      const choice = node("option");
      choice.value = option.value;
      choice.textContent = option.label;
      select.appendChild(choice);
    });
    return select;
  };

  const collectManualState = () => {
    const instruments = [];
    document
      .querySelectorAll('input[name="instrument"]:checked')
      .forEach((input) => {
        instruments.push(input.value);
      });
    return {
      // These identifiers are fixed by the host-owned synthetic catalogue;
      // the browser never submits editable aliases.
      merchant_id: "merchant.synthetic",
      branch_id: "location.synthetic",
      amount_jpy: Number(document.getElementById("amount-jpy").value),
      owned_instruments: instruments,
      // The old generic stored-value control did not represent a real service.
      // Real electronic-money routes provide their own service-specific inputs.
      stored_value_use: "no",
      facts: [],
      caps: [],
    };
  };

  const collectUnifiedState = () => {
    const manual = collectManualState();
    const amount = Number(document.getElementById("amount-jpy").value);
    const merchantId = document.getElementById("merchant-selector").value;
    const numericValueOr = (id, fallback) => {
      const value = Number(document.getElementById(id)?.value);
      return Number.isFinite(value) ? value : fallback;
    };
    return {
      ...manual,
      merchant_id: merchantId,
      branch_id:
        merchantId === "merchant.synthetic"
          ? "location.synthetic"
          : `location.${merchantId.slice("merchant.".length)}.representative`,
      amount_jpy: amount,
      tax_exclusive_amount_jpy: numericValueOr("nanaco-tax-exclusive", amount),
      nanaco_balance_jpy: numericValueOr("nanaco-balance", amount),
      nanaco_credit_charge_balance_jpy: numericValueOr("credit-balance", 0),
      charge_amount_jpy: numericValueOr("credit-charge-amount", 5000),
      seven_card_plus_owned: Boolean(
        document.getElementById("seven-card-owned")?.checked,
      ),
      nanaco_credit_charge_preregistered: Boolean(
        document.getElementById("credit-preregistered")?.checked,
      ),
      effective_at: new Date().toISOString(),
      selected_p0_products: selectedP0Products(true),
    };
  };

  const translatedText = (value) => {
    const translations = {
      "Should stored value be used for this purchase?":
        "今回の支払いで電子マネーを使いますか？",
      "Stored-value use is unknown; answer before choosing.":
        "電子マネーを使うか決めると、より正確に比較できます。",
      "All merchant, acceptance, reward, and valuation facts are synthetic.":
        "店舗・利用条件・特典・価値はすべてデモ用の架空データです。",
      "All values and acceptance facts are synthetic.":
        "価値と利用可否はすべてデモ用の架空データです。",
      "External card funding is explicitly included.":
        "カードからのチャージ金額を支出として含めています。",
      "Stored-value use is unknown; the stored-value candidate is withheld.":
        "",
      "The host supplies the complete fixture rule and evidence set.":
        "デモ用のルールと根拠は安全なホスト側で管理しています。",
      "The user opted out of stored-value use for this run.": "",
    };
    if (translations[value]) return translations[value];
    const usage =
      /^Stored-value usage is ([a-z0-9_]+); the fixture valuation is ([0-9.]+) JPY per unit\.$/u.exec(
        value,
      );
    if (!usage) return value;
    const labels = {
      within_30_days: "30日以内",
      within_90_days: "90日以内",
      eventually: "いずれ",
      rarely: "ほとんど使わない",
      custom: "指定値",
    };
    return `電子マネーは「${labels[usage[1]] || usage[1]}」に使用し、1単位を${usage[2]}円として見積もります。`;
  };

  const appendList = (parent, heading, values) => {
    if (!values || !values.length) return;
    const section = node("div", "result-section");
    section.appendChild(text("h3", heading));
    const list = node("ul");
    values.forEach((value) => {
      const translated = translatedText(String(value));
      if (!translated) return;
      const item = node("li");
      item.textContent = translated;
      list.appendChild(item);
    });
    if (list.children.length) {
      section.appendChild(list);
      parent.appendChild(section);
    }
  };

  const planName = (plan) => {
    if (typeof plan.display_name === "string") return plan.display_name;
    if (plan.plan_id === "plan_synthetic_direct_card")
      return "カードでそのまま支払う";
    if (plan.plan_id === "plan_synthetic_topup_then_pay")
      return "電子マネーにチャージして支払う";
    return "比較で選ばれた支払い方";
  };

  const unifiedStatusLabels = Object.freeze({
    eligible: "利用条件を満たす候補",
    conditional: "確認が必要な候補",
    no_valid_plan: "有効な計画なし",
    blocked: "現在は表示を保留",
    unavailable: "情報を取得できません",
  });

  const unifiedIssueLabels = Object.freeze({
    facts_unavailable: "関連情報を読み込めませんでした。数値結果は表示します。",
    fact_binding_required:
      "判定に必要な情報との結び付きを確認できないため、このルートは保留です。",
    catalogue_unavailable: "ルートの掲載情報を確認できませんでした。",
    route_unavailable: "このルートは現在実行できません。",
    route_input_invalid: "このルートの入力条件を満たしていません。",
    rule_not_current: "このルートは指定時点では有効ではありません。",
    no_valid_plan: "入力条件では有効な計画がありません。",
    recommendation_malformed: "結果の形式を確認できませんでした。",
  });

  const routePlan = (route) =>
    route?.recommendation?.winner || route?.recommendation?.primary || null;

  const formatYen = (value) => {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return `¥${value.toLocaleString("ja-JP")}`;
  };

  const appendSupplementalRouteCorrection = (card, route) => {
    if (
      typeof route.recommendation_id !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(route.recommendation_id)
    )
      return;
    const actions = node("div", "route-actions");
    const correction = node("button", "secondary");
    correction.type = "button";
    correction.textContent = "情報の誤りを報告";
    correction.addEventListener("click", () => {
      const routeLabel = String(route.label || "");
      const searchValue = routeLabel
        .replace(/^(?:通常のお買い物|セブン‐イレブン)・/u, "")
        .replace(/（一般的な基本還元率）$/u, "")
        .split("→")[0]
        .replace("購入", "")
        .trim();
      const search = document.getElementById("information-search");
      search.value = searchValue;
      document.getElementById("information-family-filter").value = "";
      activateTab("information");
    });
    actions.appendChild(correction);
    card.appendChild(actions);
  };

  const renderSupplementalRoute = (parent, route) => {
    if (!route || typeof route !== "object") return;
    const card = node("article", "supplemental-route-card");
    const header = node("div", "supplemental-route-header");
    header.appendChild(text("h4", String(route.label || "チャージ情報")));
    header.appendChild(
      text("span", "支払い比較の対象外", "supplemental-badge"),
    );
    card.appendChild(header);

    const recommendation = route.recommendation;
    const plan = routePlan(route);
    const charge = formatYen(recommendation?.charge_amount_jpy);
    const before = formatYen(recommendation?.nanaco_balance_before_jpy);
    const after = formatYen(recommendation?.nanaco_balance_after_jpy);
    const rewardPoints =
      typeof plan?.reward_points === "string"
        ? plan.reward_points
        : typeof route.reward_units === "string"
          ? route.reward_units
          : null;

    if (route.status === "eligible" && charge && before && after) {
      const summary = node("div", "supplemental-route-summary");
      summary.appendChild(text("strong", `${charge}をチャージ`));
      summary.appendChild(
        text("span", `残高 ${before} → ${after}（チャージ後）`),
      );
      if (rewardPoints !== null)
        summary.appendChild(
          text("span", `nanacoポイント ${rewardPoints}ポイント`),
        );
      card.appendChild(summary);
      card.appendChild(
        text(
          "p",
          "チャージで得られる情報です。今回の支払い方法の比較・順位には含めていません。",
          "supplemental-route-note",
        ),
      );
    } else if (
      route.status === "no_valid_plan" ||
      route.issues?.includes("route_input_invalid")
    ) {
      card.appendChild(
        text(
          "p",
          "クレジットチャージは5,000円以上・1,000円単位です。セブンカード・プラスの所有とnanacoクレジットチャージの事前登録が必要で、チャージ後残高は50,000円までです。",
          "supplemental-route-requirements",
        ),
      );
    } else {
      card.appendChild(
        text(
          "p",
          "チャージ情報を現在確認できません。今回の支払い方法の比較には含めていません。",
          "supplemental-route-requirements",
        ),
      );
    }
    appendSupplementalRouteCorrection(card, route);
    parent.appendChild(card);
  };

  const renderSupplementalRoutes = (parent, routes) => {
    if (!Array.isArray(routes) || routes.length === 0) return;
    const section = node("section", "supplemental-route-section");
    section.setAttribute("aria-labelledby", "supplemental-route-title");
    section.appendChild(text("h3", "チャージ情報", "supplemental-route-title"));
    section.appendChild(
      text(
        "p",
        "チャージは支払い方法とは別の準備です。ここに表示するチャージ情報は、今回の支払い比較・順位・候補数には含めていません。",
        "supplemental-route-intro",
      ),
    );
    const list = node("div", "supplemental-route-list");
    routes.forEach((route) => {
      renderSupplementalRoute(list, route);
    });
    section.appendChild(list);
    parent.appendChild(section);
  };

  const renderUnifiedRoute = (parent, route, rank = null) => {
    if (!route || typeof route !== "object") return;
    const card = node("article", "unified-route-card");
    const header = node("div", "unified-route-header");
    header.appendChild(text("h3", String(route.label || "支払いルート")));
    if (rank === 1) {
      card.classList.add("is-winner");
      header.appendChild(text("span", "おすすめ", "route-rank-badge"));
    } else if (Number.isSafeInteger(rank)) {
      header.appendChild(text("span", `${rank}位`, "route-rank-badge"));
    } else if (route.status !== "eligible") {
      header.appendChild(
        text(
          "span",
          unifiedStatusLabels[route.status] || "状態不明",
          `route-status-badge status-${String(route.status || "unknown")}`,
        ),
      );
    }
    card.appendChild(header);

    const plan = routePlan(route);
    if (plan) {
      if (route.kind === "calculation") {
        const planBox = node("div", "unified-route-plan");
        planBox.appendChild(text("strong", planName(plan)));
        if (typeof plan.reward_points === "string") {
          const rewardLabel =
            typeof plan.reward_label === "string"
              ? plan.reward_label
              : "nanacoポイント";
          const rate =
            typeof plan.reward_rate_percent === "string"
              ? `（還元率 ${plan.reward_rate_percent}%）`
              : "";
          planBox.appendChild(
            text("span", `${rewardLabel} ${plan.reward_points}ポイント${rate}`),
          );
          const unitMatch = Array.isArray(plan.conditions)
            ? plan.conditions.join(" ").match(/(\d{1,6})円(?:単位|ごと)/u)
            : null;
          const purchaseAmount = Number(
            document.getElementById("amount-jpy")?.value,
          );
          const rewardUnit = unitMatch ? Number(unitMatch[1]) : 0;
          if (
            Number.isSafeInteger(purchaseAmount) &&
            rewardUnit > 0 &&
            purchaseAmount % rewardUnit !== 0
          )
            planBox.appendChild(
              text(
                "small",
                `あと${rewardUnit - (purchaseAmount % rewardUnit)}円で次のポイント単位です。`,
                "route-next-point",
              ),
            );
          if (typeof route.objective_score_jpy === "string")
            planBox.appendChild(
              text(
                "b",
                `${route.objective_score_jpy}円相当`,
                "route-objective-score",
              ),
            );
        } else {
          const score = plan.objective_score_jpy
            ? `${plan.objective_score_jpy} 円相当`
            : "金額換算なし";
          planBox.appendChild(text("span", score));
        }
        card.appendChild(planBox);
      } else {
        const planBox = node("div", "unified-route-plan");
        const reward =
          typeof plan.reward_points === "string" ? plan.reward_points : "0";
        planBox.appendChild(text("strong", `nanacoポイント ${reward}ポイント`));
        planBox.appendChild(
          text("span", "登録済みの条件で計算しています。金額換算はしません。"),
        );
        card.appendChild(planBox);
      }
      if (Array.isArray(plan.conditions) && plan.conditions.length)
        appendList(card, "このルートの条件", plan.conditions);
      if (
        route.automatic_application === true &&
        route.calculation_source === "agent_feed_structured"
      ) {
        const provenance = node("div", "route-calculation-source");
        provenance.appendChild(
          text("span", "公式情報を自動で計算に反映しています。"),
        );
        const sourceLink = officialSourceLink(
          route.source_url,
          route.checked_at,
        );
        if (sourceLink) provenance.appendChild(sourceLink);
        card.appendChild(provenance);
      }
    } else if (route.status === "no_valid_plan") {
      card.appendChild(
        text("p", "現在の条件では有効な計画がありません。", "route-empty"),
      );
    }

    if (Array.isArray(route.issues) && route.issues.length) {
      const issueSection = node("div", "route-issues");
      route.issues.forEach((issue) => {
        issueSection.appendChild(
          text(
            "p",
            unifiedIssueLabels[issue] || "このルートに確認事項があります。",
          ),
        );
      });
      card.appendChild(issueSection);
    }
    if (
      typeof route.recommendation_id === "string" &&
      /^sha256:[0-9a-f]{64}$/u.test(route.recommendation_id)
    ) {
      const actions = node("div", "route-actions");
      const correction = node("button", "secondary");
      correction.type = "button";
      correction.textContent = "情報の誤りを報告";
      correction.addEventListener("click", () => {
        const routeLabel = String(route.label || "");
        const searchValue = routeLabel
          .replace(/^(?:通常のお買い物|セブン‐イレブン)・/u, "")
          .split("→")[0]
          .replace("購入", "")
          .trim();
        const search = document.getElementById("information-search");
        search.value = searchValue;
        document.getElementById("information-family-filter").value = "";
        activateTab("information");
      });
      actions.appendChild(correction);
      card.appendChild(actions);
    }
    parent.appendChild(card);
  };

  const recordUnifiedHistory = (routes) => {
    const shown = routes.filter(
      (route) =>
        route &&
        (route.status === "eligible" || route.status === "conditional"),
    );
    if (!shown.length) return;
    const history = document.getElementById("session-history");
    if (sessionHistoryCount === 0) clear(history);
    const item = node("div", "history-item");
    const marker = node("span", "history-icon");
    marker.appendChild(icon("slip"));
    item.appendChild(marker);
    const copy = node("div");
    copy.appendChild(text("strong", String(shown[0].label || "比較ルート")));
    copy.appendChild(
      text("small", `${shown.length}ルートを比較 · このセッション`),
    );
    item.appendChild(copy);
    item.appendChild(text("em", `${shown.length}候補`));
    history.insertBefore(item, history.firstChild);
    sessionHistoryCount += 1;
    document.getElementById("history-count").textContent =
      String(sessionHistoryCount);
    while (history.children.length > 10) history.lastElementChild.remove();
  };

  const renderUnifiedRecommendation = (body) => {
    if (body?.version !== "unified-recommendations.v2")
      throw new Error("recommendation_version_invalid");
    if (
      !Array.isArray(body.selected_p0_products) ||
      body.selected_p0_products.some(
        (familyId) =>
          typeof familyId !== "string" ||
          !pointSpendOptions?.walletCatalogue.some(
            (item) => item.family_id === familyId,
          ),
      )
    )
      throw new Error("selected_p0_products_invalid");
    const routes = Array.isArray(body?.routes) ? body.routes : [];
    if (!routes.length) throw new Error("routes_invalid");
    const comparison =
      body?.comparison && typeof body.comparison === "object"
        ? body.comparison
        : null;
    const winner = comparison?.winner;
    const runnerUp = comparison?.runner_up;
    const result = document.getElementById("result");
    clear(result);
    const hero = node("div", "result-hero");
    hero.appendChild(
      text("p", winner ? "今回のおすすめ" : "比較結果", "status"),
    );
    const title = text(
      "h2",
      winner?.label || "支払いルートをまとめて確認しました",
    );
    title.id = "result-title";
    hero.appendChild(title);
    if (winner?.objective_score_jpy)
      hero.appendChild(
        text(
          "p",
          `${winner.objective_score_jpy}円相当`,
          "winner-objective-score",
        ),
      );
    if (runnerUp?.label && comparison?.delta_jpy !== null)
      hero.appendChild(
        text(
          "p",
          `次点の「${runnerUp.label}」より${comparison.delta_jpy}円相当お得です。`,
          "result-summary",
        ),
      );
    const selectedProducts = body.selected_p0_products.map(
      (familyId) =>
        pointSpendOptions.walletCatalogue.find(
          (item) => item.family_id === familyId,
        )?.label || familyId,
    );
    if (selectedProducts.length)
      hero.appendChild(
        text(
          "p",
          `選択中：${selectedProducts.join("、")}`,
          "selected-products-summary",
        ),
      );
    if (!reducedMotion()) hero.classList.add("is-revealing");
    result.appendChild(hero);
    const intro = node("p", "", "unified-disclosure");
    intro.textContent =
      comparison?.valuation_policy?.note ||
      "通常ポイントを1ポイント=1円として比較しています。";
    result.appendChild(intro);
    const breakEven = comparison?.break_even;
    if (breakEven?.break_even_jpy_per_unit) {
      const reversingRoute = routes.find(
        (route) => route.route_id === breakEven.winner_above_threshold_route_id,
      );
      if (reversingRoute)
        result.appendChild(
          text(
            "p",
            `${reversingRoute.label}のポイントを1ポイント${breakEven.break_even_jpy_per_unit}円より高く見積もる場合は、順位が逆転します。`,
            "break-even-note",
          ),
        );
    }
    const list = node("div", "unified-route-list");
    routes.forEach((route) => {
      const ranked = comparison?.ranked_routes?.find(
        (item) => item.route_id === route.route_id,
      );
      renderUnifiedRoute(list, route, ranked?.rank || null);
    });
    stagger(list.children);
    result.appendChild(list);
    renderSupplementalRoutes(
      result,
      Array.isArray(body?.supplemental_routes) ? body.supplemental_routes : [],
    );
    recordUnifiedHistory(routes);
    const shownRoutes = routes.filter(
      (route) => route.status === "eligible" || route.status === "conditional",
    );
    document.getElementById("wallet-route-summary").textContent =
      shownRoutes.length
        ? `${shownRoutes.length}ルートを今回比較中：${shownRoutes
            .slice(0, 3)
            .map((route) => String(route.label || "支払いルート"))
            .join("、")}`
        : "今回の条件で有効な統合ルートはありません";
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const experimentalCategoryLabels = Object.freeze({
    not_accepted: "利用できなかった",
    reward_missing: "特典が付かなかった",
    rate_wrong: "還元率が違う",
    campaign_ended: "キャンペーンが終了していた",
    registration_required: "登録が必要だった",
    cap_or_minimum_missing: "上限・最低条件が違う",
    merchant_wrong: "お店が違う",
    product_variant_wrong: "商品区分が違う",
  });

  const experimentalKindLabels = Object.freeze({
    reward_rate: "還元率",
    campaign: "キャンペーン",
    transfer: "移行・交換",
    payment_acceptance: "支払い方法",
    other: "その他",
  });

  const experimentalConfidenceLabels = Object.freeze({
    high: "高",
    medium: "中",
    limited: "参考",
  });

  const formatExperimentalDate = (value) => {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
      return "確認日不明";
    return new Date(value).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const classifyExperimentalValidity = (
    validFrom,
    validTo,
    effectiveAt = new Date(),
  ) => {
    if (typeof validFrom !== "string") return "unknown";
    const from = Date.parse(validFrom);
    const to =
      validTo === null || validTo === undefined
        ? Number.POSITIVE_INFINITY
        : Date.parse(validTo);
    const at =
      effectiveAt instanceof Date
        ? effectiveAt.getTime()
        : Date.parse(effectiveAt);
    if (!Number.isFinite(from) || !Number.isFinite(at) || from >= to)
      return "unknown";
    if (at < from) return "scheduled";
    if (at >= to) return "expired";
    return "active";
  };

  const experimentalValidityLabels = Object.freeze({
    active: "状態：有効",
    scheduled: "状態：開始前",
    expired: "状態：終了",
    unknown: "状態：不明",
  });

  const experimentalRulesMessage = (message, className = "helper") => {
    const list = document.getElementById("experimental-rules");
    clear(list);
    list.appendChild(text("p", message, className));
  };

  const renderNanacoExperimentalInteraction = (card, publicationId) => {
    if (publicationId !== "candidate_p0_nanaco_shopping_earning_20260821_v0_1")
      return;
    const section = node("section", "nanaco-experimental");
    section.appendChild(text("h4", "nanacoルートを確認する"));
    section.appendChild(
      text(
        "p",
        "総額・税抜対象額・残高を明示して、セブン‐イレブンのnanaco利用で付くポイントだけを確認します。",
        "nanaco-experimental-copy",
      ),
    );
    const form = node("form", "nanaco-experimental-form");
    const field = (labelText, value, max) => {
      const label = node("label");
      label.appendChild(text("span", labelText));
      const input = node("input");
      input.type = "number";
      input.min = "0";
      input.max = String(max);
      input.step = "1";
      input.value = String(value);
      input.required = true;
      label.appendChild(input);
      form.appendChild(label);
      return input;
    };
    const gross = field(
      "総額（円）",
      Number(document.getElementById("amount-jpy")?.value) || 640,
      1_000_000,
    );
    const taxExclusive = field(
      "税抜対象額（円・明示入力）",
      gross.value,
      1_000_000,
    );
    const balance = field("nanaco残高（円）", 10_000, 10_000_000);
    const submit = node("button", "secondary");
    submit.type = "submit";
    submit.textContent = "ポイントを計算する";
    form.appendChild(submit);
    const output = text("p", "", "nanaco-experimental-output");
    form.appendChild(output);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      output.classList.remove("is-error");
      output.textContent = "ポイントを計算しています…";
      try {
        const body = await postJson("/api/experimental/recommendation", {
          selection_id: publicationId,
          amount_jpy: Number(gross.value),
          tax_exclusive_amount_jpy: Number(taxExclusive.value),
          nanaco_balance_jpy: Number(balance.value),
          effective_at: new Date().toISOString(),
        });
        const recommendation = body?.recommendation;
        if (
          !recommendation ||
          recommendation.verification_status !== "experimental_unverified"
        )
          throw new Error("response_invalid");
        if (recommendation.outcome === "no_valid_plan") {
          output.textContent = "現在の条件では有効な計画がありません。";
        } else {
          const winner = recommendation.winner;
          output.textContent = `nanacoポイント ${winner?.reward_points || "0"}ポイント。金額換算は表示しません。`;
        }
      } catch {
        output.classList.add("is-error");
        output.textContent =
          "ルートを確認できませんでした。現在の情報が有効か確認してください。";
      } finally {
        submit.disabled = false;
      }
    });
    section.appendChild(form);
    card.appendChild(section);
  };

  const renderNanacoCreditChargeInteraction = (card, publicationId) => {
    if (
      publicationId !==
      "candidate_p0_nanaco_sevencard_credit_charge_20260822_v0_1"
    )
      return;
    const section = node("section", "nanaco-experimental");
    section.appendChild(text("h4", "セブンカード・プラスでnanacoにチャージ"));
    section.appendChild(
      text(
        "p",
        "所有と事前登録を確認し、チャージ額と現在の残高を入力します。ポイントの円換算は行いません。",
        "nanaco-experimental-copy",
      ),
    );
    const form = node("form", "nanaco-experimental-form");
    const field = (labelText, value, max) => {
      const label = node("label");
      label.appendChild(text("span", labelText));
      const input = node("input");
      input.type = "number";
      input.min = "0";
      input.max = String(max);
      input.step = "1";
      input.value = String(value);
      input.required = true;
      label.appendChild(input);
      form.appendChild(label);
      return input;
    };
    const charge = field("チャージ額（円）", 5_000, 30_000);
    const balance = field("現在のnanaco残高（円）", 0, 50_000);
    const ownership = node("label");
    const ownershipInput = node("input");
    ownershipInput.type = "checkbox";
    ownership.appendChild(ownershipInput);
    ownership.appendChild(text("span", "セブンカード・プラスを所有しています"));
    form.appendChild(ownership);
    const preregistration = node("label");
    const preregistrationInput = node("input");
    preregistrationInput.type = "checkbox";
    preregistration.appendChild(preregistrationInput);
    preregistration.appendChild(
      text("span", "nanacoクレジットチャージを事前登録しています"),
    );
    form.appendChild(preregistration);
    const submit = node("button", "secondary");
    submit.type = "submit";
    submit.textContent = "チャージ条件を確認する";
    form.appendChild(submit);
    const output = text("p", "", "nanaco-experimental-output");
    form.appendChild(output);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      output.classList.remove("is-error");
      output.textContent = "チャージ条件を確認しています…";
      try {
        const body = await postJson("/api/experimental/nanaco-credit-charge", {
          selection_id: publicationId,
          charge_amount_jpy: Number(charge.value),
          nanaco_balance_jpy: Number(balance.value),
          seven_card_plus_owned: ownershipInput.checked,
          nanaco_credit_charge_preregistered: preregistrationInput.checked,
          effective_at: new Date().toISOString(),
        });
        const recommendation = body?.recommendation;
        if (
          !recommendation ||
          recommendation.verification_status !== "experimental_unverified"
        )
          throw new Error("response_invalid");
        if (recommendation.outcome === "no_valid_plan") {
          output.textContent = "現在の条件では有効な計画がありません。";
        } else {
          const winner = recommendation.winner;
          output.textContent = `チャージ後残高 ¥${recommendation.nanaco_balance_after_jpy.toLocaleString("ja-JP")}, nanacoポイント ${winner?.reward_points || "0"}ポイント。金額換算は表示しません。`;
        }
      } catch {
        output.classList.add("is-error");
        output.textContent =
          "ルートを確認できませんでした。チャージ条件と現在の情報が有効か確認してください。";
      } finally {
        submit.disabled = false;
      }
    });
    section.appendChild(form);
    card.appendChild(section);
  };

  const appendCatalogueRuleMeta = (card, rule, groupedCount = 1) => {
    const meta = node("div", "experimental-card-meta");
    meta.appendChild(
      text("span", `種類：${experimentalKindLabels[rule.kind] || "その他"}`),
    );
    if (groupedCount > 1)
      meta.appendChild(text("span", `収録：${groupedCount}種類`));
    meta.appendChild(
      text(
        "span",
        `確度：${experimentalConfidenceLabels[rule.confidence] || "参考"}`,
      ),
    );
    meta.appendChild(
      text(
        "span",
        `確認元：${typeof rule.source_label === "string" ? rule.source_label : "情報提供元"}`,
      ),
    );
    const sourceLink = officialSourceLink(rule.source_url, rule.checked_at);
    if (sourceLink) meta.appendChild(sourceLink);
    meta.appendChild(
      text("span", `更新日：${formatExperimentalDate(rule.checked_at)}`),
    );
    meta.appendChild(
      text("span", `有効開始：${formatExperimentalDate(rule.valid_from)}`),
    );
    meta.appendChild(
      text(
        "span",
        rule.valid_to
          ? `有効終了：${formatExperimentalDate(rule.valid_to)}`
          : "有効終了：継続中",
      ),
    );
    const validityState = [
      "active",
      "scheduled",
      "expired",
      "unknown",
    ].includes(rule.validity_state)
      ? rule.validity_state
      : classifyExperimentalValidity(rule.valid_from, rule.valid_to);
    meta.appendChild(
      text(
        "span",
        experimentalValidityLabels[validityState] ||
          experimentalValidityLabels.unknown,
        `experimental-validity validity-${validityState}`,
      ),
    );
    card.appendChild(meta);
  };

  const catalogueCorrectionControls = (
    card,
    publicationOptions,
    onAccepted,
  ) => {
    const actions = node("div", "experimental-card-actions");
    let publicationSelect;
    if (publicationOptions.length > 1) {
      const publicationLabel = node("label");
      publicationLabel.appendChild(text("span", "報告する支払い方法"));
      publicationSelect = selectField(publicationOptions);
      publicationLabel.appendChild(publicationSelect);
      actions.appendChild(publicationLabel);
    }
    const categoryLabel = node("label");
    categoryLabel.appendChild(text("span", "誤っている内容"));
    const categorySelect = selectField(
      Object.entries(experimentalCategoryLabels).map(([value, labelText]) => ({
        value,
        label: labelText,
      })),
    );
    categoryLabel.appendChild(categorySelect);
    actions.appendChild(categoryLabel);
    const button = node("button", "secondary");
    button.type = "button";
    button.textContent = "誤りを報告する";
    actions.appendChild(button);
    card.appendChild(actions);
    const status = text("p", "", "experimental-status");
    card.appendChild(status);

    button.addEventListener("click", async () => {
      const publicationId =
        publicationSelect?.value || publicationOptions[0]?.value || "";
      if (!publicationId) return;
      button.disabled = true;
      categorySelect.disabled = true;
      if (publicationSelect) publicationSelect.disabled = true;
      status.classList.remove("is-error");
      status.textContent = "報告を受け付けています…";
      try {
        const body = await postJson("/api/experimental/corrections", {
          publication_id: publicationId,
          category: categorySelect.value,
        });
        if (body?.correction?.accepted !== true) throw new Error("status");
        onAccepted(publicationId);
        status.textContent = "報告を受け付けました。ありがとうございます。";
        if (card.isConnected) {
          button.disabled = false;
          categorySelect.disabled = false;
          if (publicationSelect) publicationSelect.disabled = false;
        }
      } catch {
        button.disabled = false;
        categorySelect.disabled = false;
        if (publicationSelect) publicationSelect.disabled = false;
        status.classList.add("is-error");
        status.textContent = "報告を送れませんでした。もう一度お試しください。";
      }
    });
  };

  const paymentAcceptanceLabel = (rule) => {
    if (typeof rule.summary !== "string") return "支払い方法";
    const match = rule.summary.match(/「([^」]{1,80})」/u);
    return match?.[1] || rule.summary;
  };

  const renderGroupedPaymentAcceptance = (list, rules) => {
    if (rules.length === 0) return;
    const first = rules[0];
    const card = node("article", "experimental-card");
    const header = node("div", "experimental-card-header");
    header.appendChild(
      text(
        "h3",
        typeof first.title === "string" ? first.title : "利用できる支払い方法",
      ),
    );
    card.appendChild(header);
    card.appendChild(
      text(
        "p",
        "利用できる支払い方法を一つのカードにまとめています。",
        "experimental-card-claim",
      ),
    );
    const methods = node("ul", "catalogue-route-options");
    rules.forEach((rule) => {
      const item = node("li");
      item.dataset.publicationId = rule.publication_id;
      item.appendChild(text("span", paymentAcceptanceLabel(rule)));
      methods.appendChild(item);
    });
    card.appendChild(methods);
    appendCatalogueRuleMeta(card, first, rules.length);
    const publicationOptions = rules.map((rule) => ({
      value: rule.publication_id,
      label: paymentAcceptanceLabel(rule),
    }));
    catalogueCorrectionControls(card, publicationOptions, (publicationId) => {
      [...methods.children]
        .find((item) => item.dataset.publicationId === publicationId)
        ?.remove();
      const option = [...publicationOptions].find(
        (candidate) => candidate.value === publicationId,
      );
      const select = card.querySelector(".experimental-card-actions select");
      [...(select?.options || [])]
        .find((candidate) => candidate.value === option?.value)
        ?.remove();
      if (!methods.children.length) card.remove();
    });
    list.appendChild(card);
  };

  const renderCatalogueRule = (list, rule) => {
    const publicationId = rule.publication_id;
    const card = node("article", "experimental-card");
    const header = node("div", "experimental-card-header");
    header.appendChild(
      text("h3", typeof rule.title === "string" ? rule.title : "ルート情報"),
    );
    card.appendChild(header);
    card.appendChild(
      text(
        "p",
        typeof rule.summary === "string" ? rule.summary : "ルート情報です。",
        "experimental-card-claim",
      ),
    );
    appendCatalogueRuleMeta(card, rule);
    renderNanacoExperimentalInteraction(card, publicationId);
    renderNanacoCreditChargeInteraction(card, publicationId);
    catalogueCorrectionControls(
      card,
      [{ value: publicationId, label: rule.title || "ルート情報" }],
      () => card.remove(),
    );
    list.appendChild(card);
  };

  const _renderExperimentalSnapshot = (snapshot) => {
    const list = document.getElementById("experimental-rules");
    clear(list);
    const rules =
      snapshot && Array.isArray(snapshot.rules)
        ? snapshot.rules.filter(
            (rule) =>
              rule &&
              typeof rule === "object" &&
              typeof rule.publication_id === "string" &&
              rule.publication_id.length > 0,
          )
        : [];
    const partial = snapshot?.status === "partial";
    if (rules.length === 0) {
      list.appendChild(
        text(
          "p",
          partial
            ? "一部のルート情報を読み込めませんでした。"
            : "現在、表示できるルート情報はありません。",
          "helper",
        ),
      );
      return;
    }
    if (partial)
      list.appendChild(
        text("p", "読み込めたルート情報を表示しています。", "helper"),
      );
    const paymentAcceptance = rules.filter(
      (rule) => rule.kind === "payment_acceptance",
    );
    renderGroupedPaymentAcceptance(list, paymentAcceptance);
    rules
      .filter((rule) => rule.kind !== "payment_acceptance")
      .forEach((rule) => {
        renderCatalogueRule(list, rule);
      });
    if (!list.querySelector(".experimental-card"))
      experimentalRulesMessage(
        "現在、表示できるルート情報はありません。",
        "helper",
      );
  };

  const safeCatalogueRules = (snapshot) => {
    if (!snapshot || !Array.isArray(snapshot.rules)) return [];
    return snapshot.rules.filter(
      (rule) =>
        rule &&
        typeof rule === "object" &&
        typeof rule.publication_id === "string" &&
        rule.publication_id.length > 0 &&
        typeof rule.title === "string" &&
        typeof rule.summary === "string" &&
        typeof rule.kind === "string",
    );
  };

  const loadExperimentalRules = async (force = false) => {
    if (catalogueRulesLoaded && !force) return;
    try {
      const response = await fetch("/api/experimental/rules", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = await response.json();
      if (!response.ok) throw new Error("request_failed");
      catalogueRules = safeCatalogueRules(body);
      catalogueRulesLoaded = true;
      appendInformationFilterOptions();
      renderInformationFacts();
    } catch {
      catalogueRules = [];
      catalogueRulesLoaded = false;
      renderInformationFacts();
    }
  };

  const informationCategoryLabels = Object.freeze({
    fact_incorrect: "内容が違う",
    fact_outdated: "情報が古い",
    source_unavailable: "確認できない",
    scope_incorrect: "対象範囲が違う",
    other: "その他",
  });

  const informationMessage = (message, className = "helper") => {
    const list = document.getElementById("information-facts");
    clear(list);
    list.appendChild(text("p", message, className));
  };

  const safeInformationFacts = (value) => {
    if (!value || typeof value !== "object" || !Array.isArray(value.facts))
      return [];
    return value.facts.filter(
      (fact) =>
        fact &&
        typeof fact === "object" &&
        typeof fact.fact_key === "string" &&
        typeof fact.family_id === "string" &&
        /^(?:point|wallet|card|emoney|storedvalue|merchant|reg|transit)\.[A-Za-z0-9._:-]{1,127}$/u.test(
          fact.family_id,
        ) &&
        typeof fact.claim_type === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(fact.claim_type) &&
        typeof fact.family === "string" &&
        typeof fact.claim === "string" &&
        typeof fact.subject === "string" &&
        typeof fact.predicate === "string" &&
        typeof fact.summary === "string" &&
        typeof fact.use_in_comparison === "boolean",
    );
  };

  const safeConsumerReference = (value) => {
    if (
      !value ||
      typeof value !== "object" ||
      value.version !== "consumer-reference.v1" ||
      value.automatic_application !== true ||
      value.manual_promotion_required !== false ||
      (value.status !== "ready" && value.status !== "partial") ||
      !value.coverage ||
      typeof value.coverage !== "object" ||
      !Number.isInteger(value.coverage.wallet_program_count) ||
      !Number.isInteger(value.coverage.merchant_count) ||
      !Number.isInteger(value.coverage.fact_count) ||
      !Array.isArray(value.wallet_programs) ||
      !Array.isArray(value.merchants)
    )
      return null;
    const validStates = new Set(["active", "scheduled", "expired", "unknown"]);
    const nullableString = (field) =>
      field === null || typeof field === "string";
    const groups = (items, prefix) =>
      items
        .filter(
          (group) =>
            group &&
            typeof group === "object" &&
            typeof group.family_id === "string" &&
            group.family_id.startsWith(prefix) &&
            typeof group.label === "string" &&
            Array.isArray(group.facts),
        )
        .slice(0, 64)
        .map((group) => ({
          family_id: group.family_id,
          label: group.label,
          facts: group.facts
            .filter(
              (fact) =>
                fact &&
                typeof fact === "object" &&
                typeof fact.fact_key === "string" &&
                typeof fact.claim_type === "string" &&
                typeof fact.claim === "string" &&
                typeof fact.subject === "string" &&
                typeof fact.predicate === "string" &&
                typeof fact.summary === "string" &&
                nullableString(fact.source_url) &&
                nullableString(fact.checked_at) &&
                nullableString(fact.effective_from) &&
                nullableString(fact.effective_to) &&
                [
                  "wallet_validity",
                  "wallet_redemption",
                  "merchant_eligibility",
                  "campaign_condition",
                ].includes(fact.logic_role) &&
                validStates.has(fact.validity_state),
            )
            .slice(0, 64),
        }));
    return {
      version: value.version,
      status: value.status,
      automatic_application: true,
      manual_promotion_required: false,
      coverage: {
        wallet_program_count: value.coverage.wallet_program_count,
        merchant_count: value.coverage.merchant_count,
        fact_count: value.coverage.fact_count,
      },
      wallet_programs: groups(value.wallet_programs, "point."),
      merchants: groups(value.merchants, "merchant."),
    };
  };

  const loadConsumerReference = async () => {
    try {
      const response = await fetch("/api/consumer/reference", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = await response.json();
      if (!response.ok) throw new Error("request_failed");
      consumerReference = safeConsumerReference(body);
      if (!consumerReference) throw new Error("response_invalid");
      populateMerchantSelector();
      renderLotList();
    } catch {
      consumerReference = null;
    }
  };

  const populateMerchantSelector = () => {
    const select = document.getElementById("merchant-selector");
    if (!select || !consumerReference) return;
    const previous = select.value;
    const options = [
      { value: "merchant.synthetic", label: "一般のお買い物" },
      ...consumerReference.merchants.map((group) => ({
        value:
          group.family_id === "merchant.7eleven"
            ? "merchant.seveneleven"
            : group.family_id,
        label: group.label,
      })),
    ];
    clear(select);
    const seen = new Set();
    options.forEach((option) => {
      if (seen.has(option.value)) return;
      seen.add(option.value);
      const element = node("option");
      element.value = option.value;
      element.textContent = option.label;
      select.appendChild(element);
    });
    select.value = seen.has(previous) ? previous : "merchant.synthetic";
    select.dispatchEvent(new Event("change"));
  };

  const appendInformationFilterOptions = () => {
    const family = document.getElementById("information-family-filter");
    const previousFamily = family.value;
    clear(family);
    const allFamily = node("option");
    allFamily.value = "";
    allFamily.textContent = "すべて";
    family.appendChild(allFamily);
    allCatalogueFamilies()
      .sort((left, right) => left.localeCompare(right, "ja"))
      .forEach((value) => {
        const option = node("option");
        option.value = value;
        option.textContent = value;
        family.appendChild(option);
      });
    family.value = [...family.options].some(
      (option) => option.value === previousFamily,
    )
      ? previousFamily
      : "";
  };

  const catalogueRuleFamily = (rule) => {
    if (rule.publication_id.includes("nanaco_shopping_earning"))
      return "nanacoポイント";
    if (rule.publication_id.includes("nanaco_sevencard_credit_charge"))
      return "nanaco電子マネー";
    if (
      rule.publication_id.includes("seveneleven") ||
      rule.title.includes("セブン‐イレブン")
    )
      return "セブン‐イレブン";
    return rule.title;
  };

  const hiddenCatalogueFamilies = new Set([
    "金融庁（決済）",
    "個人情報保護委員会",
    "消費者庁（広告）",
  ]);

  function allCatalogueFamilies() {
    return catalogueGroups()
      .filter(
        (group) =>
          catalogueRates(group).length > 0 || group.campaigns.length > 0,
      )
      .map((group) => group.family);
  }

  const catalogueGroups = () => {
    const groups = new Map();
    const factFingerprints = new Map();
    const groupFor = (family) => {
      if (!groups.has(family))
        groups.set(family, {
          family,
          facts: [],
          rules: [],
          campaigns: [],
        });
      return groups.get(family);
    };
    informationFacts.forEach((fact) => {
      if (hiddenCatalogueFamilies.has(fact.family)) return;
      if (!factFingerprints.has(fact.family))
        factFingerprints.set(fact.family, new Set());
      const fingerprint = `${fact.claim}\u0000${fact.subject}\u0000${fact.summary}`;
      if (factFingerprints.get(fact.family).has(fingerprint)) return;
      factFingerprints.get(fact.family).add(fingerprint);
      groupFor(fact.family).facts.push(fact);
    });
    catalogueRules.forEach((rule) => {
      groupFor(catalogueRuleFamily(rule)).rules.push(rule);
    });
    campaignLinks.forEach((item) => {
      groupFor(item.family).campaigns.push(item);
    });
    return [...groups.values()].sort((left, right) =>
      left.family.localeCompare(right.family, "ja"),
    );
  };

  const groupMatchesSearch = (group, search) => {
    if (!search) return true;
    return [
      group.family,
      ...group.facts.flatMap((fact) => [
        fact.claim,
        fact.subject,
        fact.summary,
      ]),
      ...group.rules.flatMap((rule) => [rule.title, rule.summary]),
      ...group.campaigns.flatMap((item) => [item.title, item.period_label]),
    ].some((value) =>
      String(value).toLocaleLowerCase("ja-JP").includes(search),
    );
  };

  function officialSourceLink(sourceUrl) {
    if (typeof sourceUrl !== "string") return null;
    try {
      const url = new URL(sourceUrl);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.hash
      )
        return null;
      const wrapper = node("span", "service-provenance");
      const link = node("a", "service-official-link");
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "公式HP";
      wrapper.appendChild(link);
      return wrapper;
    } catch {
      return null;
    }
  }

  const appendCampaignSection = (card, campaigns) => {
    if (!campaigns.length) return;
    const section = node("section", "service-campaign-section");
    section.appendChild(text("h4", "実施中のキャンペーン"));
    const list = node("div", "service-campaign-list");
    campaigns.forEach((item) => {
      const campaign = node("article", "service-campaign-item");
      const copy = node("div");
      copy.appendChild(text("strong", item.title));
      copy.appendChild(text("span", item.period_label));
      campaign.appendChild(copy);
      const link = node("a", "service-official-link");
      link.href = item.official_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "公式HP";
      campaign.appendChild(link);
      list.appendChild(campaign);
    });
    section.appendChild(list);
    card.appendChild(section);
  };

  const japaneseNumber = (value) => {
    const digits = Object.freeze({
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    });
    if (!value.includes("十")) return digits[value] || value;
    const [tens, ones] = value.split("十");
    return (digits[tens] || 1) * 10 + (digits[ones] || 0);
  };

  const compactRateValue = (summary) => {
    const sentences = String(summary)
      .split(/[。\n]/u)
      .map((value) => value.trim())
      .filter(Boolean);
    const patterns = [
      /(?:税込|税抜)?\s*(?:[¥￥]\s*)?[0-9][0-9,]*(?:\.[0-9]+)?円?(?:ごと|につき)(?:に)?[^。]{0,32}?[0-9][0-9,]*(?:\.[0-9]+)?(?:ポイント|pt)/iu,
      /[0-9][0-9,]*(?:\.[0-9]+)?(?:ポイント|pt)\s*(?:=|＝|は)\s*[0-9][0-9,]*(?:\.[0-9]+)?円/iu,
      /[0-9]+(?:\.[0-9]+)?\s*%/u,
    ];
    for (const sentence of sentences) {
      const normalized = sentence.replace(
        /([一二三四五六七八九十]+)(?=\s*[^\s。、]{0,16}(?:POINT|ポイント))/giu,
        (value) => String(japaneseNumber(value)),
      );
      for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match)
          return match[0]
            .replace(/[¥￥]\s*([0-9][0-9,]*(?:\.[0-9]+)?)/u, "$1円")
            .replace(/\s+/gu, " ")
            .trim();
      }
    }
    return null;
  };

  const catalogueRates = (group) => {
    const candidates = [
      ...group.rules
        .filter((rule) => rule.kind === "reward_rate")
        .map((rule) => ({
          label: rule.title,
          summary: rule.summary,
          source_url: rule.source_url,
        })),
      ...group.facts
        .filter((fact) => fact.claim_type === "earn_rule")
        .map((fact) => ({
          label: fact.subject,
          summary: fact.summary,
          source_url: fact.source_url,
        })),
    ];
    const seen = new Set();
    const rates = [];
    candidates.forEach((candidate) => {
      const value = compactRateValue(candidate.summary);
      const fingerprint = `${candidate.label}\u0000${value}`;
      if (!value || seen.has(fingerprint)) return;
      seen.add(fingerprint);
      rates.push({
        label: candidate.label,
        value,
        source_url: candidate.source_url,
      });
    });
    return rates.slice(0, 4);
  };

  const appendRateSection = (card, rates) => {
    if (!rates.length) return;
    const section = node("section", "service-rate-section");
    const list = node("div", "service-rate-list");
    rates.forEach((rate) => {
      const item = node("div", "service-rate-item");
      const copy = node("span");
      copy.appendChild(text("strong", "レート"));
      copy.appendChild(text("span", rate.value));
      if (rate.label) copy.appendChild(text("small", rate.label));
      item.appendChild(copy);
      const provenance = officialSourceLink(rate.source_url);
      if (provenance) item.appendChild(provenance);
      list.appendChild(item);
    });
    section.appendChild(list);
    card.appendChild(section);
  };

  const appendServiceReportControls = (card, facts) => {
    if (!facts.length) return;
    const details = node("details", "service-report-details");
    details.appendChild(text("summary", "情報の誤りを報告"));
    const actions = node("div", "information-card-actions");
    const factLabel = node("label");
    factLabel.appendChild(text("span", "該当する情報"));
    const factSelect = selectField(
      facts.map((fact) => ({
        value: fact.fact_key,
        label: `${fact.claim}・${fact.subject}`,
      })),
    );
    factLabel.appendChild(factSelect);
    actions.appendChild(factLabel);
    const categoryLabel = node("label");
    categoryLabel.appendChild(text("span", "誤っている内容"));
    const categorySelect = selectField(
      Object.entries(informationCategoryLabels).map(([value, labelText]) => ({
        value,
        label: labelText,
      })),
    );
    categoryLabel.appendChild(categorySelect);
    actions.appendChild(categoryLabel);
    const button = node("button", "secondary");
    button.type = "button";
    button.textContent = "誤りを報告する";
    actions.appendChild(button);
    const status = text("p", "", "information-status");
    actions.appendChild(status);
    button.addEventListener("click", async () => {
      button.disabled = true;
      factSelect.disabled = true;
      categorySelect.disabled = true;
      status.classList.remove("is-error");
      status.textContent = "報告を受け付けています…";
      try {
        const body = await postJson("/api/experimental/fact-corrections", {
          fact_key: factSelect.value,
          category: categorySelect.value,
        });
        if (body?.correction?.accepted !== true) throw new Error("status");
        informationFacts = informationFacts.filter(
          (candidate) => candidate.fact_key !== factSelect.value,
        );
        appendInformationFilterOptions();
        renderInformationFacts();
      } catch {
        button.disabled = false;
        factSelect.disabled = false;
        categorySelect.disabled = false;
        status.classList.add("is-error");
        status.textContent = "報告を送れませんでした。もう一度お試しください。";
      }
    });
    details.appendChild(actions);
    card.appendChild(details);
  };

  const renderInformationFacts = () => {
    const list = document.getElementById("information-facts");
    const search = document
      .getElementById("information-search")
      .value.trim()
      .toLocaleLowerCase("ja-JP");
    const family = document.getElementById("information-family-filter").value;
    const visible = catalogueGroups()
      .map((group) => ({ ...group, compactRates: catalogueRates(group) }))
      .filter(
        (group) =>
          (group.compactRates.length > 0 || group.campaigns.length > 0) &&
          (!family || group.family === family) &&
          groupMatchesSearch(group, search),
      );
    clear(list);
    if (visible.length === 0) {
      list.appendChild(
        text(
          "p",
          informationLoaded || catalogueRulesLoaded || campaignLinksLoaded
            ? "該当するサービスはありません。"
            : "サービス情報を読み込んでいます…",
          "helper",
        ),
      );
      return;
    }
    visible.forEach((group) => {
      const card = node("article", "information-card service-information-card");
      card.appendChild(text("h3", group.family, "service-information-title"));
      appendRateSection(card, group.compactRates);
      appendCampaignSection(card, group.campaigns);
      appendServiceReportControls(card, group.facts);
      list.appendChild(card);
    });
  };

  const loadInformationFacts = async (force = false) => {
    if (informationLoaded && !force) {
      renderInformationFacts();
      return;
    }
    informationMessage("情報を読み込んでいます…");
    try {
      const response = await fetch("/api/experimental/facts", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = await response.json();
      if (!response.ok) throw new Error("request_failed");
      const facts = safeInformationFacts(body);
      if (!body || (body.status !== "ready" && body.status !== "partial"))
        throw new Error("response_invalid");
      informationFacts = facts;
      informationLoaded = true;
      appendInformationFilterOptions();
      renderInformationFacts();
    } catch {
      informationLoaded = false;
      informationMessage("ポイント情報を読み込めませんでした。", "helper");
    }
  };

  const safeLotteryLinks = (body) => {
    if (
      !body ||
      body.version !== "p0-lottery-links.v1" ||
      body.calculation_use !== false ||
      !Array.isArray(body.links) ||
      body.links.length > 24
    )
      throw new Error("lottery_links_invalid");
    return body.links.map((item) => {
      if (
        !item ||
        typeof item.title !== "string" ||
        item.title.length < 1 ||
        item.title.length > 80 ||
        typeof item.family !== "string" ||
        item.family.length < 1 ||
        item.family.length > 48 ||
        !["application_or_details", "official_announcement"].includes(
          item.status,
        ) ||
        typeof item.period_label !== "string" ||
        item.period_label.length > 64 ||
        typeof item.official_url !== "string" ||
        item.official_url.length > 512
      )
        throw new Error("lottery_links_invalid");
      const officialUrl = new URL(item.official_url);
      if (
        officialUrl.protocol !== "https:" ||
        officialUrl.username ||
        officialUrl.password ||
        officialUrl.port ||
        officialUrl.hash
      )
        throw new Error("lottery_links_invalid");
      return {
        title: item.title,
        family: item.family,
        status: item.status,
        period_label: item.period_label,
        official_url: officialUrl.href,
      };
    });
  };

  const loadLotteryLinks = async (force = false) => {
    if (campaignLinksLoaded && !force) return;
    try {
      const response = await fetch("/api/experimental/lotteries", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("request_failed");
      campaignLinks = safeLotteryLinks(await response.json()).filter(
        (item) => item.status === "application_or_details",
      );
      campaignLinksLoaded = true;
      appendInformationFilterOptions();
      renderInformationFacts();
    } catch {
      campaignLinks = [];
      campaignLinksLoaded = false;
      renderInformationFacts();
    }
  };

  const postJson = async (path, payload) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) {
      const code = body?.error?.code
        ? String(body.error.code)
        : "request_failed";
      throw new Error(code.slice(0, 80));
    }
    return body;
  };

  const consumerErrorMessage = (error) => {
    const code = error instanceof Error ? error.message : "request_failed";
    const messages = {
      amount_invalid: "金額は1円以上100万円以下で入力してください。",
      p0_purchase_amount_invalid:
        "金額は1円以上100万円以下で入力してください。",
      selected_p0_card_required:
        "カードまたはモバイル決済を1つ以上選んでください。",
      p0_payment_selection_required:
        "ウォレットでカードまたはモバイル決済を選んでください。",
      route_input_invalid: "入力した条件では比較できませんでした。",
      request_failed:
        "通信できませんでした。接続を確認して、もう一度お試しください。",
    };
    return (
      messages[code] ||
      "比較結果を取得できませんでした。もう一度お試しください。"
    );
  };

  let pointSpendOptions = null;

  const safePointSpendOptions = (body) => {
    if (
      !body ||
      body.version !== "p0-point-spend-options.v2" ||
      body.experimental !== true ||
      !Number.isSafeInteger(body.rule_count) ||
      !body.coverage ||
      typeof body.coverage !== "object" ||
      !Number.isSafeInteger(body.coverage.asset_count) ||
      !Number.isSafeInteger(body.coverage.direct_pair_count) ||
      !Number.isSafeInteger(body.coverage.reachable_pair_count) ||
      !Number.isSafeInteger(body.coverage.conditional_rule_count) ||
      !Array.isArray(body.coverage.targets_by_source) ||
      !Array.isArray(body.assets) ||
      !Array.isArray(body.wallet_catalogue) ||
      !Array.isArray(body.conditional_rules) ||
      body.assets.length > 64 ||
      body.wallet_catalogue.length > 32 ||
      body.conditional_rules.length > 32
    )
      throw new Error("point_spend_options_invalid");
    const assets = body.assets.map((asset) => {
      if (
        !asset ||
        typeof asset.asset_id !== "string" ||
        !/^asset\.[a-z0-9.-]{2,80}$/u.test(asset.asset_id) ||
        typeof asset.label !== "string" ||
        asset.label.length < 1 ||
        asset.label.length > 48 ||
        typeof asset.kind !== "string"
      )
        throw new Error("point_spend_options_invalid");
      return {
        asset_id: asset.asset_id,
        label: asset.label,
        kind: asset.kind,
      };
    });
    const conditionalRules = body.conditional_rules.map((rule) => {
      if (
        !rule ||
        typeof rule.rule_id !== "string" ||
        !/^p0\.[a-z0-9.-]{2,100}$/u.test(rule.rule_id) ||
        typeof rule.label !== "string" ||
        rule.label.length > 80 ||
        typeof rule.source_asset_id !== "string" ||
        typeof rule.destination_asset_id !== "string" ||
        !Array.isArray(rule.conditions) ||
        rule.conditions.length > 8 ||
        !rule.conditions.every(
          (condition) =>
            typeof condition === "string" && condition.length <= 120,
        ) ||
        !Array.isArray(rule.prerequisite_ids) ||
        rule.prerequisite_ids.length > 8 ||
        !rule.prerequisite_ids.every(
          (id) =>
            typeof id === "string" && /^[a-z0-9][a-z0-9.-]{1,119}$/u.test(id),
        ) ||
        (rule.period_cap !== null &&
          (!rule.period_cap ||
            typeof rule.period_cap.maximum_source_units !== "string" ||
            !/^[0-9]+$/u.test(rule.period_cap.maximum_source_units) ||
            ![
              "day",
              "month",
              "year",
              "campaign_period",
              "lifetime",
              "rolling_30_day",
            ].includes(rule.period_cap.period) ||
            typeof rule.period_cap.partial_consumption !== "boolean"))
      )
        throw new Error("point_spend_options_invalid");
      return {
        rule_id: rule.rule_id,
        label: rule.label,
        source_asset_id: rule.source_asset_id,
        destination_asset_id: rule.destination_asset_id,
        conditions: [...rule.conditions],
        prerequisite_ids: [...rule.prerequisite_ids],
        period_cap:
          rule.period_cap === null
            ? null
            : {
                maximum_source_units: rule.period_cap.maximum_source_units,
                period: rule.period_cap.period,
                partial_consumption: rule.period_cap.partial_consumption,
              },
      };
    });
    const walletCatalogue = body.wallet_catalogue.map((item) => {
      if (
        !item ||
        typeof item.family_id !== "string" ||
        !/^(?:point|wallet|card|emoney|storedvalue)\.[a-z0-9._-]{1,95}$/u.test(
          item.family_id,
        ) ||
        typeof item.label !== "string" ||
        item.label.length < 1 ||
        item.label.length > 48 ||
        ![
          "point",
          "mobile_pay",
          "credit_card",
          "emoney",
          "stored_value",
        ].includes(item.kind) ||
        !Number.isSafeInteger(item.fact_count) ||
        item.fact_count < 1 ||
        !["spend_route", "information_only"].includes(item.calculation_status)
      )
        throw new Error("point_spend_options_invalid");
      return {
        family_id: item.family_id,
        label: item.label,
        kind: item.kind,
        fact_count: item.fact_count,
        calculation_status: item.calculation_status,
      };
    });
    const targetsBySource = body.coverage.targets_by_source.map((source) => {
      if (
        !source ||
        typeof source.asset_id !== "string" ||
        typeof source.label !== "string" ||
        !Array.isArray(source.targets) ||
        source.targets.length > 64 ||
        source.targets.some(
          (target) =>
            !target ||
            typeof target.asset_id !== "string" ||
            typeof target.label !== "string",
        )
      )
        throw new Error("point_spend_options_invalid");
      return {
        asset_id: source.asset_id,
        label: source.label,
        targets: source.targets.map((target) => ({
          asset_id: target.asset_id,
          label: target.label,
        })),
      };
    });
    return {
      assets,
      conditionalRules,
      walletCatalogue,
      rule_count: body.rule_count,
      coverage: {
        asset_count: body.coverage.asset_count,
        direct_pair_count: body.coverage.direct_pair_count,
        reachable_pair_count: body.coverage.reachable_pair_count,
        conditional_rule_count: body.coverage.conditional_rule_count,
        targetsBySource,
      },
    };
  };

  const renderP0WalletCatalogue = () => {};

  const updateWalletStorageStatus = (selectedCount) => {
    const status = document.getElementById("wallet-save-status");
    const reset = document.getElementById("wallet-reset-button");
    if (!status || !reset) return;
    reset.disabled = selectedCount === 0;
    if (!walletHydrated) {
      status.textContent = "選択状態を読み込んでいます…";
      return;
    }
    if (!walletStorageAvailable) {
      status.textContent =
        "このブラウザでは端末保存が使えません。選択はこのページを開いている間だけ保持されます。";
      return;
    }
    status.textContent = selectedCount
      ? `${selectedCount}サービスをこの端末に保存中。アカウント連携はありません。`
      : "選択中のサービスはありません。選んだ内容だけをこの端末に保存します。";
  };

  const renderHomeWalletSummary = () => {
    const container = document.getElementById("home-wallet-chips");
    if (!container) return;
    clear(container);
    if (!pointSpendOptions) {
      container.appendChild(
        text("p", "ウォレットを読み込んでいます…", "helper"),
      );
      return;
    }
    const selected = selectedP0Products();
    const items = selected
      .map((familyId) =>
        pointSpendOptions.walletCatalogue.find(
          (item) => item.family_id === familyId,
        ),
      )
      .filter(Boolean);
    if (!items.length) {
      container.appendChild(
        text("p", "ウォレットから支払い方法を選んでください。", "helper"),
      );
      return;
    }
    items.forEach((item) => {
      const chip = node("button", "wallet-chip is-selected");
      chip.type = "button";
      chip.dataset.walletChip = item.family_id;
      chip.setAttribute("aria-pressed", "true");
      chip.setAttribute("aria-label", `${item.label}を比較から外す`);
      chip.appendChild(paymentLogo(item.family_id));
      chip.appendChild(text("strong", item.label));
      chip.appendChild(text("span", "×", "wallet-chip-remove"));
      chip.addEventListener("click", () => {
        const input = [...document.querySelectorAll("[data-p0-product]")].find(
          (candidate) => candidate.value === item.family_id,
        );
        if (!input) return;
        input.checked = false;
        syncP0ProductPickers();
      });
      container.appendChild(chip);
    });
  };

  const p0PickerDefinitions = Object.freeze([
    {
      kind: "credit_card",
      containerId: "p0-card-picker",
      instrumentId: "p0-card-instrument",
    },
    {
      kind: "mobile_pay",
      containerId: "p0-mobile-pay-picker",
      instrumentId: "p0-mobile-pay-instrument",
    },
    {
      kind: "point",
      kinds: ["point", "emoney", "stored_value"],
      containerId: "p0-point-picker",
    },
  ]);

  const cardIssuers = Object.freeze([
    ["card.smbc", "三井住友カード"],
    ["card.aeon", "イオンカード"],
    ["card.aupay", "auフィナンシャルサービス"],
    ["card.d", "NTTドコモ"],
    ["card.paypay", "PayPayカード"],
    ["card.rakuten", "楽天カード"],
    ["card.view", "ビューカード"],
  ]);

  const cardIssuer = (item) => {
    const match = cardIssuers.find(([prefix]) =>
      item.family_id.startsWith(prefix),
    );
    return match?.[1] || item.label;
  };

  const walletItemSort = (left, right) => {
    const issuerOrder = cardIssuer(left).localeCompare(cardIssuer(right), "ja");
    return issuerOrder || left.label.localeCompare(right.label, "ja");
  };

  const selectedP0Products = (required = false) => {
    const selected = [...document.querySelectorAll("[data-p0-product]:checked")]
      .filter((input) => !input.disabled)
      .map((input) => input.value)
      .sort();
    const hasPaymentMethod = selected.some((value) => {
      const kind = pointSpendOptions?.walletCatalogue.find(
        (item) => item.family_id === value,
      )?.kind;
      return kind === "credit_card" || kind === "mobile_pay";
    });
    if (required && !hasPaymentMethod) {
      const status = document.getElementById("p0-selection-status");
      status.textContent =
        "カードまたはモバイル決済を1つ以上タップして選んでください。";
      status.classList.add("is-error");
      const homeSummary = document.getElementById("home-wallet-chips");
      if (
        document.getElementById("tab-home")?.classList.contains("is-active")
      ) {
        homeSummary?.classList.add("is-error");
        homeSummary?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        status.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      throw new Error("p0_payment_selection_required");
    }
    return selected;
  };

  const syncP0ProductPickers = () => {
    const selected = selectedP0Products();
    p0PickerDefinitions.forEach((definition) => {
      if (!definition.instrumentId) return;
      document.getElementById(definition.instrumentId).checked = selected.some(
        (value) =>
          pointSpendOptions?.walletCatalogue.find(
            (item) => item.family_id === value,
          )?.kind === definition.kind,
      );
    });
    syncInstrumentViews();
    const status = document.getElementById("p0-selection-status");
    status.classList.remove("is-error");
    const hasPaymentMethod = selected.some((value) => {
      const kind = pointSpendOptions?.walletCatalogue.find(
        (item) => item.family_id === value,
      )?.kind;
      return kind === "credit_card" || kind === "mobile_pay";
    });
    document.getElementById("compare-submit").disabled = !hasPaymentMethod;
    status.textContent = !selected.length
      ? "支払い方法をタップして選んでください。"
      : !hasPaymentMethod
        ? "ポイントに加えて、カードまたはモバイル決済も選んでください。"
        : `${selected.length}サービスを選択中。もう一度タップすると解除できます。`;
    const homeSummary = document.getElementById("home-wallet-chips");
    homeSummary?.classList.remove("is-error");
    if (walletHydrated && !suppressWalletPersistence) {
      writeStoredWalletIds(selected);
    }
    syncPaymentStackOwnedState(selected);
    renderHomeWalletSummary();
    updateWalletStorageStatus(selected.length);
  };

  const renderP0ProductPickers = () => {
    if (!pointSpendOptions) return;
    p0PickerDefinitions.forEach((definition) => {
      const container = document.getElementById(definition.containerId);
      clear(container);
      pointSpendOptions.walletCatalogue
        .filter((item) =>
          (definition.kinds || [definition.kind]).includes(item.kind),
        )
        .sort(
          definition.kind === "credit_card"
            ? walletItemSort
            : (left, right) => left.label.localeCompare(right.label, "ja"),
        )
        .forEach((item) => {
          const label = node("label", "p0-product-option");
          const checkbox = node("input");
          checkbox.type = "checkbox";
          checkbox.value = item.family_id;
          checkbox.dataset.p0Product = "true";
          checkbox.addEventListener("change", syncP0ProductPickers);
          const copy = node("span", "p0-product-identity");
          copy.appendChild(paymentLogo(item.family_id, item.label));
          const name = node("span", "p0-product-name");
          name.appendChild(text("strong", item.label));
          if (
            definition.kind === "credit_card" &&
            cardIssuer(item) !== item.label
          )
            name.appendChild(text("small", cardIssuer(item)));
          copy.appendChild(name);
          label.appendChild(checkbox);
          label.appendChild(copy);
          const tick = node("span", "p0-product-check");
          tick.appendChild(icon("check"));
          label.appendChild(tick);
          container.appendChild(label);
        });
    });
    const savedIds = new Set(readStoredWalletIds());
    document.querySelectorAll("[data-p0-product]").forEach((input) => {
      input.checked = savedIds.has(input.value);
    });
    walletHydrated = true;
    syncP0ProductPickers();
    renderPaymentStackOwned();
  };

  const pointSpendSelectOption = (asset) => {
    const option = node("option");
    option.value = asset.asset_id;
    option.textContent = asset.label;
    return option;
  };

  const renderPointSpendConditions = () => {
    const container = document.getElementById("point-spend-conditions");
    clear(container);
    if (!pointSpendOptions) return;
    const source = document.getElementById("point-spend-source").value;
    const relevant = pointSpendOptions.conditionalRules.filter(
      (rule) => rule.source_asset_id === source,
    );
    if (relevant.length === 0) return;
    container.appendChild(text("strong", "追加条件の確認"));
    relevant.forEach((rule) => {
      if (rule.conditions.length > 0 || rule.prerequisite_ids.length > 0) {
        const label = node("label", "point-spend-check");
        const checkbox = node("input");
        checkbox.type = "checkbox";
        checkbox.value = rule.rule_id;
        checkbox.dataset.pointSpendConfirmation = "true";
        const copy = node("span");
        copy.appendChild(text("b", rule.label));
        copy.appendChild(
          text(
            "small",
            rule.conditions.length > 0
              ? rule.conditions.join("・")
              : "この交換に必要なカード・会員資格を保有しています",
          ),
        );
        label.appendChild(checkbox);
        label.appendChild(copy);
        container.appendChild(label);
      }
      if (rule.period_cap) {
        const label = node("label");
        const period =
          rule.period_cap.period === "rolling_30_day"
            ? "過去30日間"
            : "対象期間";
        label.appendChild(
          text(
            "span",
            `${rule.label}：${period}にすでに利用した数量（上限 ${rule.period_cap.maximum_source_units}）`,
          ),
        );
        const input = node("input");
        input.type = "number";
        input.min = "0";
        input.max = "1000000000";
        input.step = "1";
        input.value = "0";
        input.inputMode = "numeric";
        input.dataset.pointSpendUsageRule = rule.rule_id;
        label.appendChild(input);
        container.appendChild(label);
      }
    });
  };

  const renderPointSpendTargets = (preferredTarget = "") => {
    const sourceId = document.getElementById("point-spend-source").value;
    const target = document.getElementById("point-spend-target");
    const sourceCoverage = pointSpendOptions?.coverage.targetsBySource.find(
      (item) => item.asset_id === sourceId,
    );
    clear(target);
    // Asking "what is this balance best turned into" is a different question
    // from "how do I reach X", and it is usually the one people have.
    const anyTarget = node("option");
    anyTarget.value = "any";
    anyTarget.textContent = "いちばん価値が高い使いみち";
    target.appendChild(anyTarget);
    (sourceCoverage?.targets || []).forEach((asset) => {
      target.appendChild(pointSpendSelectOption(asset));
    });
    if ([...target.options].some((option) => option.value === preferredTarget))
      target.value = preferredTarget;
    target.disabled = target.options.length === 0;
  };

  const loadPointSpendOptions = async () => {
    const result = document.getElementById("point-spend-result");
    try {
      const response = await fetch("/api/experimental/point-spend/options", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("request_failed");
      pointSpendOptions = safePointSpendOptions(await response.json());
      const source = document.getElementById("point-spend-source");
      clear(source);
      pointSpendOptions.assets.forEach((asset) => {
        source.appendChild(pointSpendSelectOption(asset));
      });
      source.value = pointSpendOptions.assets.some(
        (asset) => asset.asset_id === "asset.point.rakuten",
      )
        ? "asset.point.rakuten"
        : pointSpendOptions.assets[0]?.asset_id || "";
      renderPointSpendTargets("asset.mile.ana");
      document.getElementById("point-spend-coverage").textContent =
        "交換元と交換先を選ぶと、利用できるルートを比較します。";
      renderP0WalletCatalogue();
      renderP0ProductPickers();
      renderPointSpendConditions();
      clear(result);
      result.appendChild(
        text("p", "交換元・交換先・残高を選んでください。", "helper"),
      );
    } catch {
      pointSpendOptions = null;
      renderP0WalletCatalogue();
      clear(result);
      result.appendChild(
        text("p", "ポイント交換ルートを読み込めませんでした。", "error-panel"),
      );
    }
  };

  const targetAssetId = () => {
    const value = document.getElementById("point-spend-target").value;
    return value === "any" || value === "" ? null : value;
  };

  const unitValueJpy = () => {
    const raw = document.getElementById("point-spend-unit-value").value;
    if (raw === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.round(parsed * 100) / 100
      : null;
  };

  // A stale graph that looks fresh is worse than one that says how old it is,
  // so every result states where its rates came from.
  const dataOriginNote = (body) => {
    if (body.data_origin === "database") {
      const asOf = body.data_as_of
        ? new Date(body.data_as_of).toLocaleDateString("ja-JP")
        : null;
      return asOf
        ? `${asOf}時点の登録データで計算しています。`
        : "登録済みの最新データで計算しています。";
    }
    return body.data_fallback_reason
      ? "最新データを取得できなかったため、同梱のレートで計算しています。"
      : "同梱のレートで計算しています。";
  };

  const routeChainNodes = (steps) => {
    if (!Array.isArray(steps) || steps.length === 0) return [];
    const output = [
      {
        node_id: steps[0].source_node_id,
        label: steps[0].source_label,
      },
    ];
    steps.forEach((step) => {
      const previous = output[output.length - 1];
      if (previous.node_id !== step.source_node_id)
        output.push({ node_id: step.source_node_id, label: step.source_label });
      output.push({
        node_id: step.destination_node_id,
        label: step.destination_label,
      });
    });
    return output;
  };

  const renderRouteChain = (steps, label = "交換経路") => {
    const chain = node("div", "route-chain");
    chain.setAttribute("role", "list");
    chain.setAttribute("aria-label", label);
    routeChainNodes(steps).forEach((routeNode, index) => {
      if (index > 0) {
        const connector = node("span", "route-chain-arrow");
        connector.setAttribute("aria-hidden", "true");
        connector.appendChild(icon("arrow"));
        chain.appendChild(connector);
      }
      const item = node("div", "route-chain-node");
      item.setAttribute("role", "listitem");
      item.appendChild(routeNodeLogo(routeNode.node_id, routeNode.label));
      item.appendChild(text("span", routeNode.label));
      chain.appendChild(item);
    });
    return chain;
  };

  const renderPointSpendStep = (step) => {
    const item = node("li");
    item.appendChild(text("strong", step.label));
    item.appendChild(
      text(
        "span",
        `${step.source_amount} ${step.source_label} → ${step.destination_amount} ${step.destination_label}`,
      ),
    );
    const timing = step.start_date
      ? `${step.processing_days}・${step.start_date}に開始`
      : step.processing_days;
    item.appendChild(text("small", timing));
    // A hop that could not carry everything is where the plan actually loses
    // value, so it says so on the hop rather than in a footnote.
    if (step.limit_note)
      item.appendChild(
        text(
          "small",
          Number(step.stranded_amount) > 0
            ? `${step.limit_note}、${step.stranded_amount} が残ります`
            : step.limit_note,
          "point-spend-limit",
        ),
      );
    return item;
  };

  const renderPointSpendRoute = (route, primary) => {
    const card = node(
      "article",
      `point-spend-route${primary ? " is-primary" : ""}`,
    );
    const heading = node("div", "point-spend-route-heading");
    heading.appendChild(text("span", primary ? "おすすめ" : "別の候補"));
    heading.appendChild(
      text("strong", `${route.target_amount} ${route.target_label}`),
    );
    card.appendChild(heading);
    if (route.value_jpy !== null) {
      const rate =
        route.effective_rate_percent === null
          ? ""
          : `・実質${route.effective_rate_percent}%`;
      card.appendChild(
        text(
          "strong",
          `約${Number(route.value_jpy).toLocaleString("ja-JP")}円相当${rate}`,
          "point-spend-value",
        ),
      );
    }
    card.appendChild(text("p", route.value_note, "helper"));
    card.appendChild(
      text(
        "p",
        `${route.processing_days}・交換に使う ${route.source_amount_used}・残り ${route.residual_source_amount}`,
        "helper",
      ),
    );
    if (route.split_note)
      card.appendChild(text("p", route.split_note, "point-spend-split"));
    if (route.stranded_note)
      card.appendChild(text("p", route.stranded_note, "point-spend-limit"));
    route.legs.forEach((leg, index) => {
      if (route.legs.length > 1)
        card.appendChild(
          text(
            "strong",
            `ルート${index + 1}：${leg.source_amount} → ${leg.target_amount}（${leg.processing_days}）`,
            "point-spend-leg-heading",
          ),
        );
      const steps = node("ol", "point-spend-steps");
      card.appendChild(renderRouteChain(leg.steps, `交換ルート${index + 1}`));
      leg.steps.forEach((step) => {
        steps.appendChild(renderPointSpendStep(step));
      });
      card.appendChild(steps);
    });
    return card;
  };

  document
    .getElementById("point-spend-source")
    .addEventListener("change", () => {
      renderPointSpendTargets();
      renderPointSpendConditions();
    });
  document
    .getElementById("point-spend-target")
    .addEventListener("change", renderPointSpendConditions);
  document
    .getElementById("point-spend-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = document.getElementById("point-spend-result");
      const button = document.getElementById("point-spend-submit");
      button.disabled = true;
      clear(result);
      result.appendChild(text("p", "交換ルートを計算しています…", "helper"));
      try {
        const confirmed = [
          ...document.querySelectorAll(
            'input[data-point-spend-confirmation="true"]:checked',
          ),
        ].map((checkbox) => checkbox.value);
        const confirmedPrerequisites = [
          ...new Set(
            pointSpendOptions.conditionalRules
              .filter((rule) => confirmed.includes(rule.rule_id))
              .flatMap((rule) => rule.prerequisite_ids),
          ),
        ].sort();
        const periodUsage = Object.fromEntries(
          [
            ...document.querySelectorAll("input[data-point-spend-usage-rule]"),
          ].map((input) => [
            input.dataset.pointSpendUsageRule,
            Number(input.value),
          ]),
        );
        const body = await postJson(
          "/api/experimental/point-spend/recommendation",
          {
            source_asset_id:
              document.getElementById("point-spend-source").value,
            target_asset_id: targetAssetId(),
            balance: Number(
              document.getElementById("point-spend-balance").value,
            ),
            objective:
              document.getElementById("point-spend-objective").value ||
              "maximize_value",
            effective_at: new Date().toISOString(),
            confirmed_rule_ids: confirmed,
            confirmed_prerequisite_ids: confirmedPrerequisites,
            period_source_used_by_rule: periodUsage,
            unit_value_jpy: unitValueJpy(),
          },
        );
        clear(result);
        if (body.status !== "ready" || !body.winner) {
          result.appendChild(
            text("strong", "安全に計算できるルートがありません"),
          );
          result.appendChild(
            text("p", body.message || "条件を確認してください。", "helper"),
          );
          return;
        }
        result.appendChild(renderPointSpendRoute(body.winner, true));
        (body.alternatives || []).forEach((route) => {
          result.appendChild(renderPointSpendRoute(route, false));
        });
        if ((body.unvalued_asset_labels || []).length > 0)
          result.appendChild(
            text(
              "p",
              `円換算が登録されていない交換先：${body.unvalued_asset_labels.join("・")}。1単位の価値を入力すると比較できます。`,
              "helper",
            ),
          );
        result.appendChild(text("p", dataOriginNote(body), "helper"));
        result.appendChild(text("p", body.message, "helper"));
      } catch {
        clear(result);
        result.appendChild(
          text("p", "交換ルートを計算できませんでした。", "error-panel"),
        );
      } finally {
        button.disabled = false;
      }
    });

  // ---------------------------------------------------------------------
  // Campaign route benchmark.
  //
  // This small surface lives immediately after the fixed-ratio spend result.
  // It submits only bounded scenario state; all campaign claims, engine
  // plans, and source bindings remain on the trusted host.
  // ---------------------------------------------------------------------
  const campaignRouteStatusLabels = Object.freeze({
    eligible: "条件を満たすルート",
    conditional: "確認が必要なルート",
    no_valid_plan: "有効なルートなし",
  });

  const safeCampaignRoute = (body) => {
    if (
      !body ||
      body.version !== "campaign-route-recommendation.v1" ||
      body.experimental !== true ||
      body.current_advice !== false ||
      !["moppy_aug_2026", "jal_mileage_park_rakuten"].includes(body.scenario) ||
      !["eligible", "conditional", "no_valid_plan"].includes(body.status) ||
      body.status !== body.outcome ||
      (body.winner !== null &&
        (!body.winner ||
          typeof body.winner !== "object" ||
          !Array.isArray(body.winner.steps) ||
          !Array.isArray(body.winner.rewards) ||
          !Array.isArray(body.winner.prerequisites)))
    )
      throw new Error("campaign_route_invalid");
    if (body.winner) {
      if (body.winner.steps.length < 1 || body.winner.steps.length > 6)
        throw new Error("campaign_route_invalid");
      body.winner.steps.forEach((step) => {
        if (
          !step ||
          typeof step.label !== "string" ||
          typeof step.source_label !== "string" ||
          typeof step.destination_label !== "string" ||
          typeof step.source_amount !== "string" ||
          typeof step.destination_amount !== "string" ||
          typeof step.source_node_id !== "string" ||
          typeof step.destination_node_id !== "string" ||
          !/^[a-z][a-z0-9.-]{1,119}$/u.test(step.source_node_id) ||
          !/^[a-z][a-z0-9.-]{1,119}$/u.test(step.destination_node_id)
        )
          throw new Error("campaign_route_invalid");
      });
      if (body.winner.rewards.length > 4)
        throw new Error("campaign_route_invalid");
      body.winner.rewards.forEach((reward) => {
        if (
          !reward ||
          !["principal", "bonus", "rebate", "portal_reward"].includes(
            reward.kind,
          ) ||
          typeof reward.label !== "string" ||
          typeof reward.asset_id !== "string" ||
          !/^asset\.[a-z0-9.-]{1,113}$/u.test(reward.asset_id) ||
          typeof reward.asset_label !== "string" ||
          typeof reward.amount !== "string" ||
          !/^[0-9]+$/u.test(reward.amount) ||
          !["posted", "pending"].includes(reward.settlement) ||
          typeof reward.posting !== "string" ||
          (!Number.isSafeInteger(reward.processing_days_min) &&
            reward.processing_days_min !== null) ||
          (!Number.isSafeInteger(reward.processing_days_max) &&
            reward.processing_days_max !== null)
        )
          throw new Error("campaign_route_invalid");
      });
      body.winner.prerequisites.forEach((prerequisite) => {
        if (
          !prerequisite ||
          typeof prerequisite.label !== "string" ||
          !["satisfied", "missing", "not_satisfied"].includes(
            prerequisite.status,
          )
        )
          throw new Error("campaign_route_invalid");
      });
    }
    return body;
  };

  const renderCampaignRoute = (container, body) => {
    clear(container);
    const status = node("p", "status");
    status.textContent = campaignRouteStatusLabels[body.status] || "結果";
    container.appendChild(status);
    if (!body.winner) {
      container.appendChild(text("p", body.message, "helper"));
      return;
    }
    container.appendChild(text("h3", body.winner.label));
    container.appendChild(
      renderRouteChain(body.winner.steps, "キャンペーンを含む経路"),
    );
    const routeSteps = node("ol", "point-spend-steps campaign-route-steps");
    body.winner.steps.forEach((step) => {
      const item = node("li");
      item.appendChild(text("strong", step.label));
      item.appendChild(
        text(
          "span",
          `${step.source_amount} ${step.source_label} → ${step.destination_amount} ${step.destination_label}`,
        ),
      );
      routeSteps.appendChild(item);
    });
    container.appendChild(routeSteps);
    const cards = node("div", "campaign-route-rewards");
    body.winner.rewards.forEach((reward) => {
      const card = node("article", "campaign-reward-card");
      const heading = node("div", "campaign-reward-heading");
      heading.appendChild(routeNodeLogo(reward.asset_id, reward.asset_label));
      const copy = node("div");
      copy.appendChild(text("strong", reward.label));
      copy.appendChild(text("span", reward.asset_label));
      heading.appendChild(copy);
      card.appendChild(heading);
      card.appendChild(
        text(
          "p",
          `${Number(reward.amount).toLocaleString("ja-JP")} ${reward.asset_label}`,
          "campaign-reward-amount",
        ),
      );
      card.appendChild(
        text(
          "small",
          `${reward.settlement === "pending" ? "後日付与" : "本体"}・${reward.posting}`,
        ),
      );
      cards.appendChild(card);
    });
    container.appendChild(cards);
    if (body.winner.prerequisites.length) {
      const conditions = node("ul", "campaign-route-conditions");
      body.winner.prerequisites.forEach((prerequisite) => {
        const statusLabel =
          prerequisite.status === "satisfied"
            ? "確認済み"
            : prerequisite.status === "not_satisfied"
              ? "未達"
              : "確認が必要";
        conditions.appendChild(
          text("li", `${statusLabel}：${prerequisite.label}`),
        );
      });
      container.appendChild(conditions);
    }
    container.appendChild(text("p", body.winner.note, "helper"));
    container.appendChild(text("p", body.message, "helper"));
  };

  const insertCampaignRoutePanel = () => {
    const pointResult = document.getElementById("point-spend-result");
    const standardForm = document.getElementById("point-spend-form");
    if (
      !pointResult ||
      !standardForm ||
      document.getElementById("campaign-route-panel")
    )
      return;
    const modeSwitch = node("div", "route-mode-switch");
    modeSwitch.setAttribute("role", "tablist");
    modeSwitch.setAttribute("aria-label", "交換ルートの種類");
    const standardMode = node("button", "is-active");
    standardMode.type = "button";
    standardMode.setAttribute("role", "tab");
    standardMode.setAttribute("aria-selected", "true");
    standardMode.textContent = "通常の交換";
    const campaignMode = node("button");
    campaignMode.type = "button";
    campaignMode.setAttribute("role", "tab");
    campaignMode.setAttribute("aria-selected", "false");
    campaignMode.textContent = "キャンペーン込み";
    modeSwitch.appendChild(standardMode);
    modeSwitch.appendChild(campaignMode);
    standardForm.before(modeSwitch);

    const panel = node("div", "campaign-route-inline");
    panel.id = "campaign-route-panel";
    panel.hidden = true;
    const title = text("h3", "キャンペーン・ポータルを含むルート");
    title.id = "campaign-route-title";
    panel.setAttribute("aria-labelledby", "campaign-route-title");
    panel.appendChild(title);
    panel.appendChild(
      text(
        "p",
        "交換本体と中継先を一本の経路で表示し、後日付与とポータル還元は分けて確認します。抽選は計算しません。",
        "helper",
      ),
    );
    const form = node("form", "point-spend-card");
    form.id = "campaign-route-form";
    const grid = node("div", "point-spend-grid");
    const scenarioLabel = node("label");
    scenarioLabel.appendChild(text("span", "試算する経路"));
    const scenario = selectField([
      { value: "moppy_aug_2026", label: "モッピー→JAL（2026年8月）" },
      {
        value: "jal_mileage_park_rakuten",
        label: "JALマイレージパーク→楽天市場",
      },
    ]);
    scenario.id = "campaign-route-scenario";
    scenarioLabel.appendChild(scenario);
    grid.appendChild(scenarioLabel);
    const adLabel = node("label");
    adLabel.id = "campaign-route-ad-earned-label";
    adLabel.appendChild(text("span", "広告利用で獲得したモッピー（任意）"));
    const adEarned = node("input");
    adEarned.id = "campaign-route-ad-earned";
    adEarned.type = "number";
    adEarned.min = "0";
    adEarned.step = "1";
    adEarned.placeholder = "例：10000";
    adLabel.appendChild(adEarned);
    grid.appendChild(adLabel);
    const monthlyLabel = node("label");
    monthlyLabel.id = "campaign-route-monthly-label";
    monthlyLabel.appendChild(text("span", "今月の交換回数（任意）"));
    const monthly = node("input");
    monthly.id = "campaign-route-monthly-count";
    monthly.type = "number";
    monthly.min = "0";
    monthly.step = "1";
    monthly.placeholder = "例：0";
    monthlyLabel.appendChild(monthly);
    grid.appendChild(monthlyLabel);
    const amountLabel = node("label");
    amountLabel.id = "campaign-route-amount-label";
    amountLabel.hidden = true;
    amountLabel.appendChild(text("span", "楽天市場の購入金額"));
    const amount = node("input");
    amount.id = "campaign-route-purchase-amount";
    amount.type = "number";
    amount.min = "1";
    amount.step = "1";
    amount.value = "30000";
    amountLabel.appendChild(amount);
    grid.appendChild(amountLabel);
    const traversalLabel = node("label");
    traversalLabel.id = "campaign-route-traversal-label";
    traversalLabel.hidden = true;
    const traversal = node("input");
    traversal.id = "campaign-route-traversal";
    traversal.type = "checkbox";
    traversalLabel.appendChild(traversal);
    traversalLabel.appendChild(
      text("span", "購入直前にJALマイレージパークから遷移した"),
    );
    grid.appendChild(traversalLabel);
    form.appendChild(grid);
    const submit = node("button", "primary wide");
    submit.type = "submit";
    submit.textContent = "キャンペーン経路を試算する";
    form.appendChild(submit);
    panel.appendChild(form);
    const output = node("div", "point-spend-result");
    output.id = "campaign-route-result";
    output.setAttribute("aria-live", "polite");
    output.appendChild(text("p", "経路を選んで試算してください。", "helper"));
    panel.appendChild(output);
    pointResult.after(panel);
    const selectMode = (campaignSelected) => {
      standardMode.classList.toggle("is-active", !campaignSelected);
      campaignMode.classList.toggle("is-active", campaignSelected);
      standardMode.setAttribute("aria-selected", String(!campaignSelected));
      campaignMode.setAttribute("aria-selected", String(campaignSelected));
      standardForm.hidden = campaignSelected;
      pointResult.hidden = campaignSelected;
      panel.hidden = !campaignSelected;
    };
    standardMode.addEventListener("click", () => selectMode(false));
    campaignMode.addEventListener("click", () => selectMode(true));
    const sync = () => {
      const moppy = scenario.value === "moppy_aug_2026";
      adLabel.hidden = !moppy;
      monthlyLabel.hidden = !moppy;
      amountLabel.hidden = moppy;
      traversalLabel.hidden = moppy;
    };
    scenario.addEventListener("change", sync);
    sync();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      clear(output);
      output.appendChild(
        text("p", "キャンペーン経路を確認しています…", "helper"),
      );
      const moppy = scenario.value === "moppy_aug_2026";
      const numberOrNull = (input) => {
        const value = Number(input.value);
        return input.value === "" || !Number.isSafeInteger(value)
          ? null
          : value;
      };
      try {
        const body = await postJson(
          "/api/experimental/campaign-routes/recommendation",
          {
            scenario: scenario.value,
            effective_at: new Date().toISOString(),
            ...(moppy
              ? {
                  moppy_balance_points: 12000,
                  ad_earned_points: numberOrNull(adEarned),
                  monthly_exchange_count: numberOrNull(monthly),
                }
              : {
                  purchase_amount_jpy: numberOrNull(amount),
                  portal_traversal_confirmed: traversal.checked,
                }),
          },
        );
        renderCampaignRoute(output, safeCampaignRoute(body));
      } catch {
        clear(output);
        output.appendChild(
          text("p", "キャンペーン経路を計算できませんでした。", "error-panel"),
        );
      } finally {
        submit.disabled = false;
      }
    });
  };

  insertCampaignRoutePanel();

  // ---------------------------------------------------------------------
  // Payment stack comparison.
  //
  // Paying well is usually a stack, not a single instrument: a card funds a
  // wallet, the wallet pays, a loyalty identifier is shown. Only what the
  // buyer actually holds is considered, because a plan they cannot execute
  // is not advice.

  const renderPaymentStackOwned = () => {
    const container = document.getElementById("payment-stack-owned");
    clear(container);
    if (!pointSpendOptions) return;
    const selected = new Set(selectedP0Products());
    const categories = [
      {
        label: "クレジットカード（発行会社順）",
        accepts: (item) => item.kind === "credit_card",
        sort: walletItemSort,
      },
      {
        label: "モバイル決済",
        accepts: (item) => item.kind === "mobile_pay",
        sort: (left, right) => left.label.localeCompare(right.label, "ja"),
      },
      {
        label: "ポイント・電子マネー",
        accepts: (item) =>
          ["point", "emoney", "stored_value"].includes(item.kind),
        sort: (left, right) => left.label.localeCompare(right.label, "ja"),
      },
    ];

    categories.forEach((category) => {
      const items = pointSpendOptions.walletCatalogue
        .filter(category.accepts)
        .sort(category.sort);
      if (!items.length) return;
      const section = node("section", "payment-stack-group");
      const heading = node("div", "payment-stack-group-heading");
      heading.appendChild(text("strong", category.label));
      heading.appendChild(text("small", "タップして選択"));
      section.appendChild(heading);
      const picker = node("div", "p0-product-picker payment-stack-picker");
      items.forEach((item) => {
        const option = node("label", "p0-product-option");
        const checkbox = node("input");
        checkbox.type = "checkbox";
        checkbox.value = item.family_id;
        checkbox.checked = selected.has(item.family_id);
        checkbox.dataset.paymentStackOwned = "true";
        checkbox.addEventListener("change", () => {
          const mirror = [
            ...document.querySelectorAll("[data-p0-product]"),
          ].find((candidate) => candidate.value === item.family_id);
          if (!mirror) return;
          mirror.checked = checkbox.checked;
          syncP0ProductPickers();
        });
        const copy = node("span", "p0-product-identity");
        copy.appendChild(paymentLogo(item.family_id, item.label));
        const name = node("span", "p0-product-name");
        name.appendChild(text("strong", item.label));
        if (item.kind === "credit_card" && cardIssuer(item) !== item.label)
          name.appendChild(text("small", cardIssuer(item)));
        copy.appendChild(name);
        const tick = node("span", "p0-product-check");
        tick.appendChild(icon("check"));
        option.appendChild(checkbox);
        option.appendChild(copy);
        option.appendChild(tick);
        picker.appendChild(option);
      });
      section.appendChild(picker);
      container.appendChild(section);
    });
  };

  const syncPaymentStackOwnedState = (selected) => {
    const selectedIds = new Set(selected);
    document
      .querySelectorAll('[data-payment-stack-owned="true"]')
      .forEach((input) => {
        input.checked = selectedIds.has(input.value);
      });
  };

  // The merchant list arrives with the result rather than from a separate
  // call, so the picker fills in as soon as the first comparison runs.
  const renderPaymentStackMerchants = (merchants) => {
    const select = document.getElementById("payment-stack-merchant");
    if (select.options.length > 1 || merchants.length === 0) return;
    const chosen = select.value;
    merchants.forEach((merchant) => {
      if (typeof merchant?.merchant_id !== "string") return;
      const option = node("option");
      option.value = merchant.merchant_id;
      option.textContent = merchant.label || merchant.merchant_id;
      select.appendChild(option);
    });
    select.value = chosen;
  };

  const renderPaymentStackPlan = (plan, primary) => {
    const card = node(
      "article",
      `point-spend-route${primary ? " is-primary" : ""}`,
    );
    const heading = node("div", "point-spend-route-heading");
    heading.appendChild(text("span", primary ? "おすすめ" : "別の候補"));
    // A yen total is only shown when every channel in the plan is priced;
    // otherwise the honest headline is the native points it earns.
    heading.appendChild(
      text(
        "strong",
        plan.total_value_jpy !== null
          ? `約${Number(plan.total_value_jpy).toLocaleString("ja-JP")}円相当`
          : plan.native_reward_points !== null
            ? `${plan.native_reward_points} ${plan.native_reward_label}`
            : "還元の円換算は未登録",
      ),
    );
    card.appendChild(heading);
    if (plan.total_rate_percent !== null)
      card.appendChild(
        text("strong", `合計${plan.total_rate_percent}%`, "point-spend-value"),
      );
    card.appendChild(
      text("p", `${plan.channel_count}つの経路を重ねています。`, "helper"),
    );
    const steps = node("ol", "point-spend-steps");
    plan.layers.forEach((layer) => {
      const item = node("li");
      item.appendChild(text("strong", layer.action));
      item.appendChild(
        text("span", `${layer.reward_points} ${layer.reward_label}`),
      );
      if (layer.rate_percent !== null)
        item.appendChild(text("small", `${layer.rate_percent}%`));
      if (layer.cap_note)
        item.appendChild(text("small", layer.cap_note, "point-spend-limit"));
      steps.appendChild(item);
    });
    card.appendChild(steps);
    if (plan.conditions.length > 0)
      card.appendChild(
        text("p", `条件：${plan.conditions.join("・")}`, "helper"),
      );
    return card;
  };

  document
    .getElementById("payment-stack-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = document.getElementById("payment-stack-result");
      const button = document.getElementById("payment-stack-submit");
      button.disabled = true;
      clear(result);
      result.appendChild(text("p", "支払い方法を比較しています…", "helper"));
      try {
        const owned = [
          ...document.querySelectorAll(
            'input[data-payment-stack-owned="true"]:checked',
          ),
        ].map((checkbox) => checkbox.value);
        const body = await postJson(
          "/api/experimental/payment-stack/recommendation",
          {
            merchant_id:
              document.getElementById("payment-stack-merchant").value ||
              "merchant.any",
            amount_jpy: Number(
              document.getElementById("payment-stack-amount").value,
            ),
            owned_family_ids: owned,
            effective_at: new Date().toISOString(),
            confirmed_option_ids: [],
          },
        );
        clear(result);
        if (body.status !== "ready" || !body.winner) {
          result.appendChild(
            text("strong", "計算できる組み合わせがありません"),
          );
          result.appendChild(
            text("p", body.message || "条件を確認してください。", "helper"),
          );
          return;
        }
        renderPaymentStackMerchants(body.merchants || []);
        result.appendChild(renderPaymentStackPlan(body.winner, true));
        (body.alternatives || []).forEach((plan) => {
          result.appendChild(renderPaymentStackPlan(plan, false));
        });
        (body.charge_warnings || []).forEach((warning) => {
          result.appendChild(
            text("p", `${warning.label}：${warning.note}`, "point-spend-limit"),
          );
        });
        result.appendChild(text("p", dataOriginNote(body), "helper"));
        result.appendChild(text("p", body.message, "helper"));
      } catch {
        clear(result);
        result.appendChild(
          text("p", "支払い方法を比較できませんでした。", "error-panel"),
        );
      } finally {
        button.disabled = false;
      }
    });

  // ---------------------------------------------------------------------
  // Lot ledger.
  //
  // An aggregator stores one number per programme. This stores lots: a
  // 通常 balance and a 期間限定 grant are different assets with different
  // deadlines, different places they can be spent, and different answers
  // to "can this deadline be moved at all?" — so they are separate rows.
  //
  // No balance, expiry, or account backend exists yet, so the panel runs on
  // a checked-in demo dataset. Days are stored relative to "today" rather
  // than as absolute dates, so a deadline is never rendered in the past.
  // Every figure carries its confidence and every rule carries its source.
  // ---------------------------------------------------------------------
  const walletDemo = Object.freeze({
    updated_days_ago: 28,
    programs: Object.freeze([
      Object.freeze({
        family_id: "point.rakuten",
        label: "楽天ポイント",
        asset_id: "asset.point.rakuten",
        jpy_per_unit: 1,
        source: "楽天PointClub ヘルプ",
        checked_days_ago: 3,
        move: Object.freeze({
          policy: "extendable",
          action: "楽天ペイで1ポイント貯める",
          detail: "通常ポイントの期限が、その月から1年先に動きます",
        }),
        lots: Object.freeze([
          Object.freeze({
            lot_class: "standard",
            label: "通常",
            quantity: 2040,
            days_remaining: null,
            extendable: true,
            confidence: "confirmed",
            note: "次回の獲得で自動的に1年先まで延びます",
            note_kind: "rule",
          }),
          Object.freeze({
            lot_class: "limited",
            label: "期間限定",
            quantity: 1000,
            days_remaining: 4,
            extendable: false,
            confidence: "confirmed",
            note: "楽天ペイ・楽天市場でのみ利用可。付与時に個別の期限が決まり、延長されません",
            note_kind: "restriction",
          }),
          Object.freeze({
            lot_class: "restricted",
            label: "期間限定",
            quantity: 200,
            days_remaining: 21,
            extendable: false,
            confidence: "estimated",
            note: "楽天市場でのみ利用可。期限は収録ルールからの推定です",
            note_kind: "restriction",
          }),
        ]),
      }),
      Object.freeze({
        family_id: "point.d",
        label: "dポイント",
        asset_id: "asset.point.d",
        jpy_per_unit: 1,
        source: "dポイントクラブ会員規約",
        checked_days_ago: 12,
        move: Object.freeze({
          policy: "fixed",
          action: "マクドナルドで使い切る",
          detail: "期限は動かせないため、失効前に使い切るのが唯一の手です",
        }),
        lots: Object.freeze([
          Object.freeze({
            lot_class: "standard",
            label: "通常",
            quantity: 3268,
            days_remaining: 42,
            extendable: false,
            confidence: "confirmed",
            note: "貯めた月から48か月後の月末で失効。使っても貯めても期限は動きません",
            note_kind: "rule",
          }),
        ]),
      }),
      Object.freeze({
        family_id: "point.v",
        label: "Vポイント",
        asset_id: "asset.point.v",
        jpy_per_unit: 1,
        source: "Vポイント公式サイト",
        checked_days_ago: 9,
        move: Object.freeze({
          policy: "extendable",
          action: "ファミリーマートで1ポイント使う",
          detail: "残高が動いた日から、また1年先まで延びます",
        }),
        lots: Object.freeze([
          Object.freeze({
            lot_class: "standard",
            label: "通常",
            quantity: 860,
            days_remaining: 57,
            extendable: true,
            confidence: "estimated",
            note: "最終変動日が分からないため、収録ルールから期限を推定しています",
            note_kind: "rule",
          }),
        ]),
      }),
      Object.freeze({
        family_id: "point.ponta",
        label: "Pontaポイント",
        asset_id: "asset.point.ponta",
        jpy_per_unit: 1,
        source: "Ponta公式FAQ・ローソン公式サポート",
        checked_days_ago: 5,
        move: Object.freeze({
          policy: "extendable",
          action: "ローソンで1回買い物する",
          detail: "全ポイントの期限が、その日から1年先に動きます",
        }),
        lots: Object.freeze([
          Object.freeze({
            lot_class: "standard",
            label: "通常",
            quantity: 1850,
            days_remaining: 62,
            extendable: true,
            confidence: "confirmed",
            note: "「KDDI定期付与」で入ったポイントでは延長されません。自分で使うか貯めるかが必要です",
            note_kind: "trap",
          }),
        ]),
      }),
      Object.freeze({
        family_id: "point.nanaco",
        label: "nanacoポイント",
        asset_id: "asset.point.nanaco",
        jpy_per_unit: 1,
        source: "nanaco公式サイト",
        checked_days_ago: 18,
        move: Object.freeze({
          policy: "fixed",
          action: "電子マネーに交換して使う",
          detail:
            "年度の締め切りは動かせないため、交換して使い切るのが確実です",
        }),
        lots: Object.freeze([
          Object.freeze({
            lot_class: "standard",
            label: "通常",
            quantity: 612,
            days_remaining: 251,
            extendable: false,
            confidence: "estimated",
            note: "前の年度に貯めた分は今の年度末で失効。年度末の日付から推定しています",
            note_kind: "rule",
          }),
        ]),
      }),
      Object.freeze({
        family_id: "point.paypay",
        label: "PayPayポイント",
        asset_id: "asset.point.paypay",
        jpy_per_unit: 1,
        source: "PayPayヘルプ",
        checked_days_ago: 4,
        move: Object.freeze({ policy: "none", action: "", detail: "" }),
        lots: Object.freeze([
          Object.freeze({
            lot_class: "standard",
            label: "通常",
            quantity: 1076,
            days_remaining: null,
            extendable: null,
            confidence: "confirmed",
            note: "有効期限はありません。還元率の高い場面まで置いておけます",
            note_kind: "rule",
          }),
        ]),
      }),
    ]),
  });

  const AT_RISK_DAYS = 30;
  const RUNWAY_DAYS = 90;
  const RUNWAY_BUCKETS = 12;

  const lotClassLabels = Object.freeze({
    standard: "通常",
    limited: "期間限定",
    restricted: "用途限定",
  });

  const confidenceLabels = Object.freeze({
    confirmed: "確認済み",
    estimated: "推定",
  });

  const moveHeadings = Object.freeze({
    extendable: "期限を延ばす一手",
    fixed: "使い切る一手",
  });

  const yen = (value) => `¥${Math.round(value).toLocaleString("ja-JP")}`;
  const points = (value) => `${value.toLocaleString("ja-JP")} pt`;

  const dateLabel = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const lotValue = (program, lot) => lot.quantity * program.jpy_per_unit;

  const allLots = () =>
    walletDemo.programs.flatMap((program) =>
      program.lots.map((lot) => ({ program, lot })),
    );

  const referenceFactForProgram = (familyId) => {
    const group = consumerReference?.wallet_programs.find(
      (item) => item.family_id === familyId,
    );
    if (!group) return null;
    const isExpiryFact = (fact) =>
      fact.claim_type === "expiry_rule" ||
      fact.claim_type === "expiry_and_reward_classes" ||
      fact.claim_type === "expiry_and_redemption_priority" ||
      fact.claim_type === "campaign_expiry";
    return (
      group.facts.find(
        (fact) =>
          fact.validity_state === "active" &&
          isExpiryFact(fact) &&
          fact.source_url,
      ) ||
      group.facts.find(
        (fact) => fact.validity_state === "active" && isExpiryFact(fact),
      ) ||
      group.facts.find((fact) => fact.validity_state === "active") ||
      null
    );
  };

  const dueBand = (days) => {
    if (days === null) return "ok";
    if (days <= AT_RISK_DAYS) return "hot";
    if (days <= 60) return "warn";
    return "info";
  };

  const dueLabel = (lot) =>
    lot.days_remaining === null
      ? lot.extendable === null
        ? "期限なし"
        : "期限なし*"
      : `あと${lot.days_remaining}日`;

  const renderBalanceHero = () => {
    const entries = allLots();
    const total = entries.reduce(
      (sum, entry) => sum + lotValue(entry.program, entry.lot),
      0,
    );
    const atRisk = entries.filter(
      (entry) =>
        entry.lot.days_remaining !== null &&
        entry.lot.days_remaining <= AT_RISK_DAYS,
    );
    const atRiskValue = atRisk.reduce(
      (sum, entry) => sum + lotValue(entry.program, entry.lot),
      0,
    );
    const savable = entries.filter(
      (entry) =>
        entry.lot.extendable === true &&
        entry.lot.days_remaining !== null &&
        entry.lot.days_remaining <= RUNWAY_DAYS,
    );
    const savableValue = savable.reduce(
      (sum, entry) => sum + lotValue(entry.program, entry.lot),
      0,
    );
    const estimated = entries.filter(
      (entry) => entry.lot.confidence === "estimated",
    );

    document.getElementById("balance-asof").textContent = `${dateLabel(0)}時点`;
    countTo(document.getElementById("balance-total"), total, yen);
    countTo(document.getElementById("balance-at-risk"), atRiskValue, yen, 700);

    const chips = document.getElementById("balance-chips");
    clear(chips);
    const addChip = (tone, label) => {
      const chip = text("span", label, "chip");
      chip.dataset.tone = tone;
      chips.appendChild(chip);
    };
    addChip("hot", `${atRisk.length}件が30日以内`);
    if (savableValue)
      addChip("ok", `${yen(savableValue)} は行動すれば延長できます`);
    if (estimated.length) addChip("warn", `${estimated.length}件が推定値`);
    stagger(chips.children);
  };

  const renderValuation = () => {
    const table = document.getElementById("valuation-table");
    clear(table);
    walletDemo.programs.forEach((program) => {
      table.appendChild(text("dt", program.label));
      table.appendChild(
        text("dd", `1pt = ¥${program.jpy_per_unit.toFixed(2)}`),
      );
    });
    document.getElementById("valuation-basis").textContent =
      "交換先を決めずに保有している分は、額面どおり1ポイント=1円として数えています。交換や用途を絞ると1円を上回ることも下回ることもあるため、この合計は「いま失うと困る額」の目安で、最大化した価値ではありません。";
  };

  const renderRunway = () => {
    const container = document.getElementById("runway-bars");
    clear(container);
    document.getElementById("runway-range").textContent =
      `今日 → ${dateLabel(RUNWAY_DAYS)}`;
    const width = RUNWAY_DAYS / RUNWAY_BUCKETS;
    const buckets = Array.from({ length: RUNWAY_BUCKETS }, () => []);
    allLots().forEach((entry) => {
      const days = entry.lot.days_remaining;
      if (days === null || days > RUNWAY_DAYS) return;
      const index = Math.min(RUNWAY_BUCKETS - 1, Math.floor(days / width));
      buckets[index].push(entry);
    });
    const peak = buckets.reduce(
      (best, bucket) =>
        Math.max(
          best,
          bucket.reduce(
            (sum, entry) => sum + lotValue(entry.program, entry.lot),
            0,
          ),
        ),
      0,
    );
    buckets.forEach((bucket, index) => {
      const bar = node("button");
      bar.type = "button";
      const value = bucket.reduce(
        (sum, entry) => sum + lotValue(entry.program, entry.lot),
        0,
      );
      const from = Math.round(index * width);
      const to = Math.round((index + 1) * width);
      if (!value) {
        bar.disabled = true;
        bar.setAttribute("aria-label", `${from}〜${to}日：失効なし`);
        container.appendChild(bar);
        return;
      }
      const entry = bucket[0];
      bar.dataset.band = dueBand(entry.lot.days_remaining);
      bar.style.height = `${Math.max(14, Math.round((value / peak) * 100))}%`;
      bar.setAttribute(
        "aria-label",
        `${from}〜${to}日：${yen(value)}が失効。タップすると使い道を試算します`,
      );
      bar.addEventListener("click", () => {
        focusLotForSpending(entry.program, entry.lot);
      });
      container.appendChild(bar);
    });
    if (!reducedMotion()) {
      [...container.children].forEach((bar, index) => {
        bar.style.setProperty("--i", String(index));
      });
      container.classList.remove("is-drawing");
      void container.offsetWidth;
      container.classList.add("is-drawing");
    }
  };

  // Tapping a runway bar or a lot's action jumps to 使う with that lot loaded.
  const focusLotForSpending = (program, lot) => {
    const slot = document.getElementById("spend-focus");
    clear(slot);
    const card = node("div", "action-callout");
    const mark = node("span", "callout-mark");
    mark.appendChild(icon("clock"));
    card.appendChild(mark);
    const copy = node("span", "callout-copy");
    copy.appendChild(text("small", "この残高を使い切る"));
    copy.appendChild(
      text(
        "strong",
        `${program.label}・${lotClassLabels[lot.lot_class]} ${points(lot.quantity)}`,
      ),
    );
    copy.appendChild(
      text(
        "span",
        lot.days_remaining === null
          ? lot.note
          : `${dateLabel(lot.days_remaining)}まで（あと${lot.days_remaining}日）。${lot.note}`,
      ),
    );
    card.appendChild(copy);
    slot.appendChild(card);

    const source = document.getElementById("point-spend-source");
    const match = [...source.options].find(
      (option) => option.value === program.asset_id,
    );
    if (match) {
      source.value = match.value;
      source.dispatchEvent(new Event("change"));
    }
    document.getElementById("point-spend-balance").value = String(lot.quantity);
    if (lot.days_remaining !== null)
      document.getElementById("point-spend-objective").value =
        "preserve_expiring";
    activateTab("spend");
  };

  const renderLotRow = (body, lot) => {
    const row = node("div", "lot-row");
    const tag = text("span", lotClassLabels[lot.lot_class], "lot-tag");
    tag.dataset.class = lot.lot_class;
    row.appendChild(tag);
    row.appendChild(text("span", points(lot.quantity), "lot-qty"));
    const confidence = text(
      "em",
      confidenceLabels[lot.confidence],
      "confidence",
    );
    confidence.dataset.state = lot.confidence;
    row.appendChild(confidence);
    const due = text("span", dueLabel(lot), "lot-due");
    due.dataset.band = dueBand(lot.days_remaining);
    row.appendChild(due);
    body.appendChild(row);

    const note = text("p", lot.note, "lot-note");
    note.dataset.kind = lot.note_kind;
    body.appendChild(note);
  };

  const renderLotCard = (list, program) => {
    const card = node("article", "lot-card");
    card.dataset.open = "false";
    const value = program.lots.reduce(
      (sum, lot) => sum + lotValue(program, lot),
      0,
    );

    const head = node("button", "lot-card-head");
    head.type = "button";
    head.setAttribute("aria-expanded", "false");
    head.appendChild(paymentLogo(program.family_id));
    const identity = node("div", "lot-identity");
    identity.appendChild(text("strong", program.label));
    identity.appendChild(text("small", "タップして内訳を見る"));
    head.appendChild(identity);
    const total = node("span", "lot-total");
    total.appendChild(text("b", yen(value)));
    const chevron = node("span", "lot-chevron");
    chevron.appendChild(icon("chevron"));
    total.appendChild(chevron);
    head.appendChild(total);
    head.addEventListener("click", () => {
      const open = card.dataset.open !== "true";
      card.dataset.open = String(open);
      head.setAttribute("aria-expanded", String(open));
    });
    card.appendChild(head);

    const body = node("div", "lot-body");
    const inner = node("div", "lot-body-inner");
    program.lots.forEach((lot) => {
      renderLotRow(inner, lot);
    });

    if (program.move.policy !== "none") {
      const move = node("div", "lot-move");
      if (program.move.policy === "fixed") move.classList.add("is-fixed");
      const copy = node("b");
      copy.textContent = `${moveHeadings[program.move.policy]}：${program.move.action}`;
      move.appendChild(copy);
      const go = node("button");
      go.type = "button";
      go.textContent = "使う";
      go.addEventListener("click", () => {
        const target =
          program.lots.find(
            (lot) => lot.days_remaining !== null && lot.extendable !== true,
          ) || program.lots[0];
        focusLotForSpending(program, target);
      });
      move.appendChild(go);
      inner.appendChild(move);
      inner.appendChild(text("p", program.move.detail, "lot-note"));
    }

    const update = node("button", "lot-update");
    update.type = "button";
    update.disabled = true;
    update.setAttribute(
      "aria-label",
      `${program.label}をスクショで更新・準備中`,
    );
    const updateCopy = node("span");
    updateCopy.appendChild(text("strong", "スクショで残高を更新"));
    updateCopy.appendChild(
      text("small", `${program.label}の残高画面を使います`),
    );
    update.appendChild(updateCopy);
    const updateState = text("em", "準備中");
    update.appendChild(updateState);
    inner.appendChild(update);

    const source = node("div", "lot-source");
    const referenceFact = referenceFactForProgram(program.family_id);
    const sourceCopy = node("div", "lot-source-copy");
    if (referenceFact) {
      const referenceLabel = referenceFact.claim_type.includes("expiry")
        ? "期限情報"
        : "公式情報";
      sourceCopy.appendChild(
        text(
          "span",
          `${referenceLabel}：${referenceFact.summary}`,
          "lot-source-summary",
        ),
      );
      const provenance = officialSourceLink(
        referenceFact.source_url,
        referenceFact.checked_at,
      );
      if (provenance) sourceCopy.appendChild(provenance);
    } else {
      sourceCopy.appendChild(text("span", `参照元：${program.source}`));
    }
    source.appendChild(sourceCopy);
    inner.appendChild(source);

    body.appendChild(inner);
    card.appendChild(body);
    list.appendChild(card);
  };

  const renderLotList = () => {
    const list = document.getElementById("lot-list");
    clear(list);
    const soonest = (program) =>
      program.lots.reduce(
        (best, lot) =>
          lot.days_remaining === null
            ? best
            : Math.min(best, lot.days_remaining),
        Number.POSITIVE_INFINITY,
      );
    [...walletDemo.programs]
      .sort((left, right) => soonest(left) - soonest(right))
      .forEach((program) => {
        renderLotCard(list, program);
      });
    stagger(list.children);
  };

  const renderBalanceCallout = () => {
    const slot = document.getElementById("balance-callout");
    clear(slot);
    const urgent = allLots()
      .filter(
        (entry) =>
          entry.lot.days_remaining !== null &&
          entry.lot.days_remaining <= RUNWAY_DAYS,
      )
      .sort(
        (left, right) => left.lot.days_remaining - right.lot.days_remaining,
      )[0];
    if (!urgent) return;
    const { program, lot } = urgent;
    const callout = node("button", "action-callout");
    callout.type = "button";
    const mark = node("span", "callout-mark");
    mark.appendChild(icon("clock"));
    callout.appendChild(mark);
    const copy = node("span", "callout-copy");
    copy.appendChild(text("small", "いま効く一手"));
    copy.appendChild(
      text(
        "strong",
        lot.extendable === true
          ? program.move.action
          : `${program.label}を使い切る`,
      ),
    );
    copy.appendChild(
      text(
        "span",
        `${program.label}・${lotClassLabels[lot.lot_class]} ${points(lot.quantity)}が、あと${lot.days_remaining}日で失効します。${
          lot.extendable === true
            ? program.move.detail
            : "この残高は期限を延ばせません"
        }。`,
      ),
    );
    callout.appendChild(copy);
    const go = node("span", "callout-go");
    go.appendChild(icon("arrow"));
    callout.appendChild(go);
    callout.addEventListener("click", () => {
      focusLotForSpending(program, lot);
    });
    slot.appendChild(callout);
  };

  const renderWallet = () => {
    renderBalanceHero();
    renderValuation();
    renderRunway();
    renderLotList();
    renderBalanceCallout();
  };
  const instrumentInputs = document.querySelectorAll(
    'input[name="instrument"]',
  );
  const amountInput = document.getElementById("amount-jpy");
  const merchantSelector = document.getElementById("merchant-selector");
  const syncMerchantContext = () => {
    const sevenEleven = merchantSelector.value === "merchant.seveneleven";
    document.getElementById("nanaco-route-fields").hidden = !sevenEleven;
    document.getElementById("branch-name").textContent = sevenEleven
      ? "東京エリア"
      : "通常の店舗";
    document.getElementById("merchant-support-note").textContent = sevenEleven
      ? "選択したサービスの通常還元率に、セブン‐イレブン固有のnanacoルートを加えて比較します。"
      : "選択したカードとモバイル決済の通常還元率で比較します。";
  };
  const syncInstrumentViews = () => {
    const checked = [...instrumentInputs].filter((input) => input.checked);
    const selectedPayments = [
      ...document.querySelectorAll("[data-p0-product]:checked"),
    ].filter((input) => {
      const kind = pointSpendOptions?.walletCatalogue.find(
        (item) => item.family_id === input.value,
      )?.kind;
      return kind === "credit_card" || kind === "mobile_pay";
    });
    document.getElementById("summary-instruments").textContent =
      `${selectedPayments.length}件を選択中`;
    document.getElementById("summary-meter").dataset.count = String(
      checked.length,
    );
  };

  const syncAmountSummary = () => {
    const amount = Number(amountInput.value);
    document.getElementById("summary-amount").textContent =
      Number.isSafeInteger(amount) && amount > 0
        ? `¥${amount.toLocaleString("ja-JP")}`
        : "¥—";
  };

  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.addEventListener("click", () => {
      activateTab(button.dataset.tabTarget);
    });
  });
  const tabOrder = ["balance", "spend", "earn", "information", "settings"];
  const tabButtons = tabOrder
    .map((tab) =>
      document.querySelector(`.bottom-nav [data-tab-target="${tab}"]`),
    )
    .filter(Boolean);
  tabButtons.forEach((button, index) => {
    button.id = `tab-button-${button.dataset.tabTarget}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `tab-${button.dataset.tabTarget}`);
    button.setAttribute("tabindex", index === 0 ? "0" : "-1");
    button.addEventListener("keydown", (event) => {
      if (
        ![
          "ArrowRight",
          "ArrowDown",
          "ArrowLeft",
          "ArrowUp",
          "Home",
          "End",
        ].includes(event.key)
      )
        return;
      event.preventDefault();
      const current = tabOrder.indexOf(button.dataset.tabTarget);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabOrder.length - 1
            : (current +
                (event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : -1) +
                tabOrder.length) %
              tabOrder.length;
      activateTab(tabOrder[next]);
      tabButtons[next]?.focus();
    });
  });
  document
    .getElementById("information-search")
    .addEventListener("input", renderInformationFacts);
  document
    .getElementById("information-family-filter")
    .addEventListener("change", renderInformationFacts);
  document
    .getElementById("wallet-reset-button")
    .addEventListener("click", () => {
      suppressWalletPersistence = true;
      document.querySelectorAll("[data-p0-product]").forEach((input) => {
        input.checked = false;
      });
      removeStoredWalletIds();
      walletHydrated = true;
      syncP0ProductPickers();
      suppressWalletPersistence = false;
      const status = document.getElementById("wallet-save-status");
      if (status)
        status.textContent =
          "保存した選択を削除しました。必要なサービスを選び直せます。";
    });
  document.querySelectorAll("[data-scroll-to]").forEach((button) => {
    button.addEventListener("click", () => {
      activateTab("earn");
      document
        .getElementById(button.dataset.scrollTo)
        .scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  amountInput.addEventListener("input", syncAmountSummary);
  merchantSelector.addEventListener("change", syncMerchantContext);
  syncInstrumentViews();
  syncAmountSummary();
  syncMerchantContext();
  activateTab("balance");

  document
    .getElementById("recommendation-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = document.getElementById("result");
      clear(result);
      const loadingTitle = text("h2", "支払い方を比較しています");
      loadingTitle.id = "result-title";
      result.appendChild(loadingTitle);
      result.appendChild(
        text("p", "入力条件から支払いルートを確認中です…", "helper"),
      );
      try {
        const body = await postJson(
          "/api/recommendations",
          collectUnifiedState(),
        );
        renderUnifiedRecommendation(body);
      } catch (error) {
        clear(result);
        const errorTitle = text("h2", "比較できませんでした");
        errorTitle.id = "result-title";
        result.appendChild(errorTitle);
        result.appendChild(
          text(
            "p",
            "入力内容を確認して、もう一度お試しください。",
            "error-panel",
          ),
        );
        result.appendChild(text("p", consumerErrorMessage(error), "error"));
      }
    });

  dropCurtain();
  renderWallet();
  void loadConsumerReference();
  void loadExperimentalRules();
  void loadPointSpendOptions();
})();
