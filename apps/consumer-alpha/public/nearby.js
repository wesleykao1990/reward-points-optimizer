const button = document.querySelector("#nearby-button");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const attribution = document.querySelector("#attribution");

function setStatus(message, kind = "") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function clearResults() {
  while (results.firstChild) results.firstChild.remove();
}

function formatAddress(address) {
  if (!address || typeof address !== "object") return "住所情報なし";
  const values = [
    address.prefecture,
    address.city,
    address.ward,
    address.street,
    address.site_detail,
    address.station,
  ].filter((value) => typeof value === "string" && value.length > 0);
  return values.length > 0 ? values.join(" ") : "住所情報なし";
}

function compatibilityLabel(item) {
  if (item.action === "earn") return `${item.instrument_name}・貯める`;
  if (item.action === "redeem") return `${item.instrument_name}・使う`;
  return item.instrument_name;
}

function appendCompatibility(container, item) {
  const chip = document.createElement("li");
  chip.className = `chip chip-${item.state}`;

  const label = document.createElement("span");
  label.className = "chip-label";
  label.textContent = compatibilityLabel(item);
  chip.append(label);

  const source = document.createElement("span");
  source.className = "chip-source";
  source.textContent = item.inherited_from_chain ? "チェーン情報" : "店舗情報";
  chip.append(source);

  container.append(chip);
}

function appendLocation(location) {
  const card = document.createElement("article");
  card.className = "merchant-card";

  const headingRow = document.createElement("div");
  headingRow.className = "merchant-heading";

  const titleGroup = document.createElement("div");
  const merchant = document.createElement("p");
  merchant.className = "merchant-brand";
  merchant.textContent = location.merchant_name;
  const title = document.createElement("h2");
  title.textContent = location.location_name;
  titleGroup.append(merchant, title);

  const distance = document.createElement("span");
  distance.className = "distance";
  distance.textContent = `${location.distance_m}m`;
  headingRow.append(titleGroup, distance);
  card.append(headingRow);

  const address = document.createElement("p");
  address.className = "address";
  address.textContent = formatAddress(location.address);
  card.append(address);

  const accepted = Array.isArray(location.accepted)
    ? location.accepted.filter((item) => item.state === "yes")
    : [];
  const compatibility = document.createElement("ul");
  compatibility.className = "compatibility";
  if (accepted.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-compatibility";
    empty.textContent = "決済・ポイント情報はまだありません";
    compatibility.append(empty);
  } else {
    accepted.forEach((item) => {
      appendCompatibility(compatibility, item);
    });
  }
  card.append(compatibility);

  const meta = document.createElement("p");
  meta.className = "meta";
  const branchFacts = accepted.filter(
    (item) => !item.inherited_from_chain,
  ).length;
  meta.textContent = `店舗確認 ${branchFacts}件 / 利用可能情報 ${accepted.length}件`;
  card.append(meta);

  results.append(card);
}

async function requestNearby(position) {
  const response = await fetch("/api/nearby", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      radius_m: 600,
      limit: 15,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    const code = payload?.error?.code ?? "nearby_failed";
    throw new Error(code);
  }
  return payload;
}

function geolocationError(error) {
  if (error.code === error.PERMISSION_DENIED)
    return "位置情報の利用が許可されていません。ブラウザ設定から許可してください。";
  if (error.code === error.POSITION_UNAVAILABLE)
    return "現在地を取得できませんでした。場所を変えて再度お試しください。";
  if (error.code === error.TIMEOUT)
    return "現在地の取得がタイムアウトしました。もう一度お試しください。";
  return "現在地を取得できませんでした。";
}

async function runNearbySearch() {
  if (!("geolocation" in navigator)) {
    setStatus("このブラウザは位置情報に対応していません。", "error");
    return;
  }
  button.disabled = true;
  clearResults();
  setStatus("現在地を取得しています…", "loading");

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        setStatus("近くの店舗と決済情報を確認しています…", "loading");
        const payload = await requestNearby(position);
        clearResults();
        if (payload.attribution?.text)
          attribution.textContent = payload.attribution.text;
        const locations = Array.isArray(payload.locations)
          ? payload.locations
          : [];
        locations.forEach(appendLocation);
        if (locations.length === 0) {
          setStatus(
            payload.discovery?.enabled
              ? "600m以内で一致する店舗が見つかりませんでした。"
              : "保存済み店舗には一致しませんでした。OSM discoveryを有効にすると検索範囲を自動拡張できます。",
            "empty",
          );
        } else {
          const cache = payload.discovery?.cache_status;
          const suffix =
            cache === "degraded"
              ? "（外部店舗検索は一時的に利用できず、保存済みデータを表示）"
              : "";
          setStatus(
            `${locations.length}店舗見つかりました。${suffix}`,
            "success",
          );
        }
      } catch (error) {
        setStatus(`検索できませんでした（${error.message}）。`, "error");
      } finally {
        button.disabled = false;
      }
    },
    (error) => {
      setStatus(geolocationError(error), "error");
      button.disabled = false;
    },
    {
      enableHighAccuracy: false,
      timeout: 8_000,
      maximumAge: 60_000,
    },
  );
}

button.addEventListener("click", runNearbySearch);
