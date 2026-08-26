from pathlib import Path

path = Path("scripts/complete_liquid_glass_assets.mjs")
text = path.read_text()

helper_marker = "async function generateAssets(catalogue) {"
helper = r'''function batchValidationErrors(asset) {
  const invalid = [];
  const path = join(PUBLIC_ROOT, asset.path.replace(/^\//u, ""));
  if (!existsSync(path)) {
    invalid.push(`${asset.id}:missing_file`);
    return invalid;
  }
  const svg = readFileSync(path, "utf8");
  if (!svg.includes('viewBox="0 0 856 539.8"'))
    invalid.push(`${asset.id}:wrong_ratio`);
  if (!svg.includes("data-source-kind="))
    invalid.push(`${asset.id}:missing_provenance`);
  if (asset.source_kind !== "poimichi_generic_category" && !asset.source_sha256)
    invalid.push(`${asset.id}:missing_original_bytes`);
  if (asset.entity_type === "credit_card") {
    if (["official_favicon_fallback", "poimichi_generic_category"].includes(asset.source_kind))
      invalid.push(`${asset.id}:non_card_source`);
    const dimensions = asset.source_dimensions;
    if (dimensions?.width && dimensions?.height) {
      const ratio = dimensions.width / dimensions.height;
      const cardLike =
        (ratio >= 1.1 && ratio <= 2.1) || (ratio >= 0.47 && ratio <= 0.92);
      if (!cardLike) invalid.push(`${asset.id}:source_not_card_shaped:${ratio}`);
    }
  }
  return invalid;
}

'''
if "function batchValidationErrors(asset)" not in text:
    if helper_marker not in text:
        raise SystemExit("generateAssets marker missing")
    text = text.replace(helper_marker, helper + helper_marker, 1)

start_old = '''  const failures = [];
  const generated = await mapLimit(assets, 5, async (asset) => {
'''
start_new = '''  const failures = [];
  const generated = [];
  const batchSize = 20;
  const totalBatches = Math.ceil(assets.length / batchSize);
  for (let batchStart = 0; batchStart < assets.length; batchStart += batchSize) {
    const batchNumber = Math.floor(batchStart / batchSize) + 1;
    const batch = assets.slice(batchStart, batchStart + batchSize);
    console.log(
      `LIQUID_GLASS_BATCH_START batch=${batchNumber}/${totalBatches} assets=${batch.length}`,
    );
    const batchGenerated = await mapLimit(batch, 5, async (asset) => {
'''
if "LIQUID_GLASS_BATCH_START" not in text:
    if start_old not in text:
        raise SystemExit("generation start marker missing")
    text = text.replace(start_old, start_new, 1)

end_old = '''    } catch (error) {
      failures.push({ id: asset.id, error: String(error) });
      return null;
    }
  });

  if (failures.length > 0) {
'''
end_new = '''    } catch (error) {
      failures.push({ id: asset.id, error: String(error) });
      return null;
    }
    });
    generated.push(...batchGenerated);
    const batchRows = batchGenerated.filter(Boolean);
    const batchValidation = batchRows.map((asset) => {
      const errors = batchValidationErrors(asset);
      return {
        asset_id: asset.id,
        status: errors.length > 0 ? "invalid" : "valid",
        errors,
      };
    });
    if (batchValidation.length > 0)
      await durableCache.markValidationBatch(batchValidation);
    console.log(
      `LIQUID_GLASS_BATCH_COMPLETE batch=${batchNumber}/${totalBatches} ` +
        `generated=${batchRows.length} valid=${batchValidation.filter((row) => row.status === "valid").length} ` +
        `invalid=${batchValidation.filter((row) => row.status === "invalid").length} ` +
        `generation_failures=${batch.length - batchRows.length}`,
    );
  }

  if (failures.length > 0) {
'''
if "LIQUID_GLASS_BATCH_COMPLETE" not in text:
    if end_old not in text:
        raise SystemExit("generation end marker missing")
    text = text.replace(end_old, end_new, 1)

path.write_text(text)
print("Liquid Glass generation split into durable 20-asset checkpoints")
