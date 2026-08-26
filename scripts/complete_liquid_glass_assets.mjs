import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const PUBLIC_ROOT = join(ROOT, "apps/consumer-alpha/public");
const OUTPUT_ROOT = join(PUBLIC_ROOT, "assets/liquid-glass");
const SOURCE_ROOT = join(OUTPUT_ROOT, "sources");
const PRODUCTION_ORIGIN =
  process.env.LIQUID_GLASS_PRODUCTION_ORIGIN ??
  "https://reward-points-optimizer-consumer-al.vercel.app";
const EXPECTED_CANONICAL = 211;
const EXPECTED_ALIASES = 35;
const EXPECTED_ASSETS = EXPECTED_CANONICAL + EXPECTED_ALIASES;
const CARD_WIDTH = 856;
const CARD_HEIGHT = 539.8;
const USER_AGENT =
  "Mozilla/5.0 (compatible; PoimichiAssetPipeline/1.0; +https://reward-points-optimizer-consumer-al.vercel.app)";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    ...options,
  });
}

function capture(command, args) {
  return run(command, args, { capture: true }).trim();
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function write(path, content) {
  ensureParent(path);
  writeFileSync(path, content);
}

function writeJson(path, value) {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function gitConfigure() {
  run("git", ["config", "user.name", "poimichi-asset-bot"]);
  run("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
}

function syncMain() {
  run("git", ["fetch", "origin", "main"]);
  run("git", ["rebase", "origin/main"]);
}

function commitAndPush(message, paths) {
  run("git", ["add", "--", ...paths]);
  const staged = capture("git", ["diff", "--cached", "--name-only"]);
  if (staged.length === 0) return capture("git", ["rev-parse", "HEAD"]);
  run("git", ["commit", "-m", message]);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      run("git", ["push", "origin", "HEAD:main"]);
      return capture("git", ["rev-parse", "HEAD"]);
    } catch (error) {
      if (attempt === 4) throw error;
      run("git", ["pull", "--rebase", "--autostash", "origin", "main"]);
    }
  }
  throw new Error("push_failed");
}

function assetSourceReaderSource() {
  return `import { Pool } from "pg";
import {
  createPostgresPoolConfig,
  createRoleScopedQueryPool,
} from "./runtime.js";

export interface AssetSourceCatalogueRow {
  readonly asset_id: string;
  readonly display_name: string;
  readonly entity_type: string;
  readonly metadata: unknown;
  readonly source_page_url: string | null;
  readonly source_image_url: string | null;
  readonly source_origin: string | null;
  readonly checked_at: string | null;
}

export interface AssetSourceCatalogueReader {
  readonly query: () => Promise<readonly AssetSourceCatalogueRow[]>;
  readonly close: () => Promise<void>;
}

export function createAssetSourceCatalogueReader(
  connectionString: string,
  sslRootCertificate: string,
): AssetSourceCatalogueReader {
  const pool = new Pool(
    createPostgresPoolConfig(connectionString, {
      databaseRole: "jro_runtime",
      poolMax: 1,
      sslRootCertificate,
    }),
  );
  const target = createRoleScopedQueryPool(pool, "jro_runtime");
  let closed = false;

  return Object.freeze({
    async query(): Promise<readonly AssetSourceCatalogueRow[]> {
      const result = await target.query<AssetSourceCatalogueRow>(
        "select asset_id, display_name, entity_type, metadata, source_page_url, source_image_url, source_origin, checked_at from app_api.asset_source_catalogue order by entity_type, asset_id",
      );
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            asset_id: String(row.asset_id),
            display_name: String(row.display_name),
            entity_type: String(row.entity_type),
            metadata:
              row.metadata !== null && typeof row.metadata === "object"
                ? row.metadata
                : {},
            source_page_url:
              typeof row.source_page_url === "string"
                ? row.source_page_url
                : null,
            source_image_url:
              typeof row.source_image_url === "string"
                ? row.source_image_url
                : null,
            source_origin:
              typeof row.source_origin === "string" ? row.source_origin : null,
            checked_at:
              typeof row.checked_at === "string" ? row.checked_at : null,
          }),
        ),
      );
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  });
}
`;
}

function assetSourceEndpointSource() {
  return `import { createAssetSourceCatalogueReader } from "../apps/consumer-alpha/dist/asset-source-catalogue.js";
import { SUPABASE_PROD_CA_2021 } from "../apps/consumer-alpha/dist/supabase-ca.js";

let reader;

function databaseUrl() {
  return (
    process.env.JRO_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}

function catalogueReader() {
  if (reader !== undefined) return reader;
  const connectionString = databaseUrl();
  if (connectionString === undefined || connectionString.length === 0)
    throw new Error("jro_database_url_required");
  reader = createAssetSourceCatalogueReader(
    connectionString,
    SUPABASE_PROD_CA_2021,
  );
  return reader;
}

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
}

export default async function handler(request, response) {
  if ((request.method ?? "").toUpperCase() !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, {
      error: { code: "method_not_allowed", message: "Request could not be processed." },
    });
    return;
  }
  try {
    const assets = await catalogueReader().query();
    sendJson(response, 200, {
      version: "asset-source-catalogue.v1",
      deployment_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      assets,
    });
  } catch {
    sendJson(response, 503, {
      error: { code: "asset_sources_unavailable", message: "Request could not be processed." },
    });
  }
}
`;
}

function migrationSource() {
  return `create or replace view app_api.asset_source_catalogue
with (security_barrier = true)
as
select
  e.entity_key as asset_id,
  e.display_name,
  e.entity_type,
  e.metadata,
  coalesce(
    p.official_product_url,
    nullif(e.metadata ->> 'source_url', ''),
    nullif(e.metadata ->> 'official_url', ''),
    trusted.source_url
  ) as source_page_url,
  coalesce(
    nullif(e.metadata ->> 'source_image_url', ''),
    nullif(p.metadata ->> 'source_image_url', ''),
    nullif(trusted.registry_payload ->> 'source_image_url', '')
  ) as source_image_url,
  case
    when p.official_product_url is not null then 'credit_card_catalogue_profile'
    when nullif(e.metadata ->> 'source_url', '') is not null then 'entity_metadata'
    when nullif(e.metadata ->> 'official_url', '') is not null then 'entity_metadata'
    when trusted.source_url is not null then 'trusted_source_registry'
    else null
  end as source_origin,
  greatest(e.updated_at, p.checked_at, trusted.content_verified_on::timestamptz) as checked_at
from app_private.entities e
left join app_private.credit_card_catalogue_profiles p
  on p.card_id = e.entity_key
left join lateral (
  select
    ts.source_url,
    ts.registry_payload,
    ts.content_verified_on
  from app_private.trusted_sources ts
  where ts.verification_status = 'content_verified'
    and (
      ts.authority_scope ? e.entity_key
      or ts.registry_payload ->> 'card_id' = e.entity_key
      or ts.authority_scope ? (e.metadata ->> 'canonical_family_id')
      or ts.authority_scope ? (e.metadata ->> 'family_id')
    )
  order by
    case when ts.authority_scope ? e.entity_key then 0 else 1 end,
    ts.content_verified_on desc nulls last,
    ts.source_key
  limit 1
) trusted on true
where e.status = 'active'
  and e.entity_type in (
    'credit_card',
    'loyalty_program',
    'stored_value_program',
    'electronic_money',
    'qr_wallet',
    'payment_interface',
    'prepaid_card'
  );

revoke all on app_api.asset_source_catalogue from public, anon, authenticated;
grant select on app_api.asset_source_catalogue to jro_runtime;
`;
}

function liquidGlassCss() {
  return `.payment-logo {
  width: 52px !important;
  height: auto !important;
  aspect-ratio: 85.6 / 53.98;
  flex: 0 0 52px !important;
  padding: 0 !important;
  overflow: visible;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.payment-logo img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 1px 2px rgb(15 33 48 / 13%));
}

.route-node-logo {
  width: 46px !important;
  flex-basis: 46px !important;
}

@media (max-width: 370px) {
  .payment-logo {
    width: 46px !important;
    flex-basis: 46px !important;
  }
}
`;
}

function coverageRuntime() {
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
    const optionInput = option?.querySelector("input[data-p0-product]");
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
    byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
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
}

function coverageSource() {
  return `(${coverageRuntime.toString()})();\n`;
}

function installPipelineFiles() {
  write(
    join(ROOT, "apps/consumer-alpha/src/asset-source-catalogue.ts"),
    assetSourceReaderSource(),
  );
  write(join(ROOT, "api/asset-sources.mjs"), assetSourceEndpointSource());
  write(
    join(
      ROOT,
      "supabase/migrations/20260825202837_asset_source_catalogue.sql",
    ),
    migrationSource(),
  );
  write(join(PUBLIC_ROOT, "liquid-glass.css"), liquidGlassCss());
  write(join(PUBLIC_ROOT, "coverage.js"), coverageSource());

  const vercelPath = join(ROOT, "vercel.json");
  const vercel = JSON.parse(readFileSync(vercelPath, "utf8"));
  vercel.rewrites ??= [];
  if (!vercel.rewrites.some((item) => item.source === "/asset-sources")) {
    const catchall = vercel.rewrites.findIndex(
      (item) => item.source === "/api/:path*",
    );
    const rewrite = {
      source: "/asset-sources",
      destination: "/api/asset-sources",
    };
    if (catchall >= 0) vercel.rewrites.splice(catchall, 0, rewrite);
    else vercel.rewrites.push(rewrite);
  }
  vercel.functions ??= {};
  vercel.functions["api/asset-sources.mjs"] = { maxDuration: 15 };
  writeJson(vercelPath, vercel);
}

const ALIASES = Object.freeze([
  ["point.d", "dポイント", "program.jp.dpoint"],
  ["point.jre", "JRE POINT", "program.jp.jrepoint"],
  ["point.nanaco", "nanacoポイント", "program.jp.nanaco"],
  ["point.paypay", "PayPayポイント", "program.jp.paypaypoint"],
  ["point.ponta", "Pontaポイント", "program.jp.ponta"],
  ["point.rakuten", "楽天ポイント", "program.jp.rakutenpoint"],
  ["point.v", "Vポイント", "program.jp.vpoint"],
  ["point.waon", "WAON POINT", "program.jp.waonpoint"],
  ["wallet.aeonpay", "AEON Pay", "instrument.wallet.aeonpay"],
  ["wallet.aupay", "au PAY", "instrument.wallet.aupay"],
  ["wallet.dbarai", "d払い", "instrument.wallet.dbarai"],
  ["wallet.famipay", "FamiPay", "instrument.wallet.famipay"],
  ["wallet.paypay", "PayPay", "instrument.wallet.paypay"],
  ["wallet.rakutenpay", "楽天ペイ", "instrument.wallet.rakutenpay"],
  ["card.aeon", "AEON Card", "instrument.card.aeon"],
  ["card.aupay", "au PAY Card", "instrument.card.au-pay-card"],
  ["card.d", "d Card", "instrument.card.d"],
  ["card.paypay", "PayPay Card", "instrument.card.paypay-card"],
  ["card.rakuten", "Rakuten Card", "instrument.card.rakuten-card"],
  ["card.smbc", "Mitsui Sumitomo Card (NL)", "instrument.card.mitsui-sumitomo-card-nl"],
  ["card.view", "View Card Standard", "instrument.card.view-card-standard"],
  ["point.moppy", "ポイント (moppy)", null],
  ["point.saison", "ポイント (saison)", null],
  ["point.saison-permanent", "永久不滅ポイント", null],
  ["point.jr-kyupo", "JRキューポ", null],
  ["point.seven-mile", "セブンマイル", null],
  ["storedvalue.suica", "Suica", null],
  ["transit.suica", "Suica", null],
  ["wallet.anapay", "ANA Pay", null],
  ["wallet.kyash", "Kyash", null],
  ["wallet.revolut", "Revolut", null],
  ["wallet.revolut-jp", "Revolut", null],
  ["mile.ana", "ANA Mileage Club", null],
  ["mile.jal", "JAL Mileage Bank", null],
  ["portal.jal-mileage-park", "JAL Mileage Park", null],
].map(([id, displayName, aliasOf]) => ({
  id,
  display_name: displayName,
  entity_type: "service_alias",
  alias_of: aliasOf,
  metadata: {},
})));

const PAGE_OVERRIDES = Object.freeze({
  "instrument.jp.seven-card-plus": "https://www.7card.co.jp/",
  "instrument.emoney.id": "https://id-credit.com/",
  "instrument.emoney.pitapa": "https://www.pitapa.com/",
  "instrument.emoney.quicpay": "https://www.quicpay.jp/",
  "instrument.emoney.rakuten_edy": "https://edy.rakuten.co.jp/",
  "instrument.emoney.transit_ic": "https://www.jreast.co.jp/suica/",
  "instrument.emoney.waon": "https://www.waon.net/",
  "instrument.jp.nanaco": "https://www.nanaco-net.jp/",
  "program.jp.bicpoint": "https://www.biccamera.com/bc/c/info/point/index.jsp",
  "program.jp.bikkuri-app-rank": "https://www.bikkuri-donkey.com/app/",
  "program.jp.chatnoir-point": "https://c-united.co.jp/veloce/",
  "program.jp.club-on-millennium": "https://www.sogo-seibu.jp/clubon/",
  "program.jp.cocos-mileage": "https://www.cocos-jpn.co.jp/cocosmile/",
  "program.jp.coop-mirai-point": "https://shop-mirai.coopnet.or.jp/about/hopetan_card/",
  "program.jp.create-point": "https://www.create-sd.co.jp/service/point/",
  "program.jp.crie-card-discount": "https://www.pokkacreate.co.jp/crie/card/",
  "program.jp.daimaru-matsuzakaya-card-point": "https://depaco.daimaru-matsuzakaya.jp/shop/pages/point.aspx",
  "program.jp.daimaru-matsuzakaya-point": "https://depaco.daimaru-matsuzakaya.jp/shop/pages/point.aspx",
  "program.jp.dennys-point": "https://www.dennys.jp/app/",
  "program.jp.doutor-value": "https://www.doutor.co.jp/dvc/",
  "program.jp.dpoint": "https://dpoint.docomo.ne.jp/",
  "program.jp.gongcha-leaf": "https://www.gongcha.co.jp/faq/leaf_program-9/",
  "program.jp.hands-club": "https://hands.net/handsclub/",
  "program.jp.ikinaristeak-meat-mileage": "https://ikinaristeak.com/mileage/",
  "program.jp.ingfan": "https://www.ingni-store.com/",
  "program.jp.jrepoint": "https://www.jrepoint.jp/",
  "program.jp.keio-point": "https://www.keio-passport.co.jp/",
  "program.jp.keyuca-point": "https://www.keyuca.com/Page/guide.aspx",
  "program.jp.komeca-point": "https://www.komeda.co.jp/komeca/",
  "program.jp.life-point": "https://www.lifecorp.jp/service/point/",
  "program.jp.loft-stamp": "https://www.loft.co.jp/loftapp/",
  "program.jp.majica": "https://www.majica-net.com/",
  "program.jp.matsukiyococokara": "https://www.matsukiyococokara-online.com/point",
  "program.jp.matsuya-point": "https://www.matsuyafoods.co.jp/matsuben-net/point/",
  "program.jp.mi-point": "https://www.mistore.jp/shopping/campaign/mip_cp.html",
  "program.jp.mospoint": "https://www.mos.jp/mosca/",
  "program.jp.muji-good": "https://www.muji.com/jp/mujipass/",
  "program.jp.my-saintmarc": "https://www.saint-marc-hd.com/app/",
  "program.jp.myroyal": "https://www.royalhost.jp/myroyal/",
  "program.jp.nanaco": "https://www.nanaco-net.jp/how-to/save_point/",
  "program.jp.nitori": "https://www.nitori-net.jp/ec/feature/membership/",
  "program.jp.ohsho-stamp": "https://www.ohsho.co.jp/point/",
  "program.jp.olympic-tokopon": "https://www.olympic-corp.co.jp/service/point",
  "program.jp.ootoya-point": "https://www.ootoya.com/app/",
  "program.jp.ozeki-cashback": "https://www.ozeki-net.co.jp/service/card/",
  "program.jp.pal-point": "https://www.palcloset.jp/",
  "program.jp.paypaypoint": "https://paypay.ne.jp/guide/point/",
  "program.jp.plaza-pass": "https://www.plazastyle.com/contents/pass/",
  "program.jp.ponta": "https://www.ponta.jp/",
  "program.jp.rakutenpoint": "https://point.rakuten.co.jp/",
  "program.jp.renoir-bonus-value": "https://www.ginza-renoir.co.jp/renoircard/",
  "program.jp.santoku-point": "https://santoku.co.jp/service/card/",
  "program.jp.sanwa-point": "https://www.heartful-sanwa.co.jp/service/card/",
  "program.jp.seims-point": "https://www.fujiyakuhin.co.jp/seims/service/pointcard/",
  "program.jp.seki-tulip": "https://www.sekiyakuhin.co.jp/tulip_point.html",
  "program.jp.skylark": "https://www.skylark.co.jp/point/",
  "program.jp.soupstock-point": "https://www.soup-stock-tokyo.com/faq",
  "program.jp.st-point": "https://www.st-c.co.jp/",
  "program.jp.starbucks-stars": "https://www.starbucks.co.jp/rewards/",
  "program.jp.sugi-point": "https://www.sugi-net.jp/service/point/",
  "program.jp.sundrug": "https://www.sundrug.co.jp/service/pointcard",
  "program.jp.sushiro-point": "https://www.akindo-sushiro.co.jp/app/",
  "program.jp.takashimaya-point": "https://www.takashimaya.co.jp/store/special/pointcard/",
  "program.jp.tobu-point": "https://www.tobupoint.jp/",
  "program.jp.tokyu-point": "https://www.topcard.co.jp/point/",
  "program.jp.tsuruha-point": "https://www.tsuruha.co.jp/service/point/",
  "program.jp.tullys-beans": "https://www.tullys.co.jp/tullysclub/",
  "program.jp.ueshima-precious": "https://www.ueshima-coffee-ten.jp/precious/",
  "program.jp.vpoint": "https://vpoint.net/",
  "program.jp.waonpoint": "https://www.smartwaon.com/",
  "program.jp.wendys-stage": "https://www.first-kitchen.co.jp/wfkclub/",
  "program.jp.yaoko-point": "https://www.yaoko-net.com/service/card/",
  "program.jp.yodobashi-goldpoint": "https://www.yodobashi.com/ec/support/member/pointservice/",
  "instrument.payment.unionpay": "https://www.unionpayintl.com/jp/",
  "instrument.wallet.applepay": "https://www.apple.com/jp/apple-pay/",
  "instrument.prepaid.hopetan": "https://shop-mirai.coopnet.or.jp/about/hopetan_card/",
  "instrument.wallet.aeonpay": "https://www.aeon.co.jp/aeonpay/",
  "instrument.wallet.alipay": "https://global.alipay.com/",
  "instrument.wallet.aupay": "https://aupay.wallet.auone.jp/",
  "instrument.wallet.bankpay": "https://jeppo.jp/bankpay/",
  "instrument.wallet.dbarai": "https://service.smt.docomo.ne.jp/keitai_payment/",
  "instrument.wallet.famipay": "https://famipay.famidigi.jp/",
  "instrument.wallet.jcoinpay": "https://j-coin.jp/",
  "instrument.wallet.merpay": "https://www.merpay.com/",
  "instrument.wallet.paypay": "https://paypay.ne.jp/",
  "instrument.wallet.quocardpay": "https://www.quocard.com/pay/",
  "instrument.wallet.rakutenpay": "https://pay.rakuten.co.jp/",
  "instrument.wallet.smartcode": "https://www.smart-code.jp/",
  "instrument.wallet.wechatpay": "https://pay.weixin.qq.com/",
  "instrument.wallet.yuchopay": "https://www.jp-bank.japanpost.jp/kojin/sokin/yuchopay/kj_sk_yp_index.html",
  "instrument.create.hippo": "https://www.create-sd.co.jp/service/hippo/",
  "instrument.crie.card": "https://www.pokkacreate.co.jp/crie/card/",
  "instrument.doutor.valuecard": "https://www.doutor.co.jp/dvc/",
  "instrument.komeda.komeca": "https://www.komeda.co.jp/komeca/",
  "instrument.life.lacuca": "https://www.lifecorp.jp/service/lacuca/",
  "instrument.majica.money": "https://www.majica-net.com/",
  "instrument.misterdonut.card": "https://www.misterdonut.jp/m_menu/misdocard/",
  "instrument.mos.card": "https://www.mos.jp/mosca/",
  "instrument.pronto.money": "https://www.pronto.co.jp/prontomoney/",
  "instrument.renoir.card": "https://www.ginza-renoir.co.jp/renoircard/",
  "instrument.santoku.cogca": "https://www.cogca.jp/",
  "instrument.st.emoney": "https://www.st-c.co.jp/",
  "instrument.starbucks.card": "https://www.starbucks.co.jp/card/",
  "instrument.sugi.pay": "https://www.sugi-net.jp/service/sugipay/",
  "instrument.tullys.card": "https://www.tullys.co.jp/tullyscard/",
  "instrument.ueshima.precious": "https://www.ueshima-coffee-ten.jp/precious/",
  "instrument.yoshinoya.prepaid": "https://www.yoshinoya.com/service/yoshinoya-prepaid-card/",
  "instrument.card.rakuten-ana-mileage-club-card": "https://www.rakuten-card.co.jp/card/rakuten-amc-card/",
  "instrument.card.mizuho-mileage-club-card-general": "https://www.mizuhobank.co.jp/card/saison/index.html",
  "instrument.card.jq-card-epos": "https://www.jrkyushu.co.jp/jq/card/epos/",
  "point.moppy": "https://pc.moppy.jp/",
  "point.saison": "https://www.saisoncard.co.jp/point/",
  "point.saison-permanent": "https://www.saisoncard.co.jp/point/",
  "point.jr-kyupo": "https://www.jrkyushu.co.jp/jq/point/",
  "point.seven-mile": "https://www.7mp.omni7.jp/",
  "storedvalue.suica": "https://www.jreast.co.jp/suica/",
  "transit.suica": "https://www.jreast.co.jp/suica/",
  "wallet.anapay": "https://www.ana.co.jp/ja/jp/amc/ana-pay/",
  "wallet.kyash": "https://www.kyash.co/",
  "wallet.revolut": "https://www.revolut.com/ja-JP/",
  "wallet.revolut-jp": "https://www.revolut.com/ja-JP/",
  "mile.ana": "https://www.ana.co.jp/ja/jp/amc/",
  "mile.jal": "https://www.jal.co.jp/jp/ja/jmb/",
  "portal.jal-mileage-park": "https://partner.jal.co.jp/",
});


const EXPLICIT_IMAGE_OVERRIDES = Object.freeze({
  "instrument.card.majica-ucs": "https://www.ucscard.co.jp/assets/images/lineup/ucscard/mv_pc.png",
  "instrument.card.ana-super-flyers-gold-card": "https://www.ana.co.jp/amc/anacard/googlepay/popup01/images/gold_05.gif",
  "instrument.card.ana-card-general": "https://www.ana.co.jp/amc/anacard/googlepay/popup01/images/general_10.gif",
  "instrument.card.ana-wide-gold-card": "https://www.ana.co.jp/amc/anacard/googlepay/popup01/images/gold_03.gif",
  "program.jp.crie-card-discount": "https://c-united.co.jp/crie-maison/crie/card/img/card/mv.jpg",
  "program.jp.bicpoint": "https://www.biccamera.co.jp/shopguide/campaign/camp-caution/img/pointcard/bic_pointcard.png",
  "program.jp.muji-good": "https://www.muji.com/jp/ja/service/goodprogram/assets/img/logo-mujigoodprogram.svg",
  "program.jp.nitori": "https://www.nitori-net.jp/ecstatic/include/characteristic/loyalty-program/img01.png",
  "instrument.card.rakuten-bank-card-credit-function": "https://www.rakuten-bank.co.jp/card/rc/images/update-img-01.png",
  "instrument.crie.card": "https://c-united.co.jp/crie-maison/crie/card/img/card/mv.jpg",
  "program.jp.takashimaya-point": "https://www.takashimaya.co.jp/base/pc/store/special/card_list/img/img_takashimaya_point.png",
  "program.jp.mi-point": "https://www.mistore.jp/on/demandware.static/-/Sites-seamless-Library/ja_JP/dw9d1221a6/content/campaign/mip_cp/images/main.jpg",
  "wallet.anapay": "https://www.ana.co.jp/amc/ana-pay/img/image_top/mv/tittle_231107.png",
  "mile.ana": "https://www.ana.co.jp/amc/ana-pay/img/image_top/logo/logo_ana.png",
});

const EXPLICIT_SOURCE_PAGE_OVERRIDES = Object.freeze({
  "instrument.card.majica-ucs": "https://www.ucscard.co.jp/lineup/ucscard/",
  "instrument.card.rakuten-bank-card-credit-function": "https://www.rakuten-bank.co.jp/card/rc/update.html",
  "program.jp.nitori": "https://www.nitori-net.jp/ec/characteristic/loyalty-program/",
  "program.jp.mi-point": "https://www.mistore.jp/shopping/campaign/mip_cp.html",
  "program.jp.takashimaya-point": "https://www.takashimaya.co.jp/store/special/card_list/",
  "program.jp.crie-card-discount": "https://c-united.co.jp/crie/card/",
  "instrument.crie.card": "https://c-united.co.jp/crie/card/",
});

const LOCAL_OFFICIAL_ART = Object.freeze({
  "program.jp.dpoint": "dpoint.png",
  "program.jp.jrepoint": "jrepoint.webp",
  "program.jp.nanaco": "nanaco.png",
  "program.jp.paypaypoint": "paypay.svg",
  "program.jp.ponta": "ponta.png",
  "program.jp.rakutenpoint": "rakutenpoint.svg",
  "program.jp.vpoint": "vpoint.svg",
  "program.jp.waonpoint": "waon.png",
  "instrument.jp.nanaco": "nanaco.png",
  "instrument.emoney.waon": "waon.png",
  "instrument.wallet.aeonpay": "aeonpay.png",
  "instrument.wallet.aupay": "aupay.png",
  "instrument.wallet.dbarai": "dbarai.png",
  "instrument.wallet.famipay": "famipay.svg",
  "instrument.wallet.paypay": "paypay.svg",
  "instrument.wallet.rakutenpay": "rakutenpay.svg",
  "instrument.card.aeon": "aeoncard.png",
  "instrument.card.au-pay-card": "aupaycard.png",
  "instrument.card.d": "dcard.png",
  "instrument.card.paypay-card": "paypaycard.png",
  "instrument.card.rakuten-card": "rakutencard.svg",
  "instrument.card.mitsui-sumitomo-card-nl": "smbccard.png",
  "instrument.card.view-card-standard": "viewcard.gif",
});

const GENERIC_IDS = new Set([
  "instrument.payment.cashless_generic",
  "instrument.payment.credit_card_general",
  "instrument.payment.emoney_generic",
  "instrument.payment.ic_generic",
  "instrument.wallet.barcode_generic",
]);

function isCreditCard(asset) {
  return asset.entity_type === "credit_card";
}

function sourcePageFor(asset) {
  return (
    EXPLICIT_SOURCE_PAGE_OVERRIDES[asset.id] ??
    PAGE_OVERRIDES[asset.id] ??
    asset.source_page_url ??
    asset.metadata?.source_url ??
    null
  );
}

function safeSlug(value) {
  return String(value)
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replaceAll(".", "__")
    .toLocaleLowerCase("en-US");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sniffMime(bytes, declared = "") {
  const value = declared.split(";", 1)[0].trim().toLocaleLowerCase("en-US");
  if (value.startsWith("image/")) return value;
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.subarray(0, 6).toString("ascii").startsWith("GIF"))
    return "image/gif";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  const text = bytes.subarray(0, 1024).toString("utf8").trimStart();
  if (text.startsWith("<svg") || text.includes("<svg")) return "image/svg+xml";
  if (bytes[0] === 0 && bytes[1] === 0) return "image/x-icon";
  return value || "application/octet-stream";
}

function extensionForMime(mime) {
  return (
    {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/svg+xml": ".svg",
      "image/avif": ".avif",
      "image/x-icon": ".ico",
      "image/vnd.microsoft.icon": ".ico",
    }[mime] ?? ".img"
  );
}

function imageDimensions(bytes, mime) {
  try {
    if (mime === "image/png" && bytes.length >= 24)
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (mime === "image/gif" && bytes.length >= 10)
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    if (mime === "image/webp" && bytes.length >= 30) {
      const kind = bytes.subarray(12, 16).toString("ascii");
      if (kind === "VP8X")
        return {
          width: 1 + bytes.readUIntLE(24, 3),
          height: 1 + bytes.readUIntLE(27, 3),
        };
    }
    if (mime === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1];
        const length = bytes.readUInt16BE(offset + 2);
        if (
          [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
            marker,
          )
        )
          return {
            width: bytes.readUInt16BE(offset + 7),
            height: bytes.readUInt16BE(offset + 5),
          };
        if (length < 2) break;
        offset += 2 + length;
      }
    }
    if (mime === "image/svg+xml") {
      const text = bytes.toString("utf8");
      const viewBox = text.match(
        /viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/iu,
      );
      if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
      const width = text.match(/\bwidth\s*=\s*["']([\d.]+)/iu);
      const height = text.match(/\bheight\s*=\s*["']([\d.]+)/iu);
      if (width && height)
        return { width: Number(width[1]), height: Number(height[1]) };
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchBytes(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? 25_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: options.accept ?? "*/*",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > (options.maxBytes ?? 12_000_000))
      throw new Error("response_too_large");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > (options.maxBytes ?? 12_000_000))
      throw new Error("response_too_large");
    return {
      bytes,
      url: response.url,
      contentType: response.headers.get("content-type") ?? "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseAttributes(tag) {
  const result = {};
  for (const match of tag.matchAll(
    /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu,
  ))
    result[match[1].toLocaleLowerCase("en-US")] =
      match[2] ?? match[3] ?? match[4] ?? "";
  return result;
}

function resolveUrl(value, base) {
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) return null;
  try {
    const url = new URL(value.replaceAll("&amp;", "&"), base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function staticCandidates(html, baseUrl) {
  const candidates = [];
  for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
    const attrs = parseAttributes(tag);
    const key = (attrs.property ?? attrs.name ?? "").toLocaleLowerCase("en-US");
    if (["og:image", "og:image:url", "twitter:image", "twitter:image:src"].includes(key)) {
      const url = resolveUrl(attrs.content, baseUrl);
      if (url) candidates.push({ url, descriptor: key, alt: attrs.content ?? "" });
    }
  }
  for (const tag of html.match(/<link\b[^>]*>/giu) ?? []) {
    const attrs = parseAttributes(tag);
    const rel = (attrs.rel ?? "").toLocaleLowerCase("en-US");
    if (rel.includes("icon") || rel.includes("image_src")) {
      const url = resolveUrl(attrs.href, baseUrl);
      if (url) candidates.push({ url, descriptor: `link:${rel}`, alt: attrs.title ?? "" });
    }
  }
  for (const tag of html.match(/<img\b[^>]*>/giu) ?? []) {
    const attrs = parseAttributes(tag);
    const raw =
      attrs.src ?? attrs["data-src"] ?? attrs["data-original"] ?? attrs["data-lazy-src"];
    const url = resolveUrl(raw, baseUrl);
    if (url)
      candidates.push({
        url,
        descriptor: "img",
        alt: `${attrs.alt ?? ""} ${attrs.title ?? ""} ${attrs.class ?? ""}`,
      });
    const srcset = attrs.srcset ?? attrs["data-srcset"];
    if (srcset) {
      const parts = srcset
        .split(",")
        .map((part) => part.trim().split(/\s+/u)[0])
        .filter(Boolean);
      const selected = parts.at(-1);
      const selectedUrl = resolveUrl(selected, baseUrl);
      if (selectedUrl)
        candidates.push({
          url: selectedUrl,
          descriptor: "img:srcset",
          alt: attrs.alt ?? "",
        });
    }
  }
  for (const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)) {
    const url = resolveUrl(match[1], baseUrl);
    if (url) candidates.push({ url, descriptor: "css-background", alt: "" });
  }
  for (const match of html.matchAll(/"(?:image|logo|thumbnailUrl)"\s*:\s*"([^"]+)"/giu)) {
    const url = resolveUrl(match[1].replaceAll("\\/", "/"), baseUrl);
    if (url) candidates.push({ url, descriptor: "json-ld", alt: "" });
  }
  return [...new Map(candidates.map((item) => [item.url, item])).values()];
}

function nameTokens(asset) {
  return [...new Set(
    `${asset.id} ${asset.display_name}`
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 2 && !["card", "point", "points", "instrument", "program", "general"].includes(token)),
  )];
}

function candidateScore(asset, candidate, dimensions, mime) {
  const haystack = `${candidate.url} ${candidate.alt} ${candidate.descriptor}`
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
  const tokens = nameTokens(asset);
  let score = 0;
  if (candidate.descriptor.startsWith("img")) score += 70;
  if (candidate.descriptor.startsWith("og:") || candidate.descriptor.startsWith("twitter:"))
    score += 35;
  if (candidate.descriptor === "json-ld") score += 30;
  if (candidate.descriptor.includes("icon")) score += isCreditCard(asset) ? -160 : 25;
  if (mime === "image/svg+xml") score += isCreditCard(asset) ? 5 : 45;
  if (["image/png", "image/webp"].includes(mime)) score += 20;
  for (const token of tokens) if (haystack.includes(token)) score += 44;
  if (/logo|ロゴ/iu.test(haystack)) score += isCreditCard(asset) ? -45 : 80;
  if (/card|カード/iu.test(haystack)) score += isCreditCard(asset) ? 65 : 0;
  if (/banner|campaign|kv|hero|mainvisual|news|bnr/iu.test(haystack)) score -= 35;
  if (dimensions?.width && dimensions?.height) {
    const ratio = dimensions.width / dimensions.height;
    const area = dimensions.width * dimensions.height;
    if (isCreditCard(asset)) {
      const cardLike =
        (ratio >= 1.12 && ratio <= 2.05) || (ratio >= 0.48 && ratio <= 0.9);
      score += cardLike ? 165 : -130;
      if (dimensions.width < 240 || dimensions.height < 140) score -= 130;
      if (area > 150_000) score += 35;
    } else {
      if (ratio >= 0.35 && ratio <= 5.5) score += 25;
      if (area > 20_000) score += 20;
      if (dimensions.width < 48 || dimensions.height < 48) score -= 70;
    }
  }
  return score;
}

let puppeteerPromise;
let browserPromise;

async function renderedCandidates(pageUrl) {
  try {
    puppeteerPromise ??= import(pathToFileURL(process.env.PUPPETEER_ENTRY).href);
    const puppeteer = await puppeteerPromise;
    browserPromise ??= puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const browser = await browserPromise;
    const page = await browser.newPage();
    try {
      await page.setUserAgent(USER_AGENT);
      await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 35_000 });
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 800) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        window.scrollTo(0, 0);
      });
      await new Promise((resolve) => setTimeout(resolve, 900));
      return await page.evaluate(() => {
        const output = [];
        document.querySelectorAll("img").forEach((image) => {
          if (!image.currentSrc) return;
          output.push({
            url: image.currentSrc,
            descriptor: "rendered-img",
            alt: `${image.alt || ""} ${image.title || ""} ${image.className || ""}`,
            declaredWidth: image.naturalWidth,
            declaredHeight: image.naturalHeight,
          });
        });
        document.querySelectorAll("*").forEach((element) => {
          const background = getComputedStyle(element).backgroundImage;
          const match = background?.match(/url\(["']?([^"')]+)["']?\)/u);
          if (match?.[1])
            output.push({
              url: match[1],
              descriptor: "rendered-background",
              alt: `${element.getAttribute("aria-label") || ""} ${element.className || ""}`,
            });
        });
        return output;
      });
    } finally {
      await page.close();
    }
  } catch {
    return [];
  }
}

