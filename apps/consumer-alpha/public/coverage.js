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

  // Liquid Glass assets use the physical ID-1 card ratio 85.60:53.98.
  // Everything outside the rounded card remains transparent.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const CARD_VIEWBOX = "0 0 856 540";
  let assetInstance = 0;

  const SERVICE_SPECS = new Map([
    ["point.d", ["d POINT", "d", "#f8f9fb", "#d9dce2", "#d70032", "#161616"]],
    ["point.jre", ["JRE POINT", "JRE", "#f6f8f7", "#dfe8e2", "#11823b", "#102719"]],
    ["point.nanaco", ["nanaco Points", "7", "#f8f8f7", "#e9e8e4", "#f28a19", "#26211c"]],
    ["point.paypay", ["PayPay Points", "P", "#fff7f8", "#e8eaee", "#ff003c", "#252122"]],
    ["point.ponta", ["Ponta", "P", "#fff6e6", "#ffd189", "#ef7d00", "#3d2711"]],
    ["point.rakuten", ["Rakuten Point", "R", "#fff9fa", "#e7e9ee", "#bf0000", "#231b1c"]],
    ["point.v", ["V Point", "V", "#f7fbf9", "#e2ebe8", "#16a44a", "#151e1a"]],
    ["point.waon", ["WAON POINT", "W", "#fbf8fd", "#e8dff0", "#7b3f98", "#221a27"]],
    ["wallet.aeonpay", ["AEON Pay", "A", "#f9f5ff", "#e5d7f4", "#7b2f8e", "#2b1630"]],
    ["wallet.aupay", ["au PAY", "au", "#fff6ed", "#ffd2ad", "#e85a00", "#3a2114"]],
    ["wallet.dbarai", ["d払い", "d", "#fff7f8", "#e9eaed", "#d70032", "#171717"]],
    ["wallet.famipay", ["FamiPay", "F", "#f5fbf7", "#dceee6", "#159447", "#163429"]],
    ["wallet.paypay", ["PayPay", "P", "#ff244e", "#ad001f", "#ff003c", "#ffffff"]],
    ["wallet.rakutenpay", ["Rakuten Pay", "R", "#d9133d", "#860019", "#bf0000", "#ffffff"]],
    ["point.moppy", ["Moppy", "M", "#fff8ed", "#ffd79e", "#ee8200", "#42250d"]],
    ["point.saison", ["Saison Permanent", "S", "#f7f9ff", "#dfe7fb", "#114fa3", "#18243a"]],
    ["point.saison-permanent", ["Saison Permanent", "S", "#f7f9ff", "#dfe7fb", "#114fa3", "#18243a"]],
    ["point.jr-kyupo", ["JR Kyupo", "JR", "#f5fbf8", "#dcece5", "#0d824f", "#143328"]],
    ["point.seven-mile", ["Seven Mile", "7i", "#fff7f0", "#ffe0c2", "#f36c21", "#302014"]],
    ["storedvalue.suica", ["Suica", "Su", "#f3faf6", "#d7eadf", "#1ca14d", "#143023"]],
    ["transit.suica", ["Suica", "Su", "#f3faf6", "#d7eadf", "#1ca14d", "#143023"]],
    ["wallet.anapay", ["ANA Pay", "ANA", "#f2f7ff", "#d9e7fb", "#0a4fa3", "#102945"]],
    ["wallet.kyash", ["Kyash", "K", "#fff4f7", "#fadce4", "#e31962", "#3c1422"]],
    ["wallet.revolut", ["Revolut", "R", "#f6f7fb", "#dfe2eb", "#121826", "#121826"]],
    ["wallet.revolut-jp", ["Revolut", "R", "#f6f7fb", "#dfe2eb", "#121826", "#121826"]],
    ["mile.ana", ["ANA Mileage Club", "ANA", "#f2f7ff", "#d8e7fa", "#0c4c9b", "#112942"]],
    ["mile.jal", ["JAL Mileage Bank", "JAL", "#fff6f6", "#ebe8e8", "#d71920", "#2c2020"]],
    ["portal.jal-mileage-park", ["JAL Mileage Park", "JAL", "#fff6f6", "#ebe8e8", "#d71920", "#2c2020"]],
    ["emoney.nanaco", ["nanaco", "7", "#f8f8f7", "#e9e8e4", "#f28a19", "#26211c"]],
    ["emoney.waon", ["WAON", "W", "#fbf8fd", "#e8dff0", "#7b3f98", "#221a27"]],
    ["storedvalue.nanaco", ["nanaco", "7", "#f8f8f7", "#e9e8e4", "#f28a19", "#26211c"]],
    ["storedvalue.waon", ["WAON", "W", "#fbf8fd", "#e8dff0", "#7b3f98", "#221a27"]],
  ].map(([id, values]) => [
    id,
    {
      id,
      name: values[0],
      mark: values[1],
      top: values[2],
      bottom: values[3],
      accent: values[4],
      text: values[5],
      kind: "service",
    },
  ]));

  const CARD_REPRESENTATIVES = Object.freeze({
    "card.aeon": {
      id: "instrument.card.aeon",
      name: "AEON Card",
      issuer: "AEON Financial Service",
      category: "mainstream",
    },
    "card.aupay": {
      id: "instrument.card.au-pay-card",
      name: "au PAY Card",
      issuer: "au Financial Service",
      category: "mainstream",
    },
    "card.d": {
      id: "instrument.card.d",
      name: "d Card",
      issuer: "NTT DOCOMO",
      category: "mainstream",
    },
    "card.paypay": {
      id: "instrument.card.paypay-card",
      name: "PayPay Card",
      issuer: "PayPay Card Corporation",
      category: "mainstream",
    },
    "card.rakuten": {
      id: "instrument.card.rakuten-card",
      name: "Rakuten Card",
      issuer: "Rakuten Card Co., Ltd.",
      category: "mainstream",
    },
    "card.smbc": {
      id: "instrument.card.mitsui-sumitomo-card-nl",
      name: "Mitsui Sumitomo Card (NL)",
      issuer: "Sumitomo Mitsui Card",
      category: "mainstream",
    },
    "card.view": {
      id: "instrument.card.view-card-standard",
      name: "View Card Standard",
      issuer: "Viewcard",
      category: "rail",
    },
  });

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
    "dポイント": "point.d",
    "d Point": "point.d",
    "d POINT": "point.d",
    "JRE POINT": "point.jre",
    nanaco: "point.nanaco",
    "nanaco Points": "point.nanaco",
    PayPay: "wallet.paypay",
    "PayPay Points": "point.paypay",
    Ponta: "point.ponta",
    "楽天ポイント": "point.rakuten",
    "Rakuten Point": "point.rakuten",
    "Vポイント": "point.v",
    "V Point": "point.v",
    "WAON POINT": "point.waon",
    "AEON Pay": "wallet.aeonpay",
    "au PAY": "wallet.aupay",
    "d払い": "wallet.dbarai",
    FamiPay: "wallet.famipay",
    "楽天ペイ": "wallet.rakutenpay",
    "Rakuten Pay": "wallet.rakutenpay",
    Moppy: "point.moppy",
    "永久不滅ポイント": "point.saison-permanent",
    "JRキューポ": "point.jr-kyupo",
    "セブンマイル": "point.seven-mile",
    Suica: "storedvalue.suica",
    "ANA Pay": "wallet.anapay",
    Revolut: "wallet.revolut-jp",
    Kyash: "wallet.kyash",
    "ANAマイル": "mile.ana",
    "ANA Mileage Club": "mile.ana",
    "JALマイル": "mile.jal",
    "JAL Mileage Bank": "mile.jal",
    "JALマイレージパーク": "portal.jal-mileage-park",
  });

  const svgNode = (tag, attributes = {}, text = null) => {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([name, value]) =>
      element.setAttribute(name, String(value)),
    );
    if (text !== null) element.textContent = String(text);
    return element;
  };

  const hashHue = (value) => {
    let hash = 0;
    for (const char of String(value))
      hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
    return hash % 360;
  };

  const inferredCategory = (label) => {
    const value = String(label).toLowerCase();
    if (value.includes("platinum")) return "platinum";
    if (value.includes("gold")) return "gold";
    if (value.includes("premium")) return "premium";
    return "mainstream";
  };

  const brandMark = (name, issuer = "") => {
    const value = `${name} ${issuer}`.toLowerCase();
    if (value.includes("rakuten")) return "R";
    if (value.includes("paypay")) return "P";
    if (value.includes("aeon")) return "AEON";
    if (value.includes("mitsui") || value.includes("sumitomo") || value.includes("olive"))
      return "SMBC";
    if (value.includes("jcb")) return "JCB";
    if (/\bd card\b|docomo/u.test(value)) return "d";
    if (value.includes("au pay")) return "au";
    if (value.includes("epos")) return "EPOS";
    if (value.includes("mitsubishi") || value.includes("mufg")) return "MUFG";
    if (value.includes("american express")) return "AMEX";
    if (value.includes("ana")) return "ANA";
    if (value.includes("jal")) return "JAL";
    if (value.includes("saison")) return "SAISON";
    if (value.includes("view") || value.includes("jre") || value.includes("suica"))
      return "VIEW";
    if (value.includes("eneos")) return "ENEOS";
    if (value.includes("orico")) return "Orico";
    if (value.includes("life card")) return "LIFE";
    if (value.includes("diners")) return "Diners";
    if (value.includes("uc card") || value.startsWith("uc ")) return "UC";
    if (value.includes("seven")) return "7";
    if (value.includes("mercard") || value.includes("mercari")) return "m";
    if (value.includes("amazon")) return "a";
    if (value.includes("recruit")) return "R";
    if (value.includes("yodobashi")) return "G";
    if (value.includes("apollostation")) return "apollo";
    if (value.includes("tokyu")) return "TOKYU";
    if (value.includes("keio")) return "KEIO";
    if (value.includes("odakyu")) return "OP";
    if (value.includes("takashimaya")) return "T";
    if (value.includes("muji")) return "MUJI";
    if (value.includes("costco")) return "C";
    if (value.includes("jaccs")) return "JACCS";
    if (value.includes("toyota")) return "TOYOTA";
    if (value.includes("resona")) return "Resona";
    if (value.includes("mizuho")) return "Mizuho";
    const compact = String(name || "?")
      .replace(/[^A-Za-z0-9]+/gu, " ")
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => part.slice(0, 1))
      .join("")
      .toUpperCase();
    return compact || "?";
  };

  const cardPalette = (card) => {
    const key = `${card.name} ${card.issuer || ""}`.toLowerCase();
    const category = card.category;
    if (category === "gold")
      return { top: "#e8c676", bottom: "#9e6d16", accent: "#fff1b8", text: "#21170a" };
    if (category === "platinum" || category === "premium" || category === "hotel")
      return { top: "#323840", bottom: "#0c1015", accent: "#c9d2db", text: "#f7f8fa" };
    if (key.includes("paypay"))
      return { top: "#303238", bottom: "#111217", accent: "#ff003c", text: "#ffffff" };
    if (key.includes("rakuten"))
      return { top: "#f4f5f7", bottom: "#cbd0d7", accent: "#bf0000", text: "#6f0000" };
    if (key.includes("aeon"))
      return { top: "#5753b5", bottom: "#252269", accent: "#d9468a", text: "#ffffff" };
    if (key.includes("mitsui") || key.includes("sumitomo") || key.includes("olive"))
      return { top: "#1a8a63", bottom: "#053e30", accent: "#b4dc3f", text: "#ffffff" };
    if (key.includes("jcb"))
      return { top: "#4c5b7a", bottom: "#20283a", accent: "#d8e0ee", text: "#ffffff" };
    if (key.includes("docomo") || /\bd card\b/u.test(key))
      return { top: "#f3f3f1", bottom: "#d8d8d4", accent: "#d70032", text: "#2c2525" };
    if (key.includes("au"))
      return { top: "#f3933c", bottom: "#ba4c10", accent: "#fff2d9", text: "#ffffff" };
    if (key.includes("epos"))
      return { top: "#f0443e", bottom: "#aa1015", accent: "#ffffff", text: "#ffffff" };
    if (key.includes("american express"))
      return { top: "#5c8e78", bottom: "#21493b", accent: "#d9eadf", text: "#ffffff" };
    if (key.includes("ana"))
      return { top: "#1d65a8", bottom: "#072c5a", accent: "#c7e4ff", text: "#ffffff" };
    if (key.includes("jal"))
      return { top: "#f3f3f1", bottom: "#d6d6d2", accent: "#d71920", text: "#2c2020" };
    if (key.includes("saison"))
      return { top: "#2d6cba", bottom: "#123c74", accent: "#f4f6fb", text: "#ffffff" };
    if (key.includes("view") || key.includes("jre") || key.includes("suica"))
      return { top: "#eef0f2", bottom: "#c7ccd1", accent: "#16814d", text: "#1e2a24" };
    if (key.includes("mufg") || key.includes("mitsubishi"))
      return { top: "#494b50", bottom: "#1a1b1e", accent: "#d71920", text: "#ffffff" };
    if (key.includes("eneos"))
      return { top: "#f45a32", bottom: "#b71915", accent: "#ffb000", text: "#ffffff" };
    if (key.includes("orico"))
      return { top: "#303238", bottom: "#111217", accent: "#f58220", text: "#ffffff" };
    if (key.includes("life"))
      return { top: "#3a3d43", bottom: "#17191d", accent: "#ef3340", text: "#ffffff" };
    if (key.includes("merc"))
      return { top: "#ff5964", bottom: "#c91f36", accent: "#ffffff", text: "#ffffff" };
    if (key.includes("apollostation"))
      return { top: "#f4f5f7", bottom: "#d9dde2", accent: "#e0222c", text: "#252525" };
    const hue = hashHue(card.id);
    return {
      top: `hsl(${hue} 42% 48%)`,
      bottom: `hsl(${hue} 48% 24%)`,
      accent: `hsl(${(hue + 48) % 360} 72% 65%)`,
      text: "#ffffff",
    };
  };

  const serviceSpecFor = (id, label = "") => {
    if (SERVICE_SPECS.has(id)) return SERVICE_SPECS.get(id);
    const mapped = LABEL_IDS[String(label).trim()];
    if (mapped && SERVICE_SPECS.has(mapped)) return SERVICE_SPECS.get(mapped);
    return null;
  };

  const assetSpec = (id, label = "") => {
    if (CARD_REPRESENTATIVES[id]) {
      const card = CARD_REPRESENTATIVES[id];
      return {
        ...card,
        ...cardPalette(card),
        mark: brandMark(card.name, card.issuer),
        kind: "credit_card",
      };
    }
    if (
      String(id).startsWith("card.") ||
      String(id).startsWith("instrument.card.") ||
      String(id) === "instrument.jp.seven-card-plus"
    ) {
      const card = {
        id,
        name: label || id,
        issuer: "",
        category: inferredCategory(label),
      };
      return {
        ...card,
        ...cardPalette(card),
        mark: brandMark(card.name),
        kind: "credit_card",
      };
    }
    const service = serviceSpecFor(id, label);
    if (service) return service;
    const hue = hashHue(`${id}:${label}`);
    return {
      id,
      name: label || id,
      mark: brandMark(label || id),
      kind: "service",
      top: `hsl(${hue} 32% 96%)`,
      bottom: `hsl(${hue} 24% 82%)`,
      accent: `hsl(${hue} 65% 45%)`,
      text: "#20252a",
    };
  };

  const addGlassDefs = (svg, spec, uid) => {
    const defs = svgNode("defs");
    const gradient = svgNode("linearGradient", {
      id: `lg-bg-${uid}`,
      x1: "0",
      y1: "0",
      x2: "1",
      y2: "1",
    });
    gradient.append(
      svgNode("stop", { offset: "0%", "stop-color": spec.top }),
      svgNode("stop", { offset: "100%", "stop-color": spec.bottom }),
    );
    const gloss = svgNode("linearGradient", {
      id: `lg-gloss-${uid}`,
      x1: "0",
      y1: "0",
      x2: "0",
      y2: "1",
    });
    gloss.append(
      svgNode("stop", {
        offset: "0%",
        "stop-color": "#ffffff",
        "stop-opacity": "0.78",
      }),
      svgNode("stop", {
        offset: "48%",
        "stop-color": "#ffffff",
        "stop-opacity": "0.08",
      }),
      svgNode("stop", {
        offset: "100%",
        "stop-color": "#ffffff",
        "stop-opacity": "0",
      }),
    );
    const shadow = svgNode("filter", {
      id: `lg-shadow-${uid}`,
      x: "-20%",
      y: "-20%",
      width: "140%",
      height: "150%",
    });
    shadow.appendChild(
      svgNode("feDropShadow", {
        dx: "0",
        dy: "15",
        stdDeviation: "15",
        "flood-color": spec.accent,
        "flood-opacity": "0.22",
      }),
    );
    defs.append(gradient, gloss, shadow);
    svg.appendChild(defs);
  };

  const addCardChrome = (svg, spec, uid) => {
    const group = svgNode("g", { filter: `url(#lg-shadow-${uid})` });
    group.append(
      svgNode("rect", {
        x: "18",
        y: "18",
        width: "820",
        height: "504",
        rx: "58",
        fill: `url(#lg-bg-${uid})`,
        stroke: "#ffffff",
        "stroke-opacity": "0.82",
        "stroke-width": "5",
      }),
      svgNode("path", {
        d: "M48 78C210 16 558 18 807 78C666 188 445 209 93 192C66 157 52 118 48 78Z",
        fill: `url(#lg-gloss-${uid})`,
      }),
      svgNode("path", {
        d: "M44 454C246 348 502 367 824 226V468C824 493 804 508 777 508H77C61 508 49 490 44 454Z",
        fill: spec.accent,
        "fill-opacity": "0.13",
      }),
      svgNode("path", {
        d: "M40 391C273 241 529 315 823 159",
        fill: "none",
        stroke: "#ffffff",
        "stroke-opacity": "0.23",
        "stroke-width": "8",
      }),
    );
    svg.appendChild(group);
  };

  const addChip = (svg, spec) => {
    const fill = spec.category === "gold" ? "#e6c66d" : "#d7dbe0";
    svg.append(
      svgNode("rect", {
        x: "76",
        y: "246",
        width: "150",
        height: "112",
        rx: "22",
        fill,
        stroke: "#ffffff",
        "stroke-opacity": "0.58",
        "stroke-width": "3",
      }),
      svgNode("path", {
        d: "M113 249V355M151 249V355M188 249V355M79 283H223M79 321H223",
        stroke: "#756b52",
        "stroke-opacity": "0.52",
        "stroke-width": "3",
      }),
    );
  };

  const addContactless = (svg, spec) => {
    const group = svgNode("g", {
      fill: "none",
      stroke: spec.text,
      "stroke-opacity": "0.82",
      "stroke-linecap": "round",
      "stroke-width": "10",
    });
    group.append(
      svgNode("path", { d: "M730 92C755 117 755 155 730 181" }),
      svgNode("path", { d: "M758 74C799 115 799 157 758 199" }),
      svgNode("path", { d: "M701 111C715 125 715 147 701 161" }),
    );
    svg.appendChild(group);
  };

  const fitText = (value, max = 30) => {
    const text = String(value || "");
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  const makeLiquidAsset = (id, label = "") => {
    const spec = assetSpec(id, label);
    const uid = ++assetInstance;
    const svg = svgNode("svg", {
      viewBox: CARD_VIEWBOX,
      width: "100%",
      height: "100%",
      preserveAspectRatio: "xMidYMid meet",
      "aria-hidden": "true",
      focusable: "false",
    });
    addGlassDefs(svg, spec, uid);
    addCardChrome(svg, spec, uid);

    if (spec.kind === "credit_card") {
      addChip(svg, spec);
      addContactless(svg, spec);
      svg.append(
        svgNode(
          "text",
          {
            x: "72",
            y: "145",
            fill: spec.text,
            "font-family": "Arial, sans-serif",
            "font-size": spec.mark.length > 5 ? "62" : "84",
            "font-weight": "800",
            "letter-spacing": "-2",
          },
          spec.mark,
        ),
        svgNode(
          "text",
          {
            x: "72",
            y: "430",
            fill: spec.text,
            "font-family": "Arial, sans-serif",
            "font-size": "54",
            "font-weight": "700",
          },
          fitText(spec.name, 26),
        ),
      );
    } else if (spec.id === "point.d") {
      svg.append(
        svgNode("circle", {
          cx: "218",
          cy: "270",
          r: "118",
          fill: "#d70032",
        }),
        svgNode(
          "text",
          {
            x: "218",
            y: "318",
            "text-anchor": "middle",
            fill: "#ffffff",
            "font-family": "Arial, sans-serif",
            "font-size": "190",
            "font-weight": "800",
          },
          "d",
        ),
        svgNode(
          "text",
          {
            x: "374",
            y: "300",
            fill: "#171717",
            "font-family": "Arial, sans-serif",
            "font-size": "96",
            "font-weight": "700",
          },
          "d POINT",
        ),
      );
    } else {
      svg.append(
        svgNode("rect", {
          x: "82",
          y: "172",
          width: "190",
          height: "190",
          rx: "58",
          fill: spec.accent,
          "fill-opacity": "0.93",
          stroke: "#ffffff",
          "stroke-opacity": "0.45",
          "stroke-width": "4",
        }),
        svgNode(
          "text",
          {
            x: "177",
            y: "296",
            "text-anchor": "middle",
            fill: "#ffffff",
            "font-family": "Arial, sans-serif",
            "font-size": spec.mark.length > 3 ? "54" : "96",
            "font-weight": "800",
          },
          spec.mark,
        ),
        svgNode(
          "text",
          {
            x: "320",
            y: "294",
            fill: spec.text,
            "font-family": "Arial, sans-serif",
            "font-size": "70",
            "font-weight": "750",
          },
          fitText(spec.name, 20),
        ),
      );
    }
    return svg;
  };

  const inferLogoId = (frame) => {
    if (frame.dataset.liquidAssetId) return frame.dataset.liquidAssetId;
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
    const route = frame.closest(".route-chain-node");
    const routeLabel = route?.querySelector("span")?.textContent?.trim();
    if (routeLabel && LABEL_IDS[routeLabel]) return LABEL_IDS[routeLabel];
    const rowLabel = frame
      .closest(".lot-card, .catalogue-family-card")
      ?.querySelector("strong")
      ?.textContent?.trim();
    if (rowLabel && LABEL_IDS[rowLabel]) return LABEL_IDS[rowLabel];
    return "";
  };

  const inferLogoLabel = (frame) => {
    const row = frame.closest(
      ".p0-product-option, .lot-card, .route-chain-node, [data-wallet-chip]",
    );
    return (
      row
        ?.querySelector(
          ".p0-product-name strong, .lot-identity strong, strong, span",
        )
        ?.textContent?.trim() || ""
    );
  };

  const hydrateLogoFrame = (frame) => {
    if (!(frame instanceof HTMLElement) || frame.dataset.liquidGlass === "true")
      return;
    const id = inferLogoId(frame);
    const label = inferLogoLabel(frame);
    if (!id && !label) return;
    while (frame.firstChild) frame.removeChild(frame.firstChild);
    frame.appendChild(makeLiquidAsset(id || label, label));
    frame.dataset.liquidGlass = "true";
  };

  const hydratePaymentLogos = (root = document) => {
    root.querySelectorAll?.(".payment-logo").forEach(hydrateLogoFrame);
  };

  const observePaymentLogos = () => {
    hydratePaymentLogos();
    const observer = new MutationObserver((records) => {
      records.forEach((record) =>
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches(".payment-logo")) hydrateLogoFrame(node);
          hydratePaymentLogos(node);
        }),
      );
    });
    observer.observe(document.body, { childList: true, subtree: true });
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

  observePaymentLogos();
  void load();
})();
