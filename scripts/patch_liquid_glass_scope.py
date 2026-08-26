from pathlib import Path

path = Path("scripts/complete_liquid_glass_assets.mjs")
text = path.read_text()

scope_patch = r'''
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

'''

marker = "async function waitForCatalogue() {"
if "LIQUID_GLASS_SCOPE_EXCLUDED_IDS" not in text:
    if marker not in text:
        raise SystemExit("waitForCatalogue marker missing")
    text = text.replace(marker, scope_patch + marker, 1)

old_count = "body.assets.length === EXPECTED_CANONICAL"
new_count = "liquidGlassCanonicalScope(body.assets).length === EXPECTED_CANONICAL"
if old_count in text:
    text = text.replace(old_count, new_count, 1)
elif new_count not in text:
    raise SystemExit("catalogue count condition missing")

old_map = "const canonical = catalogue.assets.map((asset) => ({"
new_map = "const canonical = liquidGlassCanonicalScope(catalogue.assets).map((asset) => ({"
if old_map in text:
    text = text.replace(old_map, new_map, 1)
elif new_map not in text:
    raise SystemExit("canonical map marker missing")

# Seven Card Plus remains an active/legacy supported product but its catalogue row
# predates the source-page field. The issuer's homepage is now the canonical product page.
page_marker = "const PAGE_OVERRIDES = Object.freeze({\n"
seven_override = '  "instrument.jp.seven-card-plus": "https://www.7card.co.jp/",\n'
if '"instrument.jp.seven-card-plus"' not in text:
    if page_marker not in text:
        raise SystemExit("PAGE_OVERRIDES marker missing")
    text = text.replace(page_marker, page_marker + seven_override, 1)

# Add a browser-rendered recovery path that preserves an actual element from the
# first-party page when static image discovery misses lazy-loaded or CSS artwork.
loose_marker = "async function officialPageCapture(asset, pageUrl) {"
loose_function = r'''async function officialLooseElementScreenshot(asset, pageUrl) {
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

'''
if "async function officialLooseElementScreenshot" not in text:
    if loose_marker not in text:
        raise SystemExit("officialPageCapture marker missing")
    text = text.replace(loose_marker, loose_function + loose_marker, 1)

old_fallback = r'''if (isCreditCard(asset)) {
  const renderedElement = await officialElementScreenshot(asset, pageUrl);
  if (renderedElement) return renderedElement;
  const pageCapture = await officialPageCapture(asset, pageUrl);
  if (pageCapture) return pageCapture;
}

if (!isCreditCard(asset)) {
    const favicon = await officialFavicon(page.url);
    if (favicon)
      return {
        ...favicon,
        pageUrl,
        sourceKind: "official_favicon_fallback",
      };
  }
  throw new Error(`official_artwork_not_found:${asset.id}`);'''
new_fallback = r'''if (isCreditCard(asset)) {
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

throw new Error(`official_artwork_not_found:${asset.id}`);'''
if old_fallback in text:
    text = text.replace(old_fallback, new_fallback, 1)
elif "const looseElement = await officialLooseElementScreenshot" not in text:
    raise SystemExit("acquireRemote fallback block missing")

# Keep the MIME normalization repair used by prior completion attempts.
old_mime = 'const mime = sniffMime(bytes, `image/${extname(filename).slice(1)}`);'
new_mime = 'const extension = extname(filename).toLocaleLowerCase("en-US");\n  const declaredMime = extension === ".svg" ? "image/svg+xml" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".ico" ? "image/x-icon" : `image/${extension.slice(1)}`;\n  const mime = sniffMime(bytes, declaredMime);'
if old_mime in text:
    text = text.replace(old_mime, new_mime, 1)

# Surface exact acquisition failures in GitHub Actions rather than losing them with
# the ephemeral runner filesystem.
old_failure = '''  if (failures.length > 0) {\n    writeJson(join(OUTPUT_ROOT, "generation-failures.json"), failures);\n    throw new Error(`asset_generation_failed:${failures.length}`);\n  }'''
new_failure = '''  if (failures.length > 0) {\n    writeJson(join(OUTPUT_ROOT, "generation-failures.json"), failures);\n    console.error("LIQUID_GLASS_GENERATION_FAILURES=" + JSON.stringify(failures));\n    throw new Error(`asset_generation_failed:${failures.length}`);\n  }'''
if old_failure in text:
    text = text.replace(old_failure, new_failure, 1)
elif "LIQUID_GLASS_GENERATION_FAILURES=" not in text:
    raise SystemExit("generation failure block missing")

# The generator must not rewrite the workflow file that triggered it.
text = text.replace('".github/workflows/liquid-glass-assets-completion.yml", ', '')

path.write_text(text)
print("Liquid Glass generator patched for scope, diagnostics, and rendered-source recovery")