async function evaluateCandidate(asset, candidate) {
  try {
    const fetched = await fetchBytes(candidate.url, {
      accept: "image/avif,image/webp,image/svg+xml,image/png,image/jpeg,image/gif,*/*;q=0.5",
      timeout: 22_000,
    });
    const mime = sniffMime(fetched.bytes, fetched.contentType);
    if (!mime.startsWith("image/")) return null;
    const dimensions = imageDimensions(fetched.bytes, mime) ??
      (candidate.declaredWidth && candidate.declaredHeight
        ? { width: candidate.declaredWidth, height: candidate.declaredHeight }
        : null);
    return {
      bytes: fetched.bytes,
      imageUrl: fetched.url,
      mime,
      dimensions,
      descriptor: candidate.descriptor,
      score: candidateScore(asset, candidate, dimensions, mime),
    };
  } catch {
    return null;
  }
}

async function bestCandidate(asset, candidates) {
  const initial = candidates.slice(0, 36);
  const evaluated = [];
  for (let index = 0; index < initial.length; index += 6) {
    const batch = await Promise.all(
      initial.slice(index, index + 6).map((candidate) => evaluateCandidate(asset, candidate)),
    );
    evaluated.push(...batch.filter(Boolean));
  }
  evaluated.sort((left, right) => right.score - left.score);
  return evaluated[0] ?? null;
}

