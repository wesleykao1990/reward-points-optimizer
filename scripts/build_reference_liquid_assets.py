#!/usr/bin/env python3
"""Build the complete Poimichi Liquid Glass asset catalogue.

Brand artwork is never redrawn. Each branded asset embeds either the exact
checked-in first-party artwork or a screenshot of the relevant element on the
official provider/issuer page. Poimichi contributes only the surrounding
transparent ID-1 card-ratio glass material.
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path.cwd()
PUBLIC_ROOT = ROOT / "apps/consumer-alpha/public"
OUTPUT_ROOT = PUBLIC_ROOT / "assets/liquid-glass"
CAPTURE_ROOT = ROOT / ".liquid-glass-captures"
REGISTRY_ROOT = ROOT / "registry/assets"
PRODUCTION_ORIGIN = os.environ.get(
    "LIQUID_GLASS_PRODUCTION_ORIGIN",
    "https://reward-points-optimizer-consumer-al.vercel.app",
).rstrip("/")
EXPECTED_CANONICAL = 211
EXPECTED_ALIASES = 35
EXPECTED_TOTAL = EXPECTED_CANONICAL + EXPECTED_ALIASES
CARD_WIDTH = 856
CARD_HEIGHT = 539.8
CARD_RATIO = CARD_WIDTH / CARD_HEIGHT

ALIASES: list[dict[str, Any]] = [
    {"id": "point.d", "display_name": "dポイント", "alias_of": "program.jp.dpoint"},
    {"id": "point.jre", "display_name": "JRE POINT", "alias_of": "program.jp.jrepoint"},
    {"id": "point.nanaco", "display_name": "nanacoポイント", "alias_of": "program.jp.nanaco"},
    {"id": "point.paypay", "display_name": "PayPayポイント", "alias_of": "program.jp.paypaypoint"},
    {"id": "point.ponta", "display_name": "Pontaポイント", "alias_of": "program.jp.ponta"},
    {"id": "point.rakuten", "display_name": "楽天ポイント", "alias_of": "program.jp.rakutenpoint"},
    {"id": "point.v", "display_name": "Vポイント", "alias_of": "program.jp.vpoint"},
    {"id": "point.waon", "display_name": "WAON POINT", "alias_of": "program.jp.waonpoint"},
    {"id": "wallet.aeonpay", "display_name": "AEON Pay", "alias_of": "instrument.wallet.aeonpay"},
    {"id": "wallet.aupay", "display_name": "au PAY", "alias_of": "instrument.wallet.aupay"},
    {"id": "wallet.dbarai", "display_name": "d払い", "alias_of": "instrument.wallet.dbarai"},
    {"id": "wallet.famipay", "display_name": "FamiPay", "alias_of": "instrument.wallet.famipay"},
    {"id": "wallet.paypay", "display_name": "PayPay", "alias_of": "instrument.wallet.paypay"},
    {"id": "wallet.rakutenpay", "display_name": "楽天ペイ", "alias_of": "instrument.wallet.rakutenpay"},
    {"id": "card.aeon", "display_name": "AEON Card", "alias_of": "instrument.card.aeon"},
    {"id": "card.aupay", "display_name": "au PAY Card", "alias_of": "instrument.card.au-pay-card"},
    {"id": "card.d", "display_name": "d Card", "alias_of": "instrument.card.d"},
    {"id": "card.paypay", "display_name": "PayPay Card", "alias_of": "instrument.card.paypay-card"},
    {"id": "card.rakuten", "display_name": "Rakuten Card", "alias_of": "instrument.card.rakuten-card"},
    {"id": "card.smbc", "display_name": "Mitsui Sumitomo Card (NL)", "alias_of": "instrument.card.mitsui-sumitomo-card-nl"},
    {"id": "card.view", "display_name": "View Card Standard", "alias_of": "instrument.card.view-card-standard"},
    {"id": "point.moppy", "display_name": "ポイント (moppy)", "alias_of": None},
    {"id": "point.saison", "display_name": "ポイント (saison)", "alias_of": None},
    {"id": "point.saison-permanent", "display_name": "永久不滅ポイント", "alias_of": None},
    {"id": "point.jr-kyupo", "display_name": "JRキューポ", "alias_of": None},
    {"id": "point.seven-mile", "display_name": "セブンマイル", "alias_of": None},
    {"id": "storedvalue.suica", "display_name": "Suica", "alias_of": None},
    {"id": "transit.suica", "display_name": "Suica", "alias_of": None},
    {"id": "wallet.anapay", "display_name": "ANA Pay", "alias_of": None},
    {"id": "wallet.kyash", "display_name": "Kyash", "alias_of": None},
    {"id": "wallet.revolut", "display_name": "Revolut", "alias_of": None},
    {"id": "wallet.revolut-jp", "display_name": "Revolut", "alias_of": None},
    {"id": "mile.ana", "display_name": "ANA Mileage Club", "alias_of": None},
    {"id": "mile.jal", "display_name": "JAL Mileage Bank", "alias_of": None},
    {"id": "portal.jal-mileage-park", "display_name": "JAL Mileage Park", "alias_of": None},
]

GENERIC_IDS = {
    "instrument.payment.cashless_generic",
    "instrument.payment.credit_card_general",
    "instrument.payment.emoney_generic",
    "instrument.payment.ic_generic",
    "instrument.wallet.barcode_generic",
}

LABELS: dict[str, list[str]] = {
    "point.d": ["dポイント", "d Point", "d POINT"],
    "point.jre": ["JRE POINT"],
    "point.nanaco": ["nanacoポイント", "nanaco Points"],
    "point.paypay": ["PayPayポイント", "PayPay Points"],
    "point.ponta": ["Pontaポイント", "Ponta"],
    "point.rakuten": ["楽天ポイント", "Rakuten Point"],
    "point.v": ["Vポイント", "V Point"],
    "point.waon": ["WAON POINT"],
    "wallet.rakutenpay": ["楽天ペイ", "Rakuten Pay"],
    "point.moppy": ["ポイント(moppy)", "Moppy"],
    "point.saison": ["ポイント(saison)"],
    "point.saison-permanent": ["永久不滅ポイント"],
    "emoney.nanaco": ["電子マネー(nanaco)"],
    "emoney.waon": ["電子マネー(waon)"],
}


def read_json_url(url: str, timeout: int = 45) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "PoimichiAssetBuilder/1.0",
            "Cache-Control": "no-cache",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_catalogue() -> dict[str, Any]:
    deadline = time.time() + 25 * 60
    last_error = "not_started"
    while time.time() < deadline:
        try:
            payload = read_json_url(
                f"{PRODUCTION_ORIGIN}/asset-sources?cache={int(time.time())}"
            )
            if (
                payload.get("version") == "asset-source-catalogue.v1"
                and len(payload.get("assets", [])) == EXPECTED_CANONICAL
            ):
                return payload
            last_error = f"unexpected_count:{len(payload.get('assets', []))}"
        except Exception as error:  # noqa: BLE001 - diagnostics retain exact error
            last_error = repr(error)
        time.sleep(12)
    raise RuntimeError(f"asset_source_catalogue_timeout:{last_error}")


def parse_string_map(source: str, constant: str) -> dict[str, str]:
    match = re.search(
        rf"const\s+{re.escape(constant)}\s*=\s*Object\.freeze\(\{{(.*?)\}}\);",
        source,
        re.DOTALL,
    )
    if not match:
        return {}
    return {
        key: value
        for key, value in re.findall(
            r'"([^"]+)"\s*:\s*"([^"]+)"', match.group(1)
        )
    }


def source_maps() -> tuple[dict[str, str], dict[str, str]]:
    script = (ROOT / "scripts/complete_liquid_glass_assets.mjs").read_text(
        encoding="utf-8"
    )
    return (
        parse_string_map(script, "PAGE_OVERRIDES"),
        parse_string_map(script, "LOCAL_OFFICIAL_ART"),
    )


def mime_for(path: Path, data: bytes) -> str:
    suffix = path.suffix.lower()
    if suffix == ".svg":
        return "image/svg+xml"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".gif":
        return "image/gif"
    if suffix == ".ico":
        return "image/x-icon"
    guessed = mimetypes.guess_type(path.name)[0]
    if guessed:
        return guessed
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    return "application/octet-stream"


def optimize_capture(path: Path) -> tuple[bytes, str, dict[str, int]]:
    with Image.open(path) as image:
        image.load()
        width, height = image.size
        image = image.convert("RGBA")
        max_width, max_height = 960, 640
        scale = min(1.0, max_width / width, max_height / height)
        if scale < 1.0:
            image = image.resize(
                (max(1, round(width * scale)), max(1, round(height * scale))),
                Image.Resampling.LANCZOS,
            )
        output = path.with_suffix(".webp")
        image.save(output, "WEBP", quality=90, method=6, exact=True)
        data = output.read_bytes()
        return data, "image/webp", {"width": image.width, "height": image.height}


def image_dimensions(path: Path) -> dict[str, int] | None:
    try:
        with Image.open(path) as image:
            return {"width": image.width, "height": image.height}
    except Exception:  # noqa: BLE001 - SVG dimensions are not needed for validation
        return None


def slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-")
    return cleaned.replace(".", "__").lower() or "asset"


def xml(value: Any) -> str:
    return html.escape(str(value), quote=True)


def data_uri(data: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def is_card(asset: dict[str, Any]) -> bool:
    return asset.get("entity_type") == "credit_card" or asset["id"].startswith("card.")


def generic_symbol(asset_id: str) -> str:
    if "credit_card" in asset_id:
        return "CARD"
    if "cashless" in asset_id:
        return "PAY"
    if "ic_generic" in asset_id:
        return "IC"
    if "emoney" in asset_id:
        return "E"
    if "barcode" in asset_id:
        return "QR"
    return "PAY"


def build_svg(
    asset: dict[str, Any],
    source_data: bytes | None,
    source_mime: str | None,
    source_kind: str,
    source_page: str | None,
    source_reference: str | None,
) -> str:
    asset_id = asset["id"]
    unique = slug(asset_id)
    card = is_card(asset)
    artwork_x, artwork_y = (34, 34) if card else (86, 83)
    artwork_w, artwork_h = (788, 471.8) if card else (684, 373.8)
    artwork_rx = 46 if card else 62
    if source_data is not None and source_mime is not None:
        inner = (
            f'<image x="{artwork_x}" y="{artwork_y}" width="{artwork_w}" '
            f'height="{artwork_h}" href="{xml(data_uri(source_data, source_mime))}" '
            f'preserveAspectRatio="xMidYMid meet" clip-path="url(#art-{unique})"/>'
        )
    else:
        inner = (
            '<g aria-hidden="true">'
            '<rect x="118" y="155" width="620" height="230" rx="78" '
            'fill="#ffffff" fill-opacity="0.62"/>'
            f'<text x="428" y="302" text-anchor="middle" '
            'font-family="system-ui,sans-serif" font-size="92" font-weight="800" '
            f'fill="#203244">{xml(generic_symbol(asset_id))}</text></g>'
        )
    attrs = [
        f'data-asset-id="{xml(asset_id)}"',
        f'data-source-kind="{xml(source_kind)}"',
    ]
    if source_page:
        attrs.append(f'data-source-page="{xml(source_page)}"')
    if source_reference:
        attrs.append(f'data-source-reference="{xml(source_reference)}"')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="856" height="539.8" viewBox="0 0 856 539.8" role="img" aria-labelledby="title-{unique}" {' '.join(attrs)}>
<title id="title-{unique}">{xml(asset['display_name'])}</title>
<defs>
  <linearGradient id="glass-{unique}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.97"/>
    <stop offset="0.56" stop-color="#edf4fb" stop-opacity="0.77"/>
    <stop offset="1" stop-color="#d9e8f4" stop-opacity="0.69"/>
  </linearGradient>
  <linearGradient id="shine-{unique}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.82"/>
    <stop offset="0.46" stop-color="#ffffff" stop-opacity="0.12"/>
    <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </linearGradient>
  <filter id="shadow-{unique}" x="-20%" y="-25%" width="140%" height="160%">
    <feDropShadow dx="0" dy="13" stdDeviation="13" flood-color="#24445f" flood-opacity="0.20"/>
  </filter>
  <clipPath id="art-{unique}">
    <rect x="{artwork_x}" y="{artwork_y}" width="{artwork_w}" height="{artwork_h}" rx="{artwork_rx}"/>
  </clipPath>
</defs>
<g filter="url(#shadow-{unique})">
  <rect x="18" y="18" width="820" height="503.8" rx="58" fill="url(#glass-{unique})" stroke="#ffffff" stroke-opacity="0.90" stroke-width="5"/>
  <rect x="28" y="28" width="800" height="483.8" rx="50" fill="#ffffff" fill-opacity="{'0.74' if card else '0.56'}"/>
  {inner}
  <path d="M48 80C230 16 568 20 808 77C660 184 420 211 92 192C66 157 52 117 48 80Z" fill="url(#shine-{unique})"/>
  <path d="M43 448C240 355 522 358 824 222V470C824 495 806 508 779 508H77C59 508 48 486 43 448Z" fill="#75b8d8" fill-opacity="0.09"/>
  <path d="M42 393C279 245 538 311 822 160" fill="none" stroke="#ffffff" stroke-opacity="0.30" stroke-width="8"/>
  <rect x="24" y="24" width="808" height="491.8" rx="54" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="3"/>
</g>
</svg>
'''


def output_path(asset: dict[str, Any]) -> Path:
    if asset.get("entity_type") == "service_alias":
        folder = "services"
    elif is_card(asset):
        folder = "cards"
    else:
        folder = "entities"
    return OUTPUT_ROOT / folder / f"{slug(asset['id'])}.svg"


def runtime_js() -> str:
    return r'''(() => {
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const normalize = (value) => String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s・･/／()（）._-]+/gu, "")
    .toLocaleLowerCase("ja-JP");

  const OLD_SOURCE_IDS = Object.freeze({
    "dpoint.png": "point.d", "dbarai.png": "wallet.dbarai",
    "dcard.png": "card.d", "jrepoint.webp": "point.jre",
    "viewcard.gif": "card.view", "nanaco.png": "point.nanaco",
    "paypay.svg": "wallet.paypay", "paypaycard.png": "card.paypay",
    "ponta.png": "point.ponta", "rakutenpoint.svg": "point.rakuten",
    "rakutenpay.svg": "wallet.rakutenpay", "rakutencard.svg": "card.rakuten",
    "vpoint.svg": "point.v", "waon.png": "point.waon",
    "aeonpay.png": "wallet.aeonpay", "aeoncard.png": "card.aeon",
    "aupay.png": "wallet.aupay", "aupaycard.png": "card.aupay",
    "famipay.svg": "wallet.famipay", "smbccard.png": "card.smbc",
  });
  const LABEL_IDS = Object.freeze({
    "dポイント": "point.d", "d Point": "point.d", "d POINT": "point.d",
    "JRE POINT": "point.jre", "nanacoポイント": "point.nanaco",
    "nanaco Points": "point.nanaco", "PayPayポイント": "point.paypay",
    "PayPay Points": "point.paypay", "Pontaポイント": "point.ponta",
    Ponta: "point.ponta", "楽天ポイント": "point.rakuten",
    "Rakuten Point": "point.rakuten", "Vポイント": "point.v",
    "V Point": "point.v", "WAON POINT": "point.waon",
    "AEON Pay": "wallet.aeonpay", "au PAY": "wallet.aupay",
    "d払い": "wallet.dbarai", FamiPay: "wallet.famipay",
    PayPay: "wallet.paypay", "楽天ペイ": "wallet.rakutenpay",
    "Rakuten Pay": "wallet.rakutenpay", "ポイント(moppy)": "point.moppy",
    Moppy: "point.moppy", "ポイント(saison)": "point.saison",
    "永久不滅ポイント": "point.saison-permanent", Suica: "storedvalue.suica",
    "ANA Pay": "wallet.anapay", Kyash: "wallet.kyash", Revolut: "wallet.revolut-jp",
    "ANAマイル": "mile.ana", "ANA Mileage Club": "mile.ana",
    "JALマイル": "mile.jal", "JAL Mileage Bank": "mile.jal",
    "JALマイレージパーク": "portal.jal-mileage-park",
  });

  let assetsById = new Map();
  let assetsByName = new Map();
  let ready = false;

  const inferLabel = (frame) => frame.closest(
    ".p0-product-option, .lot-card, .route-chain-node, [data-wallet-chip]",
  )?.querySelector(
    ".p0-product-name strong, .lot-identity strong, strong, span",
  )?.textContent?.trim() || "";

  const inferId = (frame) => {
    if (frame.dataset.liquidAssetId) return frame.dataset.liquidAssetId;
    const input = frame.closest(".p0-product-option")?.querySelector("input[data-p0-product]");
    if (input?.value) return input.value;
    const walletChip = frame.closest("[data-wallet-chip]");
    if (walletChip?.dataset.walletChip) return walletChip.dataset.walletChip;
    const oldImage = frame.querySelector("img");
    if (oldImage?.src) {
      const filename = new URL(oldImage.src, window.location.href).pathname.split("/").pop();
      if (filename && OLD_SOURCE_IDS[filename]) return OLD_SOURCE_IDS[filename];
    }
    const label = inferLabel(frame);
    return LABEL_IDS[label] || assetsByName.get(normalize(label))?.id || "";
  };

  const hydrate = (frame) => {
    if (!(frame instanceof HTMLElement) || !ready) return;
    const asset = assetsById.get(inferId(frame));
    if (!asset || frame.dataset.liquidGlassPath === asset.path) return;
    const original = [...frame.childNodes].map((node) => node.cloneNode(true));
    const image = document.createElement("img");
    image.src = asset.path;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      if (frame.dataset.liquidGlassPath !== asset.path) return;
      frame.replaceChildren(...original.map((node) => node.cloneNode(true)));
      delete frame.dataset.liquidGlassPath;
    }, { once: true });
    frame.replaceChildren(image);
    frame.dataset.liquidGlassPath = asset.path;
  };
  const hydrateAll = (root = document) => root.querySelectorAll?.(".payment-logo").forEach(hydrate);
  const observer = new MutationObserver((records) => records.forEach((record) =>
    record.addedNodes.forEach((node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(".payment-logo")) hydrate(node);
      hydrateAll(node);
    }),
  ));
  observer.observe(document.body, { childList: true, subtree: true });

  const installStyles = () => {
    if (document.querySelector('link[href="/liquid-glass.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/liquid-glass.css";
    document.head.appendChild(link);
  };

  const loadAssets = async () => {
    const response = await fetch(`/assets/liquid-glass/manifest.json?cache=${Date.now()}`, {
      headers: { Accept: "application/json" }, cache: "no-store",
    });
    if (!response.ok) throw new Error("asset_manifest_unavailable");
    const manifest = await response.json();
    if (manifest.version !== "liquid-glass-assets.v3" || manifest.asset_count !== 246)
      throw new Error("asset_manifest_invalid");
    assetsById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
    assetsByName = new Map();
    manifest.assets.forEach((asset) => {
      assetsByName.set(normalize(asset.display_name), asset);
      (asset.labels || []).forEach((label) => assetsByName.set(normalize(label), asset));
    });
    ready = true;
    installStyles();
    hydrateAll();
  };

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  const loadCoverage = async () => {
    try {
      const response = await fetch("/catalogue-coverage", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("coverage_unavailable");
      const body = await response.json();
      if (!body.catalogue || !body.optimization || !integer(body.catalogue.total))
        throw new Error("coverage_invalid");
      setText("card-catalogue-coverage", `${body.catalogue.total}枚`);
      setText("card-optimization-coverage", `${body.optimization.covered}/${body.optimization.total}枚`);
      setText("card-coverage-note", "カタログ収録はカードの存在・名称の収録状況、最適化対応は公式根拠がAgent Feedから反映され、還元計算に使える状態を示します。");
      const container = document.getElementById("card-coverage-tiers");
      if (container) {
        container.replaceChildren();
        (body.optimization.tiers || []).forEach((row) => {
          const chip = document.createElement("span");
          chip.className = "demo-chip";
          chip.textContent = `${row.tier} 最適化 ${row.covered}/${row.total}`;
          container.appendChild(chip);
        });
      }
    } catch {
      setText("card-catalogue-coverage", "—");
      setText("card-optimization-coverage", "—");
      setText("card-coverage-note", "カード収録状況を読み込めませんでした。");
    }
  };

  void loadAssets().catch(() => {});
  void loadCoverage();
})();
'''


def css_source() -> str:
    return """.payment-logo {
  width: 58px !important;
  height: auto !important;
  aspect-ratio: 85.6 / 53.98;
  flex: 0 0 58px !important;
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
  filter: drop-shadow(0 1px 2px rgb(15 33 48 / 14%));
}
.route-node-logo { width: 50px !important; flex-basis: 50px !important; }
@media (max-width: 370px) {
  .payment-logo { width: 50px !important; flex-basis: 50px !important; }
}
"""


def call_capture(tasks: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    CAPTURE_ROOT.mkdir(parents=True, exist_ok=True)
    tasks_path = CAPTURE_ROOT / "tasks.json"
    report_path = CAPTURE_ROOT / "report.json"
    tasks_path.write_text(json.dumps(tasks, ensure_ascii=False, indent=2) + "\n")
    subprocess.run(
        [
            "node",
            "scripts/capture_official_artwork.mjs",
            str(tasks_path),
            str(CAPTURE_ROOT / "images"),
            str(report_path),
        ],
        check=False,
    )
    if not report_path.exists():
        raise RuntimeError("artwork_capture_report_missing")
    report = json.loads(report_path.read_text())
    return {row["id"]: row for row in report}


def main() -> None:
    catalogue = wait_for_catalogue()
    canonical = [
        {
            "id": row["asset_id"],
            "display_name": row["display_name"],
            "entity_type": row["entity_type"],
            "metadata": row.get("metadata") or {},
            "source_page_url": row.get("source_page_url"),
            "source_image_url": row.get("source_image_url"),
            "alias_of": None,
        }
        for row in catalogue["assets"]
    ]
    if len(canonical) != EXPECTED_CANONICAL:
        raise RuntimeError(f"canonical_count_invalid:{len(canonical)}")
    canonical_by_id = {row["id"]: row for row in canonical}
    if len(canonical_by_id) != EXPECTED_CANONICAL:
        raise RuntimeError("canonical_ids_not_unique")

    overrides, local_art = source_maps()
    alias_assets = [
        {
            **row,
            "entity_type": "service_alias",
            "metadata": {},
            "source_page_url": overrides.get(row["id"]),
            "source_image_url": None,
        }
        for row in ALIASES
    ]
    assets = canonical + alias_assets
    if len(assets) != EXPECTED_TOTAL or len({row["id"] for row in assets}) != EXPECTED_TOTAL:
        raise RuntimeError("total_asset_registry_invalid")

    resolved_for: dict[str, dict[str, Any]] = {}
    capture_tasks: list[dict[str, Any]] = []
    for asset in assets:
        target = canonical_by_id.get(asset.get("alias_of")) if asset.get("alias_of") else asset
        if target is None:
            target = asset
        resolved_for[asset["id"]] = target
        if target["id"] in GENERIC_IDS:
            continue
        if local_art.get(target["id"]):
            continue
        page_url = (
            overrides.get(target["id"])
            or target.get("source_page_url")
            or target.get("metadata", {}).get("source_url")
            or overrides.get(asset["id"])
            or asset.get("source_page_url")
        )
        if not page_url:
            raise RuntimeError(f"official_page_missing:{target['id']}")
        if target["id"] not in {row["id"] for row in capture_tasks}:
            capture_tasks.append(
                {
                    "id": target["id"],
                    "display_name": target["display_name"],
                    "kind": "credit_card" if is_card(target) else "service",
                    "page_url": page_url,
                }
            )

    captures = call_capture(capture_tasks)
    capture_failures = [row for row in captures.values() if not row.get("ok")]
    if capture_failures:
        (CAPTURE_ROOT / "failures.json").write_text(
            json.dumps(capture_failures, ensure_ascii=False, indent=2) + "\n"
        )
        raise RuntimeError(f"official_capture_failed:{len(capture_failures)}")

    shutil.rmtree(OUTPUT_ROOT, ignore_errors=True)
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    REGISTRY_ROOT.mkdir(parents=True, exist_ok=True)

    source_cache: dict[str, dict[str, Any]] = {}
    rows: list[dict[str, Any]] = []
    source_stats: dict[str, int] = {}
    payment_logo_root = PUBLIC_ROOT / "assets/payment-logos"

    for asset in assets:
        target = resolved_for[asset["id"]]
        target_id = target["id"]
        if target_id not in source_cache:
            if target_id in GENERIC_IDS:
                source_cache[target_id] = {
                    "data": None,
                    "mime": None,
                    "source_kind": "poimichi_generic_category",
                    "source_page_url": None,
                    "source_reference": None,
                    "dimensions": None,
                }
            elif local_art.get(target_id):
                local_path = payment_logo_root / local_art[target_id]
                data = local_path.read_bytes()
                source_cache[target_id] = {
                    "data": data,
                    "mime": mime_for(local_path, data),
                    "source_kind": "checked_in_official_artwork",
                    "source_page_url": overrides.get(target_id) or target.get("source_page_url"),
                    "source_reference": f"/assets/payment-logos/{local_path.name}",
                    "dimensions": image_dimensions(local_path),
                }
            else:
                capture = captures[target_id]
                capture_path = Path(capture["output_path"])
                data, mime, dimensions = optimize_capture(capture_path)
                source_cache[target_id] = {
                    "data": data,
                    "mime": mime,
                    "source_kind": capture["source_kind"],
                    "source_page_url": capture["page_url"],
                    "source_reference": capture.get("navigated_url"),
                    "dimensions": dimensions,
                    "capture_score": capture.get("score"),
                    "capture_descriptor": capture.get("descriptor"),
                }

        source = source_cache[target_id]
        output = output_path(asset)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            build_svg(
                asset,
                source["data"],
                source["mime"],
                source["source_kind"],
                source["source_page_url"],
                source["source_reference"],
            ),
            encoding="utf-8",
        )
        digest = (
            hashlib.sha256(source["data"]).hexdigest()
            if source["data"] is not None
            else None
        )
        source_stats[source["source_kind"]] = source_stats.get(source["source_kind"], 0) + 1
        rows.append(
            {
                "id": asset["id"],
                "display_name": asset["display_name"],
                "labels": sorted(set([asset["display_name"], *LABELS.get(asset["id"], [])])),
                "entity_type": asset["entity_type"],
                "alias_of": asset.get("alias_of"),
                "resolved_id": target_id,
                "path": "/" + output.relative_to(PUBLIC_ROOT).as_posix(),
                "aspect_ratio": "85.60:53.98",
                "transparent_outside_card": True,
                "source_kind": source["source_kind"],
                "source_page_url": source["source_page_url"],
                "source_reference": source["source_reference"],
                "source_sha256": digest,
                "source_mime": source["mime"],
                "source_dimensions": source.get("dimensions"),
                "official_reference_preserved": source["source_kind"]
                != "poimichi_generic_category",
            }
        )

    rows.sort(key=lambda row: row["id"])
    run_basis = json.dumps(
        [[row["id"], row["source_sha256"]] for row in rows],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()
    generation_run_id = (
        f"reference-liquid-glass-{int(time.time())}-"
        f"{hashlib.sha256(run_basis).hexdigest()[:12]}"
    )
    manifest = {
        "version": "liquid-glass-assets.v3",
        "generation_run_id": generation_run_id,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "aspect_ratio": "85.60:53.98",
        "width": CARD_WIDTH,
        "height": CARD_HEIGHT,
        "canonical_count": EXPECTED_CANONICAL,
        "alias_count": EXPECTED_ALIASES,
        "asset_count": len(rows),
        "source_stats": source_stats,
        "assets": rows,
    }
    (OUTPUT_ROOT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    (OUTPUT_ROOT / "generation-report.json").write_text(
        json.dumps(
            {
                "generation_run_id": generation_run_id,
                "asset_count": len(rows),
                "source_stats": source_stats,
                "card_count": sum(1 for row in rows if row["entity_type"] == "credit_card"),
                "generated_brand_text_count": 0,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    (REGISTRY_ROOT / "liquid-glass-assets.v3.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    source_table = [
        "# Liquid Glass official artwork sources",
        "",
        "Brand marks and product artwork are preserved from first-party sources; Poimichi supplies only the surrounding ID-1 glass wrapper.",
        "",
        "| Asset ID | Source kind | Official page | Reference | SHA-256 |",
        "|---|---|---|---|---|",
    ]
    for row in rows:
        source_table.append(
            f"| {row['id']} | {row['source_kind']} | "
            f"{row['source_page_url'] or '—'} | {row['source_reference'] or '—'} | "
            f"{row['source_sha256'] or '—'} |"
        )
    source_table.append("")
    (OUTPUT_ROOT / "SOURCES.md").write_text("\n".join(source_table))

    # Strict validation before anything can be committed.
    errors: list[str] = []
    if len(rows) != EXPECTED_TOTAL:
        errors.append(f"count:{len(rows)}")
    if len({row["id"] for row in rows}) != EXPECTED_TOTAL:
        errors.append("duplicate_ids")
    for row in rows:
        path = PUBLIC_ROOT / row["path"].lstrip("/")
        svg = path.read_text(encoding="utf-8")
        if 'viewBox="0 0 856 539.8"' not in svg:
            errors.append(f"ratio:{row['id']}")
        if row["source_kind"] != "poimichi_generic_category":
            if not row["source_sha256"] or not row["source_page_url"]:
                errors.append(f"provenance:{row['id']}")
            if "<text" in svg:
                errors.append(f"generated_brand_text:{row['id']}")
        elif row["id"] not in GENERIC_IDS:
            errors.append(f"generic_brand:{row['id']}")
    if errors:
        (OUTPUT_ROOT / "validation-failures.json").write_text(
            json.dumps(errors, ensure_ascii=False, indent=2) + "\n"
        )
        raise RuntimeError(f"validation_failed:{len(errors)}")

    (PUBLIC_ROOT / "coverage.js").write_text(runtime_js(), encoding="utf-8")
    (PUBLIC_ROOT / "liquid-glass.css").write_text(css_source(), encoding="utf-8")
    print(json.dumps({"status": "complete", **manifest}, ensure_ascii=False))


if __name__ == "__main__":
    main()
