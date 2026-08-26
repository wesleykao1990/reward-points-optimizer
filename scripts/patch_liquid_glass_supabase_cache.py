from pathlib import Path

path = Path("scripts/complete_liquid_glass_assets.mjs")
text = path.read_text()

import_marker = 'import { pathToFileURL } from "node:url";\n'
cache_import = 'import { createLiquidGlassCacheClient } from "./liquid_glass_cache.mjs";\n'
if cache_import not in text:
    if import_marker not in text:
        raise SystemExit("pathToFileURL import marker missing")
    text = text.replace(import_marker, import_marker + cache_import, 1)

origin_marker = '''const PRODUCTION_ORIGIN =
  process.env.LIQUID_GLASS_PRODUCTION_ORIGIN ??
  "https://reward-points-optimizer-consumer-al.vercel.app";
'''
cache_globals = '''const durableCache = createLiquidGlassCacheClient(PRODUCTION_ORIGIN);
const durableSourceByAssetId = new Map();
const durableAssetById = new Map();
'''
if cache_globals not in text:
    if origin_marker not in text:
        raise SystemExit("PRODUCTION_ORIGIN marker missing")
    text = text.replace(origin_marker, origin_marker + cache_globals, 1)

source_cache_marker = 'const sourceCache = new Map();\n'
cache_helpers = '''function durableSourceObject(row) {
  return {
    bytes: Buffer.from(row.content_base64, "base64"),
    imageUrl: row.official_image_url ?? null,
    mime: row.mime_type,
    dimensions:
      row.width && row.height ? { width: Number(row.width), height: Number(row.height) } : null,
    descriptor: "supabase-persisted-official-artwork",
    score: 1000,
    pageUrl: row.official_page_url ?? null,
    sourceKind: row.source_kind,
  };
}

async function hydrateDurableCache(assetIds) {
  durableSourceByAssetId.clear();
  durableAssetById.clear();
  const cached = await durableCache.getCache(assetIds);
  for (const row of cached.sources ?? []) durableSourceByAssetId.set(row.asset_id, row);
  for (const row of cached.assets ?? []) durableAssetById.set(row.asset_id, row);
  console.log(
    `LIQUID_GLASS_CACHE reused_assets=${durableAssetById.size} cached_sources=${durableSourceByAssetId.size}`,
  );
}

'''
if 'function durableSourceObject(row)' not in text:
    if source_cache_marker not in text:
        raise SystemExit("sourceCache marker missing")
    text = text.replace(source_cache_marker, cache_helpers + source_cache_marker, 1)

acquire_marker = '''      (async () => {
        if (GENERIC_IDS.has(resolved.id)) return genericSource(resolved);
'''
acquire_replacement = '''      (async () => {
        const persisted = durableSourceByAssetId.get(resolved.id);
        if (persisted) return durableSourceObject(persisted);
        if (GENERIC_IDS.has(resolved.id)) return genericSource(resolved);
'''
if 'const persisted = durableSourceByAssetId.get(resolved.id);' not in text:
    if acquire_marker not in text:
        raise SystemExit("acquireSource insertion marker missing")
    text = text.replace(acquire_marker, acquire_replacement, 1)

asset_count_marker = '''  if (new Set(assets.map((asset) => asset.id)).size !== EXPECTED_ASSETS)
    throw new Error("asset_ids_not_unique");

  const failures = [];
'''
asset_count_replacement = '''  if (new Set(assets.map((asset) => asset.id)).size !== EXPECTED_ASSETS)
    throw new Error("asset_ids_not_unique");

  const generationRunId = `liquid-glass-${Date.now()}-${sha256(
    JSON.stringify(assets.map((asset) => asset.id)),
  ).slice(0, 12)}`;
  await durableCache.waitUntilReady();
  await hydrateDurableCache(assets.map((asset) => asset.id));

  const failures = [];
'''
if 'await hydrateDurableCache(assets.map((asset) => asset.id));' not in text:
    if asset_count_marker not in text:
        raise SystemExit("generateAssets cache insertion marker missing")
    text = text.replace(asset_count_marker, asset_count_replacement, 1)

