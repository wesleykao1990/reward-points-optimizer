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

  const load = async () => {
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

  void load();
})();