async function officialFavicon(pageUrl) {
  const origin = new URL(pageUrl).origin;
  for (const name of ["/apple-touch-icon.png", "/favicon.png", "/favicon.ico"]) {
    try {
      const fetched = await fetchBytes(new URL(name, origin).toString(), {
        accept: "image/*,*/*;q=0.5",
        timeout: 12_000,
        maxBytes: 3_000_000,
      });
      const mime = sniffMime(fetched.bytes, fetched.contentType);
      if (mime.startsWith("image/"))
        return {
          bytes: fetched.bytes,
          imageUrl: fetched.url,
          mime,
          dimensions: imageDimensions(fetched.bytes, mime),
          descriptor: "official-favicon-fallback",
          score: 0,
        };
    } catch {
      // Try the next standard first-party icon path.
    }
  }
  return null;
}


async function officialSearchCandidates(asset, pageUrl) {
  try {
    const pageHost = new URL(pageUrl).hostname.replace(/^www\./u, "");
    const query = encodeURIComponent(
      `site:${pageHost} \"${asset.display_name}\" card logo`,
    );
    const search = await fetchBytes(
      `https://www.bing.com/images/search?q=${query}&form=HDRSC2`,
      {
        accept: "text/html,*/*;q=0.5",
        timeout: 22_000,
        maxBytes: 6_000_000,
      },
    );
    const html = search.bytes.toString("utf8");
    const urls = [];
    for (const match of html.matchAll(
      /(?:murl(?:&quot;|")\s*:\s*(?:&quot;|"))([^&"]+)/gi,
    )) {
      const value = match[1]
        .replaceAll("&amp;", "&")
        .replaceAll("\\/", "/");
      try {
        const candidate = new URL(value);
        const host = candidate.hostname.replace(/^www\./u, "");
        if (host === pageHost || host.endsWith(`.${pageHost}`))
          urls.push(candidate.toString());
      } catch {
        // Ignore malformed search metadata.
      }
    }
    return [...new Set(urls)].slice(0, 24).map((url) => ({
      url,
      descriptor: "official-domain-image-search",
      alt: asset.display_name,
    }));
  } catch {
    return [];
  }
}

async function officialElementScreenshot(asset, pageUrl) {
  try {
    puppeteerPromise ??= import(
      pathToFileURL(process.env.PUPPETEER_ENTRY).href,
    );
    const puppeteer = await puppeteerPromise;
    browserPromise ??= puppeteer.default.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const browser = await browserPromise;
    const page = await browser.newPage();
    try {
      await page.setUserAgent(USER_AGENT);
      await page.setViewport({
        width: 1440,
        height: 1400,
        deviceScaleFactor: 1,
      });
      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 40_000,
      });
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 110));
        }
        window.scrollTo(0, 0);
      });
      await new Promise((resolve) => setTimeout(resolve, 900));
      const tokens = nameTokens(asset);
      const selected = await page.evaluate((wantedTokens) => {
        const nodes = [
          ...document.querySelectorAll("img"),
          ...[...document.querySelectorAll("*")].filter((element) =>
            getComputedStyle(element).backgroundImage?.includes("url("),
          ),
        ];
        let best = null;
        nodes.forEach((element, index) => {
          const rect = element.getBoundingClientRect();
          if (rect.width < 220 || rect.height < 120) return;
          const ratio = rect.width / rect.height;
          const cardLike =
            (ratio >= 1.1 && ratio <= 2.1) ||
            (ratio >= 0.47 && ratio <= 0.92);
          if (!cardLike) return;
          const haystack = `${
            element.currentSrc || element.getAttribute("src") || ""
          } ${element.getAttribute("alt") || ""} ${
            element.getAttribute("aria-label") || ""
          } ${element.className || ""}`.toLocaleLowerCase("en-US");
          let score = rect.width * rect.height / 5000 + 150;
          wantedTokens.forEach((token) => {
            if (haystack.includes(token)) score += 60;
          });
          if (/card|カード/iu.test(haystack)) score += 55;
          if (/logo|icon|favicon/iu.test(haystack)) score -= 100;
          if (!best || score > best.score)
            best = { index, score };
        });
        if (!best) return false;
        nodes[best.index].setAttribute(
          "data-poimichi-official-artwork",
          "selected",
        );
        return true;
      }, tokens);
      if (!selected) return null;
      const handle = await page.$(
        '[data-poimichi-official-artwork="selected"]',
      );
      if (!handle) return null;
      const bytes = Buffer.from(
        await handle.screenshot({ type: "png", omitBackground: true }),
      );
      return {
        bytes,
        imageUrl: `${pageUrl}#rendered-official-artwork`,
        mime: "image/png",
        dimensions: imageDimensions(bytes, "image/png"),
        descriptor: "official-rendered-element",
        score: 500,
        pageUrl,
        sourceKind: "official_rendered_element",
      };
    } finally {
      await page.close();
    }
  } catch {
    return null;
  }
}


