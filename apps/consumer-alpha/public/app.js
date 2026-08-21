(() => {
  let currentRecommendationId = null;
  let sessionHistoryCount = 0;

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
    document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
      const active = panel.dataset.tabPanel === tabName;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    document
      .querySelectorAll(".bottom-nav [data-tab-target]")
      .forEach((button) => {
        const active = button.dataset.tabTarget === tabName;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  const renderPlan = (parent, title, plan, primary = false) => {
    const box = node(
      "div",
      primary ? "result-box primary-result" : "result-box",
    );
    box.appendChild(text("h3", title));
    if (!plan) {
      box.appendChild(text("p", "該当する支払い方はありません。"));
      parent.appendChild(box);
      return;
    }
    box.appendChild(text("p", planName(plan), "plan-name"));
    const score = node("p", "plan-score");
    score.appendChild(text("span", "デモ上の推定価値"));
    score.appendChild(
      text(
        "strong",
        plan.objective_score_jpy
          ? `${plan.objective_score_jpy} 円相当`
          : "算出対象外",
      ),
    );
    box.appendChild(score);
    const meta = node("div", "plan-meta");
    meta.appendChild(text("span", `手順 ${plan.operation_count}`, "pill"));
    meta.appendChild(text("span", `特典 ${plan.reward_count}`, "pill"));
    meta.appendChild(
      text("span", `保有残高 ${plan.ending_asset_count}`, "pill"),
    );
    box.appendChild(meta);
    parent.appendChild(box);
  };

  const renderLinks = (parent, ids) => {
    if (!ids || !ids.length) return;
    const section = node("div", "result-section");
    section.appendChild(text("h3", "デモ用リンク"));
    const list = node("div", "link-list");
    ids.forEach((linkId) => {
      if (!/^[a-z0-9_-]{1,80}$/.test(linkId)) return;
      const link = node("a");
      link.href = `/go/${encodeURIComponent(linkId)}`;
      link.textContent = "架空のポイントアプリを開く →";
      list.appendChild(link);
    });
    section.appendChild(list);
    parent.appendChild(section);
  };

  const recordSessionHistory = (view) => {
    if (!view.synthetic_only || !view.primary) return;
    const history = document.getElementById("session-history");
    if (sessionHistoryCount === 0) clear(history);
    const item = node("div", "history-item");
    item.appendChild(text("span", "↗", "history-icon"));
    const copy = node("div");
    copy.appendChild(text("strong", planName(view.primary)));
    copy.appendChild(text("small", "サンプルストア · このセッション"));
    item.appendChild(copy);
    item.appendChild(
      text(
        "em",
        view.primary.objective_score_jpy
          ? `${view.primary.objective_score_jpy} 円相当`
          : "比較済み",
      ),
    );
    history.insertBefore(item, history.firstChild);
    sessionHistoryCount += 1;
    document.getElementById("history-count").textContent =
      String(sessionHistoryCount);
    while (history.children.length > 10) history.lastElementChild.remove();
  };

  const renderRecommendation = (view) => {
    const result = document.getElementById("result");
    clear(result);
    const hero = node("div", "result-hero");
    hero.appendChild(
      text(
        "p",
        view.synthetic_only ? "デモデータでの比較結果" : "表示できない結果",
        "status",
      ),
    );
    const resultTitle = text(
      "h2",
      view.verification_status === "blocked"
        ? "この結果は表示できません"
        : view.conditional
          ? "まずは安全な候補が見つかりました"
          : "おすすめの支払い方が見つかりました",
    );
    resultTitle.id = "result-title";
    hero.appendChild(resultTitle);
    hero.appendChild(
      text(
        "p",
        view.conditional
          ? "質問に答えると、さらに詳しく比較できます。"
          : "入力した条件をもとに支払い方を比べました。",
        "result-summary",
      ),
    );
    result.appendChild(hero);
    const grid = node("div", "result-grid");
    renderPlan(grid, "いま選ぶなら", view.primary, true);
    if (view.fallback) renderPlan(grid, "次の候補", view.fallback);
    result.appendChild(grid);
    if (view.conditional)
      result.appendChild(
        text(
          "p",
          "まだ条件が確定していません。下の質問を確認してから選んでください。",
          "conditional-note",
        ),
      );
    if (view.conditional_alternatives?.length) {
      result.appendChild(text("h3", "条件によって変わる候補"));
      view.conditional_alternatives.forEach((alternative) => {
        renderPlan(result, "別の候補", alternative);
        appendList(result, "この候補になる条件", alternative.conditions);
      });
    }
    appendList(result, "確認するともっと正確になります", view.questions);
    appendList(result, "今回の前提", view.assumptions);
    if (view.sensitivities?.length) {
      const section = node("div", "result-section");
      section.appendChild(text("h3", "価値の変化による影響"));
      view.sensitivities.forEach((sensitivity) => {
        section.appendChild(
          text(
            "p",
            `${sensitivity.asset_id}：現在 ${sensitivity.current_jpy_per_unit} 円／切り替わる目安 ${sensitivity.break_even_jpy_per_unit} 円`,
          ),
        );
      });
      result.appendChild(section);
    }
    const freshness = node("div", "result-section");
    freshness.appendChild(text("h3", "データについて"));
    freshness.appendChild(
      text(
        "p",
        view.freshness.status === "synthetic_fixture"
          ? "架空の固定データを使用しています。現在の特典情報ではありません。"
          : "データの状態を確認できません。",
      ),
    );
    result.appendChild(freshness);
    renderLinks(result, view.deep_link_ids);
    currentRecommendationId =
      view.synthetic_only && view.primary ? view.request_id : null;
    recordSessionHistory(view);
    result.scrollIntoView({ behavior: "smooth", block: "start" });
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
        text("p", "デモデータを使って候補を計算中です…", "helper"),
      );
      try {
        const body = await postJson(
          "/api/synthetic/evaluate",
          collectManualState(),
        );
        renderRecommendation(body.recommendation);
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
})();