map_marker = '''  const generated = await mapLimit(assets, 5, async (asset) => {
    try {
      const { resolved, source } = await acquireSource(asset, canonicalById);
      const sourceFile = sourceFileFor(source);
      const outputPath = outputPathFor(asset);
      write(outputPath, liquidGlassSvg(asset, source, sourceFile));
      return {
'''
map_replacement = '''  const generated = await mapLimit(assets, 5, async (asset) => {
    try {
      const outputPath = outputPathFor(asset);
      const cachedAsset = durableAssetById.get(asset.id);
      const cachedSourceRow =
        durableSourceByAssetId.get(asset.id) ??
        (asset.alias_of ? durableSourceByAssetId.get(asset.alias_of) : null);
      if (
        cachedAsset &&
        (!cachedAsset.source_sha256 ||
          cachedSourceRow?.source_sha256 === cachedAsset.source_sha256)
      ) {
        if (cachedSourceRow) sourceFileFor(durableSourceObject(cachedSourceRow));
        write(outputPath, cachedAsset.svg_text);
        return {
          id: asset.id,
          display_name: asset.display_name,
          labels: labelsFor(asset),
          entity_type: asset.entity_type,
          alias_of: asset.alias_of,
          resolved_id: asset.alias_of ?? asset.id,
          path: `/${relative(PUBLIC_ROOT, outputPath).replaceAll("\\\\", "/")}`,
          aspect_ratio: "85.60:53.98",
          transparent_outside_card: true,
          source_kind: cachedAsset.source_kind,
          source_page_url: cachedAsset.source_page_url,
          source_image_url: cachedAsset.source_image_url,
          source_sha256: cachedAsset.source_sha256,
          source_asset_path: cachedAsset.source_asset_path,
          source_mime: cachedAsset.source_mime,
          source_dimensions: cachedAsset.source_dimensions,
          source_score: null,
          official_reference_preserved:
            cachedAsset.source_kind !== "poimichi_generic_category",
          reused_from_supabase: true,
        };
      }

      const { resolved, source } = await acquireSource(asset, canonicalById);
      const sourceFile = sourceFileFor(source);
      const svg = liquidGlassSvg(asset, source, sourceFile);
      write(outputPath, svg);
      if (source.bytes && sourceFile) {
        await durableCache.storeSource({
          asset_id: asset.id,
          alias_of: asset.alias_of,
          source_sha256: sourceFile.digest,
          source_kind: source.sourceKind,
          mime_type: source.mime,
          content_base64: source.bytes.toString("base64"),
          width: source.dimensions?.width ?? null,
          height: source.dimensions?.height ?? null,
          official_page_url: source.pageUrl ?? null,
          official_image_url: source.imageUrl ?? null,
        });
      }
      await durableCache.storeAsset({
        asset_id: asset.id,
        alias_of: asset.alias_of,
        display_name: asset.display_name,
        entity_type: asset.entity_type,
        svg_text: svg,
        svg_sha256: sha256(svg),
        generation_run_id: generationRunId,
        source_kind: source.sourceKind,
        source_page_url: source.pageUrl ?? null,
        source_image_url: source.imageUrl ?? null,
        source_sha256: sourceFile?.digest ?? null,
        source_asset_path: sourceFile?.publicPath ?? null,
        source_mime: source.mime,
        source_dimensions: source.dimensions,
      });
      return {
'''
if 'reused_from_supabase: true' not in text:
    if map_marker not in text:
        raise SystemExit("generation mapper marker missing")
    text = text.replace(map_marker, map_replacement, 1)

old_run_id = '''  const rows = generated.filter(Boolean);
  const generationRunId = `liquid-glass-${Date.now()}-${sha256(
    JSON.stringify(rows.map((row) => [row.id, row.source_sha256])),
  ).slice(0, 12)}`;
'''
new_run_id = '''  const rows = generated.filter(Boolean);
'''
if old_run_id in text:
    text = text.replace(old_run_id, new_run_id, 1)
elif text.count('const generationRunId = `liquid-glass-') != 1:
    raise SystemExit("generationRunId deduplication marker missing")

validation_helper_marker = 'async function renderedArtworkMetrics(assetPath) {'
validation_helpers = '''async function persistValidationResults(manifest, validationError = null) {
  let failures = [];
  const failurePath = join(OUTPUT_ROOT, "validation-failures.json");
  if (validationError && existsSync(failurePath)) {
    try {
      failures = JSON.parse(readFileSync(failurePath, "utf8"));
    } catch {
      failures = [];
    }
  }
  const records = manifest.assets.map((asset) => {
    const errors = failures.filter(
      (failure) => typeof failure === "string" && failure.startsWith(`${asset.id}:`),
    );
    return {
      asset_id: asset.id,
      status: errors.length > 0 ? "invalid" : "valid",
      errors,
    };
  });
  await durableCache.markValidationBatch(records);
}

'''
if 'async function persistValidationResults' not in text:
    if validation_helper_marker not in text:
        raise SystemExit("validation helper insertion marker missing")
    text = text.replace(validation_helper_marker, validation_helpers + validation_helper_marker, 1)

main_validation = '''  const catalogue = await waitForCatalogue();
  const manifest = await generateAssets(catalogue);
  validateManifest(manifest);
  run("git", ["pull", "--rebase", "--autostash", "origin", "main"]);
'''
main_validation_replacement = '''  const catalogue = await waitForCatalogue();
  const manifest = await generateAssets(catalogue);
  try {
    validateManifest(manifest);
    await persistValidationResults(manifest);
  } catch (error) {
    await persistValidationResults(manifest, error);
    throw error;
  }
  run("git", ["pull", "--rebase", "--autostash", "origin", "main"]);
'''
if 'await persistValidationResults(manifest);' not in text:
    if main_validation not in text:
        raise SystemExit("main validation marker missing")
    text = text.replace(main_validation, main_validation_replacement, 1)

production_marker = '''  await waitForProductionManifest(manifest.generation_run_id);
  console.log(
'''
production_replacement = '''  await waitForProductionManifest(manifest.generation_run_id);
  await durableCache.markDeployed(manifest.assets.map((asset) => asset.id));
  console.log(
'''
if 'await durableCache.markDeployed(manifest.assets.map((asset) => asset.id));' not in text:
    if production_marker not in text:
        raise SystemExit("production cache marker missing")
    text = text.replace(production_marker, production_replacement, 1)

path.write_text(text)
print("Liquid Glass pipeline now persists and reuses official source bytes and generated SVGs through Supabase")