async function officialLooseElementScreenshot(asset, pageUrl) {
  try {
    puppeteerPromise ??= import(
      pathToFileURL(process.env.PUPPETEER_ENTRY).href,
    );
    const puppeteer = await puppeteerPromise;
    browserPromise ??= puppeteer.default.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const browser = await browserPromise;
    const page = await browser.newPage();
    try {
      await page.setUserAgent(USER_AGENT);
      await page.setViewport({ width: 1440, height: 1400, deviceScaleFactor: 1 });
      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 650) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        window.scrollTo(0, 0);
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const wantedTokens = nameTokens(asset);
      const selected = await page.evaluate(
        ({ wantedTokens, wantCard }) => {
          const nodes = [
            ...document.querySelectorAll("img, svg"),
            ...[...document.querySelectorAll("*")].filter((element) =>
              getComputedStyle(element).backgroundImage?.includes("url("),
            ),
          ];
          let best = null;
          nodes.forEach((element, index) => {
            const rect = element.getBoundingClientRect();
            if (rect.width < 38 || rect.height < 24) return;
            if (rect.bottom < 0 || rect.top > window.innerHeight * 6) return;
            const naturalWidth = element.naturalWidth || rect.width;
            const naturalHeight = element.naturalHeight || rect.height;
            const ratio = naturalWidth / Math.max(1, naturalHeight);
            const cardLike =
              (ratio >= 1.08 && ratio <= 2.25) ||
              (ratio >= 0.44 && ratio <= 0.93);
            const haystack = `${
              element.currentSrc || element.getAttribute("src") || ""
            } ${element.getAttribute("alt") || ""} ${
              element.getAttribute("aria-label") || ""
            } ${element.getAttribute("title") || ""} ${element.className || ""} ${
              element.id || ""
            }`.normalize("NFKC").toLocaleLowerCase("en-US");
            let score = Math.min(100, (rect.width * rect.height) / 4000);
            wantedTokens.forEach((token) => {
              if (haystack.includes(token)) score += 85;
            });
            if (/logo|ロゴ|brand|mark/iu.test(haystack)) score += wantCard ? 25 : 150;
            if (/card|カード|credit/iu.test(haystack)) score += wantCard ? 150 : 5;
            if (/point|ポイント|pay|wallet|mile|suica|revolut|ana|jal/iu.test(haystack))
              score += 45;
            if (/banner|campaign|hero|mainvisual|news|bnr|kv/iu.test(haystack)) score -= 90;
            if (/favicon|sprite/iu.test(haystack)) score -= 80;
            if (wantCard) score += cardLike ? 260 : -120;
            else if (ratio >= 0.22 && ratio <= 6.5) score += 30;
            if (!best || score > best.score) best = { index, score };
          });
          if (!best || best.score < (wantCard ? 80 : 25)) return false;
          nodes[best.index].setAttribute(
            "data-poimichi-official-loose-artwork",
            "selected",
          );
          return true;
        },
        { wantedTokens, wantCard: isCreditCard(asset) },
      );
      if (!selected) return null;
      const handle = await page.$(
        '[data-poimichi-official-loose-artwork="selected"]',
      );
      if (!handle) return null;
      const bytes = Buffer.from(
        await handle.screenshot({ type: "png", omitBackground: true }),
      );
      return {
        bytes,
        imageUrl: `${pageUrl}#rendered-official-loose-artwork`,
        mime: "image/png",
        dimensions: imageDimensions(bytes, "image/png"),
        descriptor: "official-rendered-element-loose",
        score: 450,
        pageUrl,
        sourceKind: "official_rendered_element_loose",
      };
    } finally {
      await page.close();
    }
  } catch {
    return null;
  }
}

