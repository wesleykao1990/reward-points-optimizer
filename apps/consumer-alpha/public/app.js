(() => {
  let sessionHistoryCount = 0;
  let informationFacts = [];
  let informationLoaded = false;
  let lotteryLinksLoaded = false;

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

  const clear = (element) => {
    while (element.firstChild) element.removeChild(element.firstChild);
  };

  const activateTab = (tabName) => {
    const validTabs = ["home", "wallet", "history", "information", "settings"];
    if (!validTabs.includes(tabName)) return;
    document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
      const active = panel.dataset.tabPanel === tabName;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
      panel.setAttribute("aria-hidden", String(!active));
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
    if (activePanel && activePanel.id !== "tab-home")
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
    const storedValueUse = document.getElementById("stored-value-use").value;
    const storedValueUsage =
      document.getElementById("stored-value-usage").value;
    const value = document.getElementById("stored-value-value").value.trim();
    const hasUsage = storedValueUse === "yes" && Boolean(storedValueUsage);
    const hasCustomValue = hasUsage && storedValueUsage === "custom" && value;
    return {
      // These identifiers are fixed by the host-owned synthetic catalogue;
      // the browser never submits editable aliases.
      merchant_id: "merchant.synthetic",
      branch_id: "location.synthetic",
      amount_jpy: Number(document.getElementById("amount-jpy").value),
      owned_instruments: instruments,
      stored_value_use: storedValueUse,
      ...(hasUsage
        ? {
            stored_value_usage: storedValueUsage,
            ...(hasCustomValue
              ? { stored_value_value_jpy_per_unit: value }
              : {}),
          }
        : {}),
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
        merchantId === "merchant.seveneleven"
          ? "location.seveneleven.representative"
          : "location.synthetic",
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
        "電子マネーを使うか未回答のため、その候補を保留しています。",
      "The host supplies the complete fixture rule and evidence set.":
        "デモ用のルールと根拠は安全なホスト側で管理しています。",
      "The user opted out of stored-value use for this run.":
        "今回は電子マネーを使わない設定です。",
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
      const item = node("li");
      item.textContent = translatedText(String(value));
      list.appendChild(item);
    });
    section.appendChild(list);
    parent.appendChild(section);
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

  const unifiedValidityLabels = Object.freeze({
    active: "有効期間：現在",
    scheduled: "有効期間：開始前",
    expired: "有効期間：終了",
    unknown: "有効期間：不明",
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

  const renderUnifiedRoute = (parent, route) => {
    if (!route || typeof route !== "object") return;
    const card = node("article", "unified-route-card");
    const header = node("div", "unified-route-header");
    header.appendChild(text("h3", String(route.label || "支払いルート")));
    const badges = node("div", "unified-route-badges");
    badges.appendChild(
      text(
        "span",
        route.kind === "calculation" ? "計算結果" : "情報表示",
        "route-kind-badge",
      ),
    );
    badges.appendChild(
      text(
        "span",
        unifiedStatusLabels[route.status] || "状態不明",
        `route-status-badge status-${String(route.status || "unknown")}`,
      ),
    );
    badges.appendChild(
      text(
        "span",
        unifiedValidityLabels[route.validity_state] || "有効期間：不明",
        "route-validity-badge",
      ),
    );
    header.appendChild(badges);
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
          text("span", "収録情報にもとづくルートです。金額換算はしません。"),
        );
        card.appendChild(planBox);
      }
      if (Array.isArray(plan.conditions) && plan.conditions.length)
        appendList(card, "このルートの条件", plan.conditions);
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
        document.getElementById("information-claim-filter").value = "";
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
    item.appendChild(text("span", "↗", "history-icon"));
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
    const result = document.getElementById("result");
    clear(result);
    const hero = node("div", "result-hero");
    hero.appendChild(text("p", "統合ルート比較", "status"));
    const title = text("h2", "支払いルートをまとめて確認しました");
    title.id = "result-title";
    hero.appendChild(title);
    hero.appendChild(
      text(
        "p",
        body.merchant_id === "merchant.seveneleven"
          ? "セブン‐イレブンで、選択したサービスの収録レートと店舗固有ルートを使って比較しています。"
          : "選択したカードとモバイル決済の通常還元率を使って比較しています。",
        "result-summary",
      ),
    );
    const selectedProducts = body.selected_p0_products.map(
      (familyId) =>
        pointSpendOptions.walletCatalogue.find(
          (item) => item.family_id === familyId,
        ).label,
    );
    if (selectedProducts.length)
      hero.appendChild(
        text(
          "p",
          `選択中：${selectedProducts.join("、")}`,
          "selected-products-summary",
        ),
      );
    result.appendChild(hero);
    const intro = node("p", "", "unified-disclosure");
    intro.textContent =
      "一つのルートの問題が、ほかの有効なルートを隠すことはありません。";
    result.appendChild(intro);
    const list = node("div", "unified-route-list");
    routes.forEach((route) => {
      renderUnifiedRoute(list, route);
    });
    result.appendChild(list);
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

  const renderExperimentalSnapshot = (snapshot) => {
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

  const loadExperimentalRules = async () => {
    try {
      const response = await fetch("/api/experimental/rules", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = await response.json();
      if (!response.ok) throw new Error("request_failed");
      renderExperimentalSnapshot(body);
    } catch {
      experimentalRulesMessage("ルート情報を読み込めませんでした。", "helper");
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
        typeof fact.family === "string" &&
        typeof fact.claim === "string" &&
        typeof fact.subject === "string" &&
        typeof fact.predicate === "string" &&
        typeof fact.summary === "string" &&
        typeof fact.use_in_comparison === "boolean",
    );
  };

  const appendInformationFilterOptions = () => {
    const family = document.getElementById("information-family-filter");
    const claim = document.getElementById("information-claim-filter");
    const previousFamily = family.value;
    const previousClaim = claim.value;
    clear(family);
    clear(claim);
    const allFamily = node("option");
    allFamily.value = "";
    allFamily.textContent = "すべて";
    family.appendChild(allFamily);
    const allClaim = node("option");
    allClaim.value = "";
    allClaim.textContent = "すべて";
    claim.appendChild(allClaim);
    [...new Set(informationFacts.map((fact) => fact.family))]
      .sort((left, right) => left.localeCompare(right, "ja"))
      .forEach((value) => {
        const option = node("option");
        option.value = value;
        option.textContent = value;
        family.appendChild(option);
      });
    [...new Set(informationFacts.map((fact) => fact.claim))]
      .sort((left, right) => left.localeCompare(right, "ja"))
      .forEach((value) => {
        const option = node("option");
        option.value = value;
        option.textContent = value;
        claim.appendChild(option);
      });
    family.value = [...family.options].some(
      (option) => option.value === previousFamily,
    )
      ? previousFamily
      : "";
    claim.value = [...claim.options].some(
      (option) => option.value === previousClaim,
    )
      ? previousClaim
      : "";
  };

  const renderInformationFacts = () => {
    const list = document.getElementById("information-facts");
    const search = document
      .getElementById("information-search")
      .value.trim()
      .toLocaleLowerCase("ja-JP");
    const family = document.getElementById("information-family-filter").value;
    const claim = document.getElementById("information-claim-filter").value;
    const visible = informationFacts.filter((fact) => {
      if (family && fact.family !== family) return false;
      if (claim && fact.claim !== claim) return false;
      if (!search) return true;
      return [
        fact.family,
        fact.claim,
        fact.subject,
        fact.predicate,
        fact.summary,
      ].some((value) => value.toLocaleLowerCase("ja-JP").includes(search));
    });
    document.getElementById("information-count").textContent =
      `${visible.length}件を表示（全${informationFacts.length}件）`;
    clear(list);
    if (visible.length === 0) {
      list.appendChild(
        text("p", "条件に合うポイント情報はありません。", "helper"),
      );
      return;
    }
    visible.forEach((fact) => {
      const card = node("article", "information-card");
      const header = node("div", "information-card-header");
      header.appendChild(text("span", fact.family, "information-family"));
      header.appendChild(text("span", fact.claim, "information-claim"));
      card.appendChild(header);
      card.appendChild(text("h3", fact.subject, "information-subject"));
      card.appendChild(text("p", fact.predicate, "information-predicate"));
      card.appendChild(text("p", fact.summary, "information-summary"));

      const actions = node("div", "information-card-actions");
      const label = node("label");
      label.appendChild(text("span", "誤っている内容"));
      const select = selectField(
        Object.entries(informationCategoryLabels).map(([value, labelText]) => ({
          value,
          label: labelText,
        })),
      );
      label.appendChild(select);
      actions.appendChild(label);
      const button = node("button", "secondary");
      button.type = "button";
      button.textContent = "誤りを報告する";
      actions.appendChild(button);
      card.appendChild(actions);
      const status = text("p", "", "information-status");
      card.appendChild(status);
      button.addEventListener("click", async () => {
        button.disabled = true;
        select.disabled = true;
        status.classList.remove("is-error");
        status.textContent = "報告を受け付けています…";
        try {
          const body = await postJson("/api/experimental/fact-corrections", {
            fact_key: fact.fact_key,
            category: select.value,
          });
          if (body?.correction?.accepted !== true) throw new Error("status");
          informationFacts = informationFacts.filter(
            (candidate) => candidate.fact_key !== fact.fact_key,
          );
          appendInformationFilterOptions();
          renderInformationFacts();
        } catch {
          button.disabled = false;
          select.disabled = false;
          status.classList.add("is-error");
          status.textContent =
            "報告を送れませんでした。もう一度お試しください。";
        }
      });
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
      document.getElementById("information-count").textContent = "";
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

  const loadLotteryLinks = async () => {
    if (lotteryLinksLoaded) return;
    const container = document.getElementById("lottery-links");
    try {
      const response = await fetch("/api/experimental/lotteries", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("request_failed");
      const links = safeLotteryLinks(await response.json());
      clear(container);
      links.forEach((item) => {
        const card = node("article", "lottery-link-card");
        const copy = node("div");
        copy.appendChild(text("small", item.family));
        copy.appendChild(text("strong", item.title));
        copy.appendChild(text("span", item.period_label));
        card.appendChild(copy);
        const link = node("a", "lottery-official-link");
        link.href = item.official_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent =
          item.status === "official_announcement"
            ? "公式告知を確認"
            : "公式ページで応募・詳細を確認";
        card.appendChild(link);
        container.appendChild(card);
      });
      if (links.length === 0)
        container.appendChild(
          text("p", "現在案内できる抽選情報はありません。", "helper"),
        );
      lotteryLinksLoaded = true;
    } catch {
      clear(container);
      container.appendChild(
        text("p", "公式キャンペーン情報を読み込めませんでした。", "helper"),
      );
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

  let pointSpendOptions = null;

  const safePointSpendOptions = (body) => {
    if (
      !body ||
      body.version !== "p0-point-spend-options.v2" ||
      body.experimental !== true ||
      !Number.isSafeInteger(body.rule_count) ||
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
        )
      )
        throw new Error("point_spend_options_invalid");
      return {
        rule_id: rule.rule_id,
        label: rule.label,
        source_asset_id: rule.source_asset_id,
        destination_asset_id: rule.destination_asset_id,
        conditions: [...rule.conditions],
      };
    });
    const walletCatalogue = body.wallet_catalogue.map((item) => {
      if (
        !item ||
        typeof item.family_id !== "string" ||
        !/^(?:point|wallet|card)\.[a-z0-9.-]{1,64}$/u.test(item.family_id) ||
        typeof item.label !== "string" ||
        item.label.length < 1 ||
        item.label.length > 48 ||
        !["point", "mobile_pay", "credit_card"].includes(item.kind) ||
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
    return {
      assets,
      conditionalRules,
      walletCatalogue,
      rule_count: body.rule_count,
    };
  };

  const renderP0WalletCatalogue = () => {
    const container = document.getElementById("p0-wallet-catalogue");
    clear(container);
    if (!pointSpendOptions) {
      container.appendChild(
        text("p", "サービス一覧を読み込めませんでした。", "helper"),
      );
      return;
    }
    const groups = [
      ["point", "ポイント・マイル", "P"],
      ["mobile_pay", "モバイル決済", "▦"],
      ["credit_card", "クレジットカード", "▰"],
    ];
    groups.forEach(([kind, heading, icon]) => {
      const items = pointSpendOptions.walletCatalogue.filter(
        (item) => item.kind === kind,
      );
      if (items.length === 0) return;
      const section = node("section", "p0-wallet-family-group");
      section.appendChild(text("h3", `${heading}（${items.length}）`));
      const list = node("div", "p0-wallet-family-list");
      items.forEach((item) => {
        const card = node("article", "p0-wallet-family-card");
        card.appendChild(text("span", icon, "p0-wallet-family-icon"));
        const copy = node("span", "p0-wallet-family-copy");
        copy.appendChild(text("strong", item.label));
        copy.appendChild(text("small", `関連情報 ${item.fact_count}件`));
        card.appendChild(copy);
        list.appendChild(card);
      });
      section.appendChild(list);
      container.appendChild(section);
    });
    document.getElementById("wallet-count").textContent = String(
      pointSpendOptions.walletCatalogue.length,
    );
    document.getElementById("wallet-route-summary").textContent =
      "選んだサービスの比較とポイント交換の試算に使います";
  };

  const p0PickerDefinitions = Object.freeze([
    {
      kind: "credit_card",
      containerId: "p0-card-picker",
      toggleId: "p0-card-toggle",
      requiredMessage: "クレジットカードを1つ以上選んでください。",
    },
    {
      kind: "mobile_pay",
      containerId: "p0-mobile-pay-picker",
      toggleId: "p0-mobile-pay-toggle",
      requiredMessage: "利用中のモバイル決済を1つ以上選んでください。",
    },
    {
      kind: "point",
      containerId: "p0-point-picker",
      toggleId: "p0-point-toggle",
      requiredMessage: "保有するポイントプログラムを1つ以上選んでください。",
    },
  ]);

  const selectedP0Products = (required = false) => {
    const selected = [...document.querySelectorAll("[data-p0-product]:checked")]
      .filter((input) => !input.disabled)
      .map((input) => input.value)
      .sort();
    if (required) {
      for (const definition of p0PickerDefinitions) {
        const toggle = document.getElementById(definition.toggleId);
        if (
          toggle.checked &&
          !selected.some(
            (value) =>
              pointSpendOptions?.walletCatalogue.find(
                (item) => item.family_id === value,
              )?.kind === definition.kind,
          )
        ) {
          const status = document.getElementById("p0-selection-status");
          status.textContent = definition.requiredMessage;
          status.classList.add("is-error");
          document.getElementById(definition.containerId).scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
          throw new Error("p0_product_selection_required");
        }
      }
    }
    return selected;
  };

  const syncP0ProductPickers = () => {
    p0PickerDefinitions.forEach((definition) => {
      const toggle = document.getElementById(definition.toggleId);
      const container = document.getElementById(definition.containerId);
      container.hidden = !toggle.checked;
      container.querySelectorAll("[data-p0-product]").forEach((input) => {
        input.disabled = !toggle.checked;
        if (!toggle.checked) input.checked = false;
      });
    });
    const selected = selectedP0Products();
    const status = document.getElementById("p0-selection-status");
    status.classList.remove("is-error");
    const missing = p0PickerDefinitions.find((definition) => {
      const toggle = document.getElementById(definition.toggleId);
      return (
        toggle.checked &&
        !selected.some(
          (value) =>
            pointSpendOptions?.walletCatalogue.find(
              (item) => item.family_id === value,
            )?.kind === definition.kind,
        )
      );
    });
    status.textContent = missing
      ? missing.requiredMessage
      : selected.length
        ? `${selected.length}サービスを選択しています。選択内容は保存されません。`
        : "比較するサービスを選んでください。";
  };

  const renderP0ProductPickers = () => {
    if (!pointSpendOptions) return;
    p0PickerDefinitions.forEach((definition) => {
      const container = document.getElementById(definition.containerId);
      clear(container);
      pointSpendOptions.walletCatalogue
        .filter((item) => item.kind === definition.kind)
        .forEach((item) => {
          const label = node("label", "p0-product-option");
          const checkbox = node("input");
          checkbox.type = "checkbox";
          checkbox.value = item.family_id;
          checkbox.dataset.p0Product = "true";
          checkbox.addEventListener("change", syncP0ProductPickers);
          const copy = node("span");
          copy.appendChild(text("strong", item.label));
          copy.appendChild(text("small", `関連情報 ${item.fact_count}件`));
          label.appendChild(checkbox);
          label.appendChild(copy);
          container.appendChild(label);
        });
    });
    syncP0ProductPickers();
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
      const label = node("label", "point-spend-check");
      const checkbox = node("input");
      checkbox.type = "checkbox";
      checkbox.value = rule.rule_id;
      checkbox.dataset.pointSpendConfirmation = "true";
      const copy = node("span");
      copy.appendChild(text("b", rule.label));
      copy.appendChild(text("small", rule.conditions.join("・")));
      label.appendChild(checkbox);
      label.appendChild(copy);
      container.appendChild(label);
    });
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
      const target = document.getElementById("point-spend-target");
      clear(source);
      clear(target);
      pointSpendOptions.assets.forEach((asset) => {
        source.appendChild(pointSpendSelectOption(asset));
        target.appendChild(pointSpendSelectOption(asset));
      });
      source.value = pointSpendOptions.assets.some(
        (asset) => asset.asset_id === "asset.point.rakuten",
      )
        ? "asset.point.rakuten"
        : pointSpendOptions.assets[0]?.asset_id || "";
      target.value = pointSpendOptions.assets.some(
        (asset) => asset.asset_id === "asset.mile.ana",
      )
        ? "asset.mile.ana"
        : pointSpendOptions.assets[1]?.asset_id || "";
      renderP0WalletCatalogue();
      renderP0ProductPickers();
      renderPointSpendConditions();
      clear(result);
      result.appendChild(
        text(
          "p",
          `${pointSpendOptions.rule_count}件の固定比率ルートを比較できます。`,
          "helper",
        ),
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
    card.appendChild(
      text(
        "p",
        `${route.processing_days}・交換元の残り ${route.residual_source_amount}`,
        "helper",
      ),
    );
    const steps = node("ol", "point-spend-steps");
    route.steps.forEach((step) => {
      const item = node("li");
      item.appendChild(text("strong", step.label));
      item.appendChild(
        text(
          "span",
          `${step.source_amount} ${step.source_label} → ${step.destination_amount} ${step.destination_label}`,
        ),
      );
      item.appendChild(text("small", step.processing_days));
      steps.appendChild(item);
    });
    card.appendChild(steps);
    return card;
  };

  document
    .getElementById("point-spend-source")
    .addEventListener("change", renderPointSpendConditions);
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
        const body = await postJson(
          "/api/experimental/point-spend/recommendation",
          {
            source_asset_id:
              document.getElementById("point-spend-source").value,
            target_asset_id:
              document.getElementById("point-spend-target").value,
            balance: Number(
              document.getElementById("point-spend-balance").value,
            ),
            objective: document.getElementById("point-spend-objective").value,
            effective_at: new Date().toISOString(),
            confirmed_rule_ids: confirmed,
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

  const storedValueUse = document.getElementById("stored-value-use");
  const storedValueUsage = document.getElementById("stored-value-usage");
  const storedValueValue = document.getElementById("stored-value-value");
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
  const updateStoredValueControls = () => {
    const optedIn = storedValueUse.value === "yes";
    storedValueUsage.disabled = !optedIn;
    storedValueValue.disabled = !optedIn || storedValueUsage.value !== "custom";
  };
  storedValueUse.addEventListener("change", updateStoredValueControls);
  storedValueUsage.addEventListener("change", updateStoredValueControls);

  const syncInstrumentViews = () => {
    const checked = [...instrumentInputs].filter((input) => input.checked);
    document.getElementById("summary-instruments").textContent =
      `支払い方法 ${checked.length}つ`;
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
  const tabOrder = ["home", "wallet", "history", "information", "settings"];
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
    .getElementById("information-claim-filter")
    .addEventListener("change", renderInformationFacts);
  document
    .getElementById("information-reload")
    .addEventListener("click", () => {
      void loadExperimentalRules();
      void loadInformationFacts(true);
    });
  document.querySelectorAll("[data-scroll-to]").forEach((button) => {
    button.addEventListener("click", () => {
      activateTab("home");
      document
        .getElementById(button.dataset.scrollTo)
        .scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  instrumentInputs.forEach((input) => {
    input.addEventListener("change", () => {
      syncInstrumentViews();
      syncP0ProductPickers();
    });
  });
  document
    .getElementById("p0-point-toggle")
    .addEventListener("change", syncP0ProductPickers);
  document.querySelectorAll("[data-usage-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const storedValueInput = [...instrumentInputs].find(
        (input) => input.value === "synthetic_stored_value",
      );
      storedValueInput.checked = true;
      storedValueUse.value = "yes";
      storedValueUsage.value = button.dataset.usagePreset;
      updateStoredValueControls();
      syncInstrumentViews();
      document.querySelectorAll("[data-usage-preset]").forEach((option) => {
        option.classList.toggle("is-active", option === button);
      });
      document.getElementById("settings-status").textContent =
        "ホームの比較条件に反映しました（保存はされません）";
    });
  });
  amountInput.addEventListener("input", syncAmountSummary);
  merchantSelector.addEventListener("change", syncMerchantContext);
  updateStoredValueControls();
  syncInstrumentViews();
  syncAmountSummary();
  syncMerchantContext();
  activateTab("home");

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
        result.appendChild(
          text(
            "p",
            error instanceof Error ? error.message : "request_failed",
            "error",
          ),
        );
      }
    });

  void loadExperimentalRules();
  void loadPointSpendOptions();
})();
