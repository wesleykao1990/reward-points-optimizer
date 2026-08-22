(() => {
  let currentRecommendationId = null;
  let sessionHistoryCount = 0;
  let informationFacts = [];
  let informationLoaded = false;

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
    if (tabName === "information") void loadInformationFacts();
  };

  const addLabel = (parent, labelText, input) => {
    const label = node("label");
    label.appendChild(text("span", labelText));
    label.appendChild(input);
    parent.appendChild(label);
    return label;
  };

  const inputField = (type, value, maxLength) => {
    const input = node("input");
    input.type = type;
    input.value = value || "";
    input.maxLength = maxLength || 48;
    input.autocomplete = "off";
    return input;
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

  const addFactRow = () => {
    const list = document.getElementById("facts-list");
    const row = node("div", "entry-row");
    const key = inputField("text", "", 48);
    key.placeholder = "例：campaign.enrolled";
    const status = selectField([
      { value: "unknown", label: "不明" },
      { value: "known", label: "わかっている" },
    ]);
    const value = inputField("text", "", 160);
    value.placeholder = "内容";
    value.disabled = true;
    status.addEventListener("change", () => {
      value.disabled = status.value !== "known";
    });
    addLabel(row, "条件キー", key);
    addLabel(row, "状態", status);
    addLabel(row, "内容", value);
    const remove = node("button", "remove");
    remove.type = "button";
    remove.textContent = "削除";
    remove.addEventListener("click", () => {
      row.remove();
    });
    row.appendChild(remove);
    list.appendChild(row);
  };

  const addCapRow = () => {
    const list = document.getElementById("caps-list");
    const row = node("div", "entry-row");
    const key = inputField("text", "", 48);
    key.placeholder = "例：monthly.cap";
    const status = selectField([
      { value: "unknown", label: "不明" },
      { value: "known", label: "わかっている" },
    ]);
    const spend = inputField("number", "", 16);
    spend.min = "0";
    spend.max = "10000000";
    spend.step = "1";
    spend.placeholder = "利用済み金額";
    spend.disabled = true;
    status.addEventListener("change", () => {
      spend.disabled = status.value !== "known";
    });
    addLabel(row, "上限キー", key);
    addLabel(row, "状態", status);
    addLabel(row, "利用済み（円）", spend);
    const remove = node("button", "remove");
    remove.type = "button";
    remove.textContent = "削除";
    remove.addEventListener("click", () => {
      row.remove();
    });
    row.appendChild(remove);
    list.appendChild(row);
  };

  const collectEntries = (listId, type) => {
    const rows = document.getElementById(listId).children;
    const result = [];
    for (let index = 0; index < rows.length; index += 1) {
      const fields = rows[index].querySelectorAll("input, select");
      const key = fields[0].value.trim();
      const status = fields[1].value;
      if (!key) continue;
      if (type === "fact") {
        result.push({
          key,
          status,
          ...(status === "known" ? { value: fields[2].value.trim() } : {}),
        });
      } else {
        result.push({
          key,
          status,
          ...(status === "known" ? { spend_jpy: Number(fields[2].value) } : {}),
        });
      }
    }
    return result;
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
      facts: collectEntries("facts-list", "fact"),
      caps: collectEntries("caps-list", "cap"),
    };
  };

  const collectUnifiedState = () => {
    const manual = collectManualState();
    const amount = Number(document.getElementById("amount-jpy").value);
    const numericValueOr = (id, fallback) => {
      const value = Number(document.getElementById(id)?.value);
      return Number.isFinite(value) ? value : fallback;
    };
    return {
      ...manual,
      merchant_id: "merchant.synthetic",
      branch_id: "location.synthetic",
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
    if (plan.plan_id === "plan_synthetic_direct_card")
      return "カードでそのまま支払う";
    if (plan.plan_id === "plan_synthetic_topup_then_pay")
      return "電子マネーにチャージして支払う";
    return "比較で選ばれた支払い方";
  };

  const renderFactInfluence = (parent, influence) => {
    if (
      !influence ||
      influence.version !== "p0-fact-influence-graph.v1" ||
      influence.fact_count !== 364 ||
      !Array.isArray(influence.factors)
    )
      return;
    const graphRoleLabels = Object.freeze({
      applied: "適用候補",
      constraint: "条件候補・要確認",
      question: "確認が必要",
      warning: "注意",
      information: "参考情報",
    });
    const section = node("section", "result-section fact-influence");
    section.appendChild(text("h3", "判定に使った情報"));
    const factors = influence.factors.filter(
      (factor) =>
        factor &&
        typeof factor === "object" &&
        typeof factor.factor_id === "string" &&
        typeof factor.family === "string" &&
        typeof factor.claim === "string" &&
        typeof factor.influence_kind === "string" &&
        typeof factor.graph_role === "string" &&
        Object.hasOwn(graphRoleLabels, factor.graph_role) &&
        typeof factor.summary === "string" &&
        typeof factor.active === "boolean" &&
        typeof factor.applied === "boolean" &&
        (factor.information === null || typeof factor.information === "string"),
    );
    const appliedCount = factors.filter(
      (factor) => factor.applied === true,
    ).length;
    section.appendChild(
      text(
        "p",
        `登録情報 ${influence.fact_count}件・今回の条件に関連 ${Number(influence.relevant_count) || 0}件・判定に反映 ${appliedCount}件`,
      ),
    );
    if (factors.length) {
      const roleSummary = node("div", "fact-role-summary");
      Object.entries(graphRoleLabels).forEach(([role, label]) => {
        const count = factors.filter(
          (factor) =>
            factor.graph_role === role &&
            (role !== "applied" || factor.applied === true),
        ).length;
        if (!count) return;
        roleSummary.appendChild(
          text("span", `${label} ${count}件`, `fact-role-badge role-${role}`),
        );
      });
      section.appendChild(roleSummary);
    }
    const applied = factors.filter((factor) => factor.applied === true);
    if (applied.length) {
      const appliedSection = node("div", "fact-influence-group");
      appliedSection.appendChild(text("h4", "判定に反映した情報"));
      const list = node("ul");
      applied.slice(0, 24).forEach((factor) => {
        const item = node("li");
        item.appendChild(text("strong", `${factor.family}・${factor.claim}`));
        item.appendChild(text("span", `：${factor.summary}`));
        list.appendChild(item);
      });
      appliedSection.appendChild(list);
      section.appendChild(appliedSection);
    } else {
      section.appendChild(
        text(
          "p",
          "今回の候補に直接使える計算ルールはありません。数値の特典は推定していません。",
          "helper",
        ),
      );
    }
    const unresolved = Array.isArray(influence.unresolved_conditions)
      ? influence.unresolved_conditions.filter(
          (value) => typeof value === "string" && value.length > 0,
        )
      : [];
    if (unresolved.length) {
      const unresolvedSection = node("div", "fact-influence-group");
      unresolvedSection.appendChild(text("h4", "未解決の条件"));
      const list = node("ul");
      unresolved.slice(0, 24).forEach((value) => {
        list.appendChild(text("li", value));
      });
      unresolvedSection.appendChild(list);
      section.appendChild(unresolvedSection);
    }
    if (factors.length) {
      const details = node("details", "fact-influence-details");
      details.appendChild(text("summary", "関連情報の内訳"));
      const list = node("ul");
      factors.slice(0, 96).forEach((factor) => {
        const item = node("li");
        const itemHeader = node("div", "fact-item-header");
        const roleLabel =
          factor.graph_role === "applied" && factor.applied === true
            ? "判定に反映"
            : graphRoleLabels[factor.graph_role];
        itemHeader.appendChild(
          text("span", roleLabel, `fact-role-badge role-${factor.graph_role}`),
        );
        itemHeader.appendChild(
          text("strong", `${factor.family}・${factor.claim}`),
        );
        item.appendChild(itemHeader);
        item.appendChild(
          text(
            "span",
            `：${factor.summary}${factor.active ? "" : "（現在は対象外）"}`,
          ),
        );
        const roleMessage =
          factor.question || factor.warning || factor.information;
        if (roleMessage) item.appendChild(text("small", roleMessage));
        list.appendChild(item);
      });
      details.appendChild(list);
      section.appendChild(details);
    }
    parent.appendChild(section);
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
        const score = plan.objective_score_jpy
          ? `${plan.objective_score_jpy} 円相当`
          : "金額換算なし";
        planBox.appendChild(text("span", score));
        card.appendChild(planBox);
      } else {
        const planBox = node("div", "unified-route-plan");
        const reward =
          typeof plan.reward_points === "string" ? plan.reward_points : "0";
        planBox.appendChild(text("strong", `nanacoポイント ${reward}ポイント`));
        planBox.appendChild(
          text("span", "実データ・未検証の情報表示。金額換算はしません。"),
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
    if (route.fact_influence) renderFactInfluence(card, route.fact_influence);
    if (
      typeof route.recommendation_id === "string" &&
      /^sha256:[0-9a-f]{64}$/u.test(route.recommendation_id)
    ) {
      const actions = node("div", "route-actions");
      const correction = node("button", "secondary");
      correction.type = "button";
      correction.textContent = "このルートを訂正する";
      const status = text("p", "", "route-correction-status");
      correction.addEventListener("click", async () => {
        correction.disabled = true;
        status.textContent = "訂正メモを作成しています…";
        try {
          const body = await postJson("/api/recommendations/corrections", {
            category: "wrong_plan",
            note_code: "plan_not_available",
            recommendation_id: route.recommendation_id,
          });
          if (body?.correction?.status !== "not_submitted")
            throw new Error("correction_failed");
          status.textContent =
            "訂正メモを作成しました（送信・保存されません）。";
        } catch {
          correction.disabled = false;
          status.textContent = "訂正メモを作成できませんでした。";
        }
      });
      actions.appendChild(correction);
      actions.appendChild(status);
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
    const routes = Array.isArray(body?.routes) ? body.routes : [];
    if (!routes.length) throw new Error("routes_invalid");
    currentRecommendationId =
      routes.find((route) => typeof route?.recommendation_id === "string")
        ?.recommendation_id || null;
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
        "計算結果と、実データ・未検証の情報表示を分けて表示しています。",
        "result-summary",
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
    section.appendChild(text("h4", "nanaco先行実験を試す"));
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
    submit.textContent = "先行実験を計算する";
    form.appendChild(submit);
    const output = text("p", "", "nanaco-experimental-output");
    form.appendChild(output);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      output.classList.remove("is-error");
      output.textContent = "先行実験を計算しています…";
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
          output.textContent =
            "先行実験：現在の条件では有効な計画がありません。";
        } else {
          const winner = recommendation.winner;
          output.textContent = `先行実験（未検証）：nanacoポイント ${winner?.reward_points || "0"}ポイント。金額換算は表示しません。`;
        }
      } catch {
        output.classList.add("is-error");
        output.textContent =
          "先行実験を実行できませんでした。現在の情報が有効か確認してください。";
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
      output.textContent = "先行実験を計算しています…";
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
          output.textContent =
            "先行実験：現在の条件では有効な計画がありません。";
        } else {
          const winner = recommendation.winner;
          output.textContent = `先行実験（未検証）：チャージ後残高 ¥${recommendation.nanaco_balance_after_jpy.toLocaleString("ja-JP")}, nanacoポイント ${winner?.reward_points || "0"}ポイント。金額換算は表示しません。`;
        }
      } catch {
        output.classList.add("is-error");
        output.textContent =
          "先行実験を実行できませんでした。チャージ条件と現在の情報が有効か確認してください。";
      } finally {
        submit.disabled = false;
      }
    });
    section.appendChild(form);
    card.appendChild(section);
  };

  const renderExperimentalSnapshot = (snapshot) => {
    const list = document.getElementById("experimental-rules");
    clear(list);
    const rules =
      snapshot && Array.isArray(snapshot.rules) ? snapshot.rules : [];
    const partial = snapshot?.status === "partial";
    if (!Array.isArray(rules) || rules.length === 0) {
      list.appendChild(
        text(
          "p",
          partial
            ? "一部のデータを読み込めませんでした。表示できる先行公開データはありません。"
            : "現在、表示できる先行公開データはありません。",
          "helper",
        ),
      );
      return;
    }
    if (partial)
      list.appendChild(
        text("p", "一部の先行公開データを表示しています。", "helper"),
      );
    rules.forEach((rule) => {
      if (!rule || typeof rule !== "object") return;
      const publicationId =
        typeof rule.publication_id === "string" ? rule.publication_id : "";
      if (!publicationId) return;
      const card = node("article", "experimental-card");
      const header = node("div", "experimental-card-header");
      const title = text(
        "h3",
        typeof rule.title === "string" ? rule.title : "先行公開データ",
      );
      header.appendChild(title);
      header.appendChild(text("span", "先行公開", "experimental-badge"));
      card.appendChild(header);

      const claim =
        typeof rule.summary === "string"
          ? rule.summary
          : "先行公開データです。";
      card.appendChild(text("p", claim, "experimental-card-claim"));

      const meta = node("div", "experimental-card-meta");
      meta.appendChild(
        text("span", `種類：${experimentalKindLabels[rule.kind] || "その他"}`),
      );
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
      renderNanacoExperimentalInteraction(card, publicationId);
      renderNanacoCreditChargeInteraction(card, publicationId);

      const actions = node("div", "experimental-card-actions");
      const label = node("label");
      label.appendChild(text("span", "内容を訂正する"));
      const select = selectField(
        Object.entries(experimentalCategoryLabels).map(
          ([value, labelText]) => ({
            value,
            label: labelText,
          }),
        ),
      );
      label.appendChild(select);
      actions.appendChild(label);
      const button = node("button", "secondary");
      button.type = "button";
      button.textContent = "この情報を訂正する";
      actions.appendChild(button);
      card.appendChild(actions);
      const status = text("p", "", "experimental-status");
      card.appendChild(status);

      button.addEventListener("click", async () => {
        button.disabled = true;
        select.disabled = true;
        status.classList.remove("is-error");
        status.textContent = "お知らせを受け付けています…";
        try {
          const body = await postJson("/api/experimental/corrections", {
            publication_id: publicationId,
            category: select.value,
          });
          if (body?.correction?.accepted !== true) throw new Error("status");
          card.remove();
          if (!list.querySelector(".experimental-card")) {
            experimentalRulesMessage(
              "お知らせを受け付けました。このカードを非表示にしました。",
              "experimental-status",
            );
          }
        } catch {
          button.disabled = false;
          select.disabled = false;
          status.classList.add("is-error");
          status.textContent =
            "訂正を反映できませんでした。もう一度お試しください。";
        }
      });
      list.appendChild(card);
    });
    if (!list.querySelector(".experimental-card"))
      experimentalRulesMessage(
        "現在、表示できる先行公開データはありません。",
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
      experimentalRulesMessage(
        "先行公開データを読み込めませんでした。",
        "helper",
      );
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
      card.appendChild(
        text(
          "p",
          fact.use_in_comparison
            ? "この情報は比較に使用しています。"
            : "この情報は比較には使用していません。",
          fact.use_in_comparison
            ? "information-usage is-active"
            : "information-usage",
        ),
      );
      const statusText = fact.use_in_comparison
        ? "状態：計算に使用"
        : /終了|過去|現在は対象外|適用期間外/iu.test(
              `${fact.claim} ${fact.summary}`,
            )
          ? "状態：適用期間外"
          : "状態：参考情報（計算には不使用）";
      card.appendChild(
        text(
          "p",
          statusText,
          fact.use_in_comparison
            ? "information-fact-status is-calculation"
            : statusText.includes("期間外")
              ? "information-fact-status is-inactive"
              : "information-fact-status is-advisory",
        ),
      );

      const actions = node("div", "information-card-actions");
      const label = node("label");
      label.appendChild(text("span", "内容を訂正する"));
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
      button.textContent = "この情報を訂正する";
      actions.appendChild(button);
      card.appendChild(actions);
      const status = text("p", "", "information-status");
      card.appendChild(status);
      button.addEventListener("click", async () => {
        button.disabled = true;
        select.disabled = true;
        status.classList.remove("is-error");
        status.textContent = "訂正を受け付けています…";
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
            "訂正を反映できませんでした。もう一度お試しください。";
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

  document.getElementById("add-fact").addEventListener("click", addFactRow);
  document.getElementById("add-cap").addEventListener("click", addCapRow);
  const storedValueUse = document.getElementById("stored-value-use");
  const storedValueUsage = document.getElementById("stored-value-usage");
  const storedValueValue = document.getElementById("stored-value-value");
  const instrumentInputs = document.querySelectorAll(
    'input[name="instrument"]',
  );
  const amountInput = document.getElementById("amount-jpy");
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
    document.getElementById("wallet-count").textContent = String(
      checked.length,
    );
    document.getElementById("summary-meter").dataset.count = String(
      checked.length,
    );
    document.querySelectorAll("[data-wallet-instrument]").forEach((button) => {
      const input = [...instrumentInputs].find(
        (candidate) => candidate.value === button.dataset.walletInstrument,
      );
      const active = Boolean(input?.checked);
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.querySelector("em").textContent = active ? "比較対象" : "未選択";
    });
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
    .addEventListener("click", () => void loadInformationFacts(true));
  document.querySelectorAll("[data-scroll-to]").forEach((button) => {
    button.addEventListener("click", () => {
      activateTab("home");
      document
        .getElementById(button.dataset.scrollTo)
        .scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  instrumentInputs.forEach((input) => {
    input.addEventListener("change", syncInstrumentViews);
  });
  document.querySelectorAll("[data-wallet-instrument]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = [...instrumentInputs].find(
        (candidate) => candidate.value === button.dataset.walletInstrument,
      );
      if (!input) return;
      input.checked = !input.checked;
      syncInstrumentViews();
    });
  });
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
  updateStoredValueControls();
  syncInstrumentViews();
  syncAmountSummary();
  activateTab("home");
  addFactRow();
  addCapRow();

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

  document
    .getElementById("correction-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.getElementById("correction-status");
      if (!currentRecommendationId) {
        status.textContent =
          "先にデモ結果を表示してから、一時メモを作成してください。";
        return;
      }
      status.textContent = "一時メモを作成しています…";
      try {
        const body = await postJson("/api/corrections/draft", {
          category: document.getElementById("correction-category").value,
          note_code: document.getElementById("correction-note-code").value,
          recommendation_id: currentRecommendationId,
        });
        const draft = body.correction;
        status.textContent = `一時メモ ${draft.correction_id} を作成しました。送信されず、このページを閉じると消えます。`;
      } catch {
        status.textContent = "一時メモを作成できませんでした。";
      }
    });

  void loadExperimentalRules();
})();