async function officialPageCapture(asset, pageUrl) {
  try {
    puppeteerPromise ??= import(
      pathToFileURL(process.env.PUPPETEER_ENTRY).href,
    );
    const puppeteer = await puppeteerPromise;
    browserPromise ??= puppeteer.default.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const browser = await browserPromise;
    const page = await browser.newPage();
    try {
      await page.setUserAgent(USER_AGENT);
      await page.setViewport({
        width: 1586,
        height: 1000,
        deviceScaleFactor: 1,
      });
      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await new Promise((resolve) => setTimeout(resolve, 1400));
      const bytes = Buffer.from(
        await page.screenshot({
          type: "png",
          clip: { x: 0, y: 0, width: 1586, height: 1000 },
        }),
      );
      return {
        bytes,
        imageUrl: `${pageUrl}#official-product-page-capture`,
        mime: "image/png",
        dimensions: { width: 1586, height: 1000 },
        descriptor: "official-product-page-capture",
        score: 200,
        pageUrl,
        sourceKind: "official_product_page_capture",
      };
    } finally {
      await page.close();
    }
  } catch {
    return null;
  }
}

async function acquireRemote(asset, pageUrl, explicitImageUrl) {
  if (explicitImageUrl) {
    const explicit = await evaluateCandidate(asset, {
      url: explicitImageUrl,
      descriptor: "official-explicit-image",
      alt: asset.display_name,
    });
    if (explicit) return { ...explicit, pageUrl, sourceKind: "official-explicit-image" };
  }

  let page;
try {
  page = await fetchBytes(pageUrl, {
    accept: "text/html,application/xhtml+xml,image/*,*/*;q=0.3",
    timeout: 28_000,
    maxBytes: 8_000_000,
  });
} catch {
  const origin = new URL(pageUrl).origin;
  try {
    page = await fetchBytes(`${origin}/`, {
      accept: "text/html,application/xhtml+xml,image/*,*/*;q=0.3",
      timeout: 28_000,
      maxBytes: 8_000_000,
    });
    pageUrl = page.url;
  } catch {
    page = {
      bytes: Buffer.from("", "utf8"),
      url: pageUrl,
      contentType: "text/html",
    };
  }
}

const pageMime = sniffMime(page.bytes, page.contentType);
  if (pageMime.startsWith("image/"))
    return {
      bytes: page.bytes,
      imageUrl: page.url,
      mime: pageMime,
      dimensions: imageDimensions(page.bytes, pageMime),
      descriptor: "official-direct-image",
      score: 999,
      pageUrl,
      sourceKind: "official-direct-image",
    };

  const html = page.bytes.toString("utf8");
  let candidates = staticCandidates(html, page.url);
  let best = await bestCandidate(asset, candidates);
  const minimum = isCreditCard(asset) ? 125 : 20;

  if (!best || best.score < minimum) {
    const rendered = await renderedCandidates(page.url);
    candidates = [
      ...candidates,
      ...rendered.map((candidate) => ({
        ...candidate,
        url: resolveUrl(candidate.url, page.url),
      })).filter((candidate) => candidate.url),
    ];
    best = await bestCandidate(
      asset,
      [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()],
    );
  }

  if (!best || best.score < minimum) {
  const searched = await officialSearchCandidates(asset, pageUrl);
  const searchedBest = await bestCandidate(asset, searched);
  if (searchedBest && searchedBest.score > (best?.score ?? -Infinity))
    best = searchedBest;
}

if (best && best.score >= minimum)
  return {
    ...best,
    pageUrl,
    sourceKind: best.descriptor.startsWith("rendered")
      ? "official_rendered_image"
      : best.descriptor === "official-domain-image-search"
        ? "official_domain_image_search"
        : "official_page_image",
  };

if (isCreditCard(asset)) {
  const renderedElement = await officialElementScreenshot(asset, pageUrl);
  if (renderedElement) return renderedElement;
}

const looseElement = await officialLooseElementScreenshot(asset, pageUrl);
if (looseElement) return looseElement;

if (!isCreditCard(asset)) {
  const favicon = await officialFavicon(page.url);
  if (favicon)
    return {
      ...favicon,
      pageUrl,
      sourceKind: "official_favicon_fallback",
    };
}

const pageCapture = await officialPageCapture(asset, pageUrl);
if (pageCapture)
  return {
    ...pageCapture,
    sourceKind: isCreditCard(asset)
      ? "official_product_page_capture"
      : "official_page_capture_fallback",
  };

try {
  const originPage = new URL(pageUrl).origin + "/";
  if (originPage !== pageUrl) {
    const originCapture = await officialPageCapture(asset, originPage);
    if (originCapture)
      return {
        ...originCapture,
        pageUrl,
        sourceKind: isCreditCard(asset)
          ? "official_product_origin_capture"
          : "official_origin_capture_fallback",
      };
  }
} catch {
  // The source URL was already validated earlier; this is only a last recovery path.
}

throw new Error(`official_artwork_not_found:${asset.id}`);
}

function localOfficial(asset, filename) {
  const path = join(PUBLIC_ROOT, "assets/payment-logos", filename);
  if (!existsSync(path)) throw new Error(`checked_in_artwork_missing:${filename}`);
  const bytes = readFileSync(path);
  const extension = extname(filename).toLocaleLowerCase("en-US");
  const declaredMime = extension === ".svg" ? "image/svg+xml" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".ico" ? "image/x-icon" : `image/${extension.slice(1)}`;
  const mime = sniffMime(bytes, declaredMime);
  return {
    bytes,
    imageUrl: `/assets/payment-logos/${filename}`,
    mime,
    dimensions: imageDimensions(bytes, mime),
    descriptor: "checked-in-official-artwork",
    score: 1000,
    pageUrl: sourcePageFor(asset),
    sourceKind: "checked_in_official_artwork",
  };
}

function genericSource(asset) {
  return {
    bytes: null,
    imageUrl: null,
    mime: null,
    dimensions: null,
    descriptor: "poimichi-generic-category",
    score: 0,
    pageUrl: null,
    sourceKind: "poimichi_generic_category",
    genericLabel: asset.display_name,
  };
}

const sourceCache = new Map();

async function acquireSource(asset, canonicalById) {
  const resolved = asset.alias_of ? canonicalById.get(asset.alias_of) : asset;
  if (!resolved) throw new Error(`alias_target_missing:${asset.id}`);
  const cacheKey = resolved.id;
  if (!sourceCache.has(cacheKey))
    sourceCache.set(
      cacheKey,
      (async () => {
        if (GENERIC_IDS.has(resolved.id)) return genericSource(resolved);
        const localFilename = LOCAL_OFFICIAL_ART[resolved.id];
        if (localFilename) return localOfficial(resolved, localFilename);
        const pageUrl = sourcePageFor(resolved);
        if (!pageUrl) throw new Error(`official_source_page_missing:${resolved.id}`);
        return acquireRemote(
          resolved,
          pageUrl,
          EXPLICIT_IMAGE_OVERRIDES[resolved.id] ?? resolved.source_image_url,
        );
      })(),
    );
  return { resolved, source: await sourceCache.get(cacheKey) };
}

function sourceFileFor(source) {
  if (!source.bytes) return null;
  const digest = sha256(source.bytes);
  const extension = extensionForMime(source.mime);
  const filename = `${digest.slice(0, 24)}${extension}`;
  const localPath = join(SOURCE_ROOT, filename);
  if (!existsSync(localPath)) write(localPath, source.bytes);
  return {
    digest,
    localPath,
    publicPath: `/assets/liquid-glass/sources/${filename}`,
  };
}

function genericSymbol(asset) {
  if (asset.id.includes("credit_card")) return "CARD";
  if (asset.id.includes("cashless")) return "PAY";
  if (asset.id.includes("ic_generic")) return "IC";
  if (asset.id.includes("emoney")) return "E";
  if (asset.id.includes("barcode")) return "QR";
  return "PAY";
}

function liquidGlassSvg(asset, source, sourceFile) {
  const id = safeSlug(asset.id);
  const title = escapeXml(asset.display_name);
  const sourceAttributes = [
    `data-asset-id="${escapeXml(asset.id)}"`,
    `data-source-kind="${escapeXml(source.sourceKind)}"`,
    source.pageUrl ? `data-source-page="${escapeXml(source.pageUrl)}"` : "",
    source.imageUrl ? `data-source-image="${escapeXml(source.imageUrl)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const isCard = isCreditCard(asset) || asset.id.startsWith("card.");
  const artworkHref = source.bytes && source.bytes.length <= 1500000
    ? `data:${source.mime};base64,${source.bytes.toString("base64")}`
    : sourceFile?.publicPath;
  const inner = artworkHref
    ? `<image x="${isCard ? 34 : 92}" y="${isCard ? 34 : 88}" width="${
        isCard ? 788 : 672
      }" height="${isCard ? 471.8 : 363.8}" href="${escapeXml(
        artworkHref,
      )}" preserveAspectRatio="xMidYMid meet" clip-path="url(#art-${id})"/>`
    : `<g aria-hidden="true"><rect x="118" y="155" width="620" height="230" rx="78" fill="#ffffff" fill-opacity="0.62"/><text x="428" y="302" text-anchor="middle" font-family="system-ui, sans-serif" font-size="92" font-weight="800" fill="#203244">${escapeXml(
        genericSymbol(asset),
      )}</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="856" height="539.8" viewBox="0 0 856 539.8" role="img" aria-labelledby="title-${id}" ${sourceAttributes}>
<title id="title-${id}">${title}</title>
<defs>
  <linearGradient id="glass-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.96"/><stop offset="0.56" stop-color="#edf4fb" stop-opacity="0.76"/><stop offset="1" stop-color="#d9e8f4" stop-opacity="0.68"/></linearGradient>
  <linearGradient id="shine-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.82"/><stop offset="0.46" stop-color="#ffffff" stop-opacity="0.12"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
  <filter id="shadow-${id}" x="-20%" y="-25%" width="140%" height="160%"><feDropShadow dx="0" dy="13" stdDeviation="13" flood-color="#24445f" flood-opacity="0.2"/></filter>
  <clipPath id="art-${id}"><rect x="${isCard ? 34 : 92}" y="${
    isCard ? 34 : 88
  }" width="${isCard ? 788 : 672}" height="${isCard ? 471.8 : 363.8}" rx="${
    isCard ? 46 : 58
  }"/></clipPath>
</defs>
<g filter="url(#shadow-${id})">
  <rect x="18" y="18" width="820" height="503.8" rx="58" fill="url(#glass-${id})" stroke="#ffffff" stroke-opacity="0.9" stroke-width="5"/>
  <rect x="28" y="28" width="800" height="483.8" rx="50" fill="#ffffff" fill-opacity="${
    isCard ? "0.74" : "0.56"
  }"/>
  ${inner}
  <path d="M48 80C230 16 568 20 808 77C660 184 420 211 92 192C66 157 52 117 48 80Z" fill="url(#shine-${id})"/>
  <path d="M43 448C240 355 522 358 824 222V470C824 495 806 508 779 508H77C59 508 48 486 43 448Z" fill="#75b8d8" fill-opacity="0.09"/>
  <path d="M42 393C279 245 538 311 822 160" fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="8"/>
  <rect x="24" y="24" width="808" height="491.8" rx="54" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="3"/>
</g>
</svg>
`;
}

function outputPathFor(asset) {
  const folder = asset.entity_type === "service_alias"
    ? "services"
    : isCreditCard(asset)
      ? "cards"
      : "entities";
  return join(OUTPUT_ROOT, folder, `${safeSlug(asset.id)}.svg`);
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

function labelsFor(asset) {
  const labels = new Set([asset.display_name]);
  if (asset.id === "point.d") labels.add("dポイント");
  if (asset.id === "point.nanaco") labels.add("nanacoポイント");
  if (asset.id === "point.paypay") labels.add("PayPayポイント");
  if (asset.id === "point.ponta") labels.add("Pontaポイント");
  if (asset.id === "point.rakuten") labels.add("楽天ポイント");
  if (asset.id === "point.v") labels.add("Vポイント");
  if (asset.id === "wallet.rakutenpay") labels.add("楽天ペイ");
  if (asset.id === "point.moppy") labels.add("ポイント(moppy)");
  if (asset.id === "point.saison") labels.add("ポイント(saison)");
  if (asset.id === "program.jp.nanaco") labels.add("nanacoポイント");
  return [...labels];
}


const LIQUID_GLASS_SCOPE_EXCLUDED_IDS = new Set([
  "program.jp.amazonpoint",
  "program.jp.zozopoint",
  "instrument.payment.bank-transfer",
  "instrument.payment.bitcoin",
  "instrument.payment.carrier-billing",
  "instrument.payment.cash-on-delivery",
  "instrument.payment.convenience-store",
  "instrument.payment.credit-card",
  "instrument.payment.debit-card",
  "instrument.payment.netbank-atm",
  "instrument.payment.paidy",
  "instrument.payment.pay-easy",
  "instrument.payment.paypal",
  "instrument.payment.postal-transfer",
  "instrument.payment.postpay",
  "instrument.payment.shopping-loan",
  "instrument.payment.zozocard",
  "instrument.value.amazon-gift-card",
  "instrument.value.biccamera-gift-card",
  "instrument.value.yahoo-shopping-voucher",
]);

function liquidGlassCanonicalScope(assets) {
  const selected = assets.filter(
    (asset) => !LIQUID_GLASS_SCOPE_EXCLUDED_IDS.has(asset.asset_id),
  );
  if (selected.length !== EXPECTED_CANONICAL)
    throw new Error(
      `liquid_glass_scope_invalid:${selected.length}:catalogue=${assets.length}`,
    );
  return selected;
}

async function waitForCatalogue() {
  const deadline = Date.now() + 25 * 60_000;
  let lastError = "not_started";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `${PRODUCTION_ORIGIN}/asset-sources?cache=${Date.now()}`,
        { headers: { accept: "application/json" }, cache: "no-store" },
      );
      if (!response.ok) throw new Error(`http_${response.status}`);
      const body = await response.json();
      if (
        body.version === "asset-source-catalogue.v1" &&
        Array.isArray(body.assets) &&
        liquidGlassCanonicalScope(body.assets).length === EXPECTED_CANONICAL
      )
        return body;
      lastError = `unexpected_count:${body.assets?.length}`;
    } catch (error) {
      lastError = String(error);
    }
    await sleep(15_000);
  }
  throw new Error(`asset_source_catalogue_timeout:${lastError}`);
}

async function generateAssets(catalogue) {
  rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  mkdirSync(SOURCE_ROOT, { recursive: true });

  const canonical = liquidGlassCanonicalScope(catalogue.assets).map((asset) => ({
    id: asset.asset_id,
    display_name: asset.display_name,
    entity_type: asset.entity_type,
    metadata: asset.metadata ?? {},
    source_page_url: asset.source_page_url,
    source_image_url: asset.source_image_url,
    source_origin: asset.source_origin,
    checked_at: asset.checked_at,
    alias_of: null,
  }));
  if (canonical.length !== EXPECTED_CANONICAL)
    throw new Error(`canonical_count_invalid:${canonical.length}`);
  const canonicalById = new Map(canonical.map((asset) => [asset.id, asset]));
  const assets = [...canonical, ...ALIASES];
  if (assets.length !== EXPECTED_ASSETS)
    throw new Error(`asset_count_invalid:${assets.length}`);
  if (new Set(assets.map((asset) => asset.id)).size !== EXPECTED_ASSETS)
    throw new Error("asset_ids_not_unique");

  const failures = [];
  const generated = await mapLimit(assets, 5, async (asset) => {
    try {
      const { resolved, source } = await acquireSource(asset, canonicalById);
      const sourceFile = sourceFileFor(source);
      const outputPath = outputPathFor(asset);
      write(outputPath, liquidGlassSvg(asset, source, sourceFile));
      return {
        id: asset.id,
        display_name: asset.display_name,
        labels: labelsFor(asset),
        entity_type: asset.entity_type,
        alias_of: asset.alias_of,
        resolved_id: resolved.id,
        path: `/${relative(PUBLIC_ROOT, outputPath).replaceAll("\\\\", "/")}`,
        aspect_ratio: "85.60:53.98",
        transparent_outside_card: true,
        source_kind: source.sourceKind,
        source_page_url: source.pageUrl,
        source_image_url: source.imageUrl,
        source_sha256: sourceFile?.digest ?? null,
        source_asset_path: sourceFile?.publicPath ?? null,
        source_mime: source.mime,
        source_dimensions: source.dimensions,
        source_score: source.score,
        official_reference_preserved: source.sourceKind !== "poimichi_generic_category",
      };
    } catch (error) {
      failures.push({ id: asset.id, error: String(error) });
      return null;
    }
  });

  if (failures.length > 0) {
    writeJson(join(OUTPUT_ROOT, "generation-failures.json"), failures);
    console.error("LIQUID_GLASS_GENERATION_FAILURES=" + JSON.stringify(failures));
    throw new Error(`asset_generation_failed:${failures.length}`);
  }

  const rows = generated.filter(Boolean);
  const generationRunId = `liquid-glass-${Date.now()}-${sha256(
    JSON.stringify(rows.map((row) => [row.id, row.source_sha256])),
  ).slice(0, 12)}`;
  const sourceStats = rows.reduce((stats, row) => {
    stats[row.source_kind] = (stats[row.source_kind] ?? 0) + 1;
    return stats;
  }, {});
  const manifest = {
    version: "liquid-glass-assets.v2",
    generation_run_id: generationRunId,
    generated_at: new Date().toISOString(),
    source_catalogue_deployment_commit_sha: catalogue.deployment_commit_sha,
    aspect_ratio: "85.60:53.98",
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    canonical_count: EXPECTED_CANONICAL,
    alias_count: EXPECTED_ALIASES,
    asset_count: rows.length,
    source_stats: sourceStats,
    assets: rows.sort((left, right) => left.id.localeCompare(right.id)),
  };
  writeJson(join(OUTPUT_ROOT, "manifest.json"), manifest);
  writeJson(join(OUTPUT_ROOT, "generation-report.json"), {
    generation_run_id: generationRunId,
    asset_count: rows.length,
    source_stats: sourceStats,
    card_count: rows.filter((row) => row.entity_type === "credit_card").length,
    fallback_count: rows.filter((row) => row.source_kind.includes("fallback")).length,
  });
  writeJson(join(ROOT, "registry/assets/liquid-glass-assets.v2.json"), manifest);

  const sourceLines = [
    "# Liquid Glass asset source register",
    "",
    "Every branded wrapper preserves first-party artwork acquired from the recorded official page. The outer ID-1 card material is Poimichi artwork. Generic payment categories are product-owned neutral symbols.",
    "",
    "| Asset ID | Source type | Official page | Artwork URL | SHA-256 |",
    "|---|---|---|---|---|",
    ...manifest.assets.map(
      (row) =>
        `| ${row.id} | ${row.source_kind} | ${row.source_page_url ?? "—"} | ${
          row.source_image_url ?? "—"
        } | ${row.source_sha256 ?? "—"} |`,
    ),
    "",
  ];
  write(join(OUTPUT_ROOT, "SOURCES.md"), sourceLines.join("\n"));
  return manifest;
}

function validateManifest(manifest) {
  if (manifest.asset_count !== EXPECTED_ASSETS)
    throw new Error(`manifest_asset_count_invalid:${manifest.asset_count}`);
  if (manifest.canonical_count !== EXPECTED_CANONICAL)
    throw new Error("manifest_canonical_count_invalid");
  if (manifest.alias_count !== EXPECTED_ALIASES)
    throw new Error("manifest_alias_count_invalid");
  if (new Set(manifest.assets.map((asset) => asset.id)).size !== EXPECTED_ASSETS)
    throw new Error("manifest_ids_not_unique");

  const invalid = [];
  for (const asset of manifest.assets) {
    const path = join(PUBLIC_ROOT, asset.path.replace(/^\//u, ""));
    if (!existsSync(path)) {
      invalid.push(`${asset.id}:missing_file`);
      continue;
    }
    const svg = readFileSync(path, "utf8");
    if (!svg.includes('viewBox="0 0 856 539.8"'))
      invalid.push(`${asset.id}:wrong_ratio`);
    if (!svg.includes("data-source-kind="))
      invalid.push(`${asset.id}:missing_provenance`);
    if (asset.source_kind !== "poimichi_generic_category" && !asset.source_sha256)
      invalid.push(`${asset.id}:missing_original_bytes`);
    if (asset.entity_type === "credit_card") {
      if (
        [
          "official_favicon_fallback",
          "poimichi_generic_category",
        ].includes(asset.source_kind)
      )
        invalid.push(`${asset.id}:non_card_source`);
      const dimensions = asset.source_dimensions;
      if (dimensions?.width && dimensions?.height) {
        const ratio = dimensions.width / dimensions.height;
        const cardLike =
          (ratio >= 1.1 && ratio <= 2.1) || (ratio >= 0.47 && ratio <= 0.92);
        if (!cardLike) invalid.push(`${asset.id}:source_not_card_shaped:${ratio}`);
      }
    }
  }
  if (invalid.length > 0) {
    writeJson(join(OUTPUT_ROOT, "validation-failures.json"), invalid);
    throw new Error(`asset_validation_failed:${invalid.length}`);
  }
}


async function renderedArtworkMetrics(assetPath) {
  try {
    puppeteerPromise ??= import(
      pathToFileURL(process.env.PUPPETEER_ENTRY).href,
    );
    const puppeteer = await puppeteerPromise;
    browserPromise ??= puppeteer.default.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const browser = await browserPromise;
    const page = await browser.newPage();
    try {
      await page.goto(PRODUCTION_ORIGIN, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      return await page.evaluate(async (source) => {
        const image = new Image();
        image.src = `${source}?render=${Date.now()}`;
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
        });
        const canvas = document.createElement("canvas");
        canvas.width = 428;
        canvas.height = 270;
        const context = canvas.getContext("2d", {
          willReadFrequently: true,
        });
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let opaque = 0;
        let colorful = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const red = pixels[index];
          const green = pixels[index + 1];
          const blue = pixels[index + 2];
          const alpha = pixels[index + 3];
          if (alpha > 20) opaque += 1;
          if (
            alpha > 20 &&
            Math.max(red, green, blue) - Math.min(red, green, blue) > 28
          )
            colorful += 1;
        }
        return { opaque, colorful };
      }, `${PRODUCTION_ORIGIN}${assetPath}`);
    } finally {
      await page.close();
    }
  } catch {
    return { opaque: 0, colorful: 0 };
  }
}

async function waitForProductionManifest(generationRunId) {
  const deadline = Date.now() + 25 * 60_000;
  let lastError = "not_started";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `${PRODUCTION_ORIGIN}/assets/liquid-glass/manifest.json?cache=${Date.now()}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`http_${response.status}`);
      const manifest = await response.json();
      if (
        manifest.version === "liquid-glass-assets.v2" &&
        manifest.generation_run_id === generationRunId &&
        manifest.asset_count === EXPECTED_ASSETS
      ) {
        for (const id of [
          "point.d",
          "point.moppy",
          "card.rakuten",
          "instrument.card.d-card-gold",
        ]) {
          const asset = manifest.assets.find((item) => item.id === id);
          if (!asset) throw new Error(`production_asset_missing:${id}`);
          const assetResponse = await fetch(`${PRODUCTION_ORIGIN}${asset.path}`);
          if (!assetResponse.ok) throw new Error(`production_file_missing:${id}`);
          const svg = await assetResponse.text();
          if (!svg.includes('viewBox="0 0 856 539.8"'))
            throw new Error(`production_ratio_invalid:${id}`);
          const metrics = await renderedArtworkMetrics(asset.path);
          if (metrics.opaque < 60000 || metrics.colorful < 1200)
            throw new Error(
              `production_artwork_not_rendered:${id}:${JSON.stringify(metrics)}`,
            );
        }
        const runtime = await fetch(`${PRODUCTION_ORIGIN}/coverage.js?cache=${Date.now()}`);
        const runtimeText = await runtime.text();
        if (runtimeText.includes("makeLiquidAsset") || runtimeText.includes("brandMark"))
          throw new Error("generic_runtime_still_deployed");
        return;
      }
      lastError = `run_mismatch:${manifest.generation_run_id}`;
    } catch (error) {
      lastError = String(error);
    }
    await sleep(15_000);
  }
  throw new Error(`production_manifest_timeout:${lastError}`);
}

async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    // Nothing to close.
  }
}

async function main() {
  gitConfigure();
  syncMain();
  installPipelineFiles();
  run("pnpm", ["exec", "biome", "format", "--write", "api/asset-sources.mjs", "apps/consumer-alpha/public/coverage.js", "apps/consumer-alpha/public/liquid-glass.css", "apps/consumer-alpha/src/asset-source-catalogue.ts", "scripts/complete_liquid_glass_assets.mjs", "vercel.json"]);
  run("pnpm", ["--filter", "@jro/consumer-alpha-app", "typecheck"]);
  run("pnpm", ["--filter", "@jro/consumer-alpha-app", "build"]);
  commitAndPush("Expose official asset source catalogue", [
    "api/asset-sources.mjs",
    "apps/consumer-alpha/public/coverage.js",
    "apps/consumer-alpha/public/liquid-glass.css",
    "apps/consumer-alpha/src/asset-source-catalogue.ts",
    "supabase/migrations/20260825202837_asset_source_catalogue.sql",
    "vercel.json",
    "scripts/complete_liquid_glass_assets.mjs",
    
  ]);

  const catalogue = await waitForCatalogue();
  const manifest = await generateAssets(catalogue);
  validateManifest(manifest);
  run("git", ["pull", "--rebase", "--autostash", "origin", "main"]);
  const generatedCommit = commitAndPush(
    "Generate 246 reference-faithful Liquid Glass assets [assets-generated]",
    ["apps/consumer-alpha/public/assets/liquid-glass", "registry/assets/liquid-glass-assets.v2.json"],
  );
  writeJson(join(OUTPUT_ROOT, "deployment-receipt.json"), {
    generation_run_id: manifest.generation_run_id,
    generated_commit: generatedCommit,
    asset_count: manifest.asset_count,
  });
  await waitForProductionManifest(manifest.generation_run_id);
  console.log(
    JSON.stringify({
      status: "complete",
      generation_run_id: manifest.generation_run_id,
      generated_commit: generatedCommit,
      asset_count: manifest.asset_count,
    }),
  );
}

try {
  await main();
} finally {
  await closeBrowser();
}
