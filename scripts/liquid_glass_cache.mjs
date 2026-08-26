const OIDC_AUDIENCE = "poimichi-visual-assets";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function createLiquidGlassCacheClient(origin) {
  let token = null;
  let tokenFetchedAt = 0;

  async function oidcToken() {
    if (token && Date.now() - tokenFetchedAt < 4 * 60_000) return token;
    const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!requestUrl || !requestToken)
      throw new Error("github_actions_oidc_unavailable");
    const url = new URL(requestUrl);
    url.searchParams.set("audience", OIDC_AUDIENCE);
    const response = await fetch(url, {
      headers: { authorization: `bearer ${requestToken}`, accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`github_oidc_http_${response.status}`);
    const body = await response.json();
    if (typeof body.value !== "string" || body.value.length === 0)
      throw new Error("github_oidc_token_missing");
    token = body.value;
    tokenFetchedAt = Date.now();
    return token;
  }

  async function post(body, options = {}) {
    const attempts = options.attempts ?? 4;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(`${origin}/visual-assets`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${await oidcToken()}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
          cache: "no-store",
        });
        const text = await response.text();
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }
        if (!response.ok) {
          if (response.status === 401) {
            token = null;
            tokenFetchedAt = 0;
          }
          throw new Error(
            `visual_asset_cache_http_${response.status}:${payload?.error?.code ?? text.slice(0, 200)}`,
          );
        }
        return payload;
      } catch (error) {
        lastError = error;
        if (attempt === attempts) break;
        await sleep(1500 * attempt);
      }
    }
    throw lastError;
  }

  return Object.freeze({
    async waitUntilReady(timeoutMs = 12 * 60_000) {
      const deadline = Date.now() + timeoutMs;
      let lastError = "not_started";
      while (Date.now() < deadline) {
        try {
          await post({ operation: "get_cache", asset_ids: [] }, { attempts: 1 });
          return;
        } catch (error) {
          lastError = String(error);
        }
        await sleep(10_000);
      }
      throw new Error(`visual_asset_cache_timeout:${lastError}`);
    },

    async getCache(assetIds) {
      const assets = [];
      const sources = [];
      for (let index = 0; index < assetIds.length; index += 40) {
        const body = await post({
          operation: "get_cache",
          asset_ids: assetIds.slice(index, index + 40),
        });
        assets.push(...(body?.assets ?? []));
        sources.push(...(body?.sources ?? []));
      }
      return { assets, sources };
    },

    async storeSource(source) {
      return post({ operation: "upsert_source", source });
    },

    async storeAsset(asset) {
      return post({ operation: "upsert_asset", asset });
    },

    async markValidation(assetId, status, errors = []) {
      return post({
        operation: "mark_validation",
        asset_id: assetId,
        status,
        errors,
      });
    },

    async markValidationBatch(records) {
      for (let index = 0; index < records.length; index += 40) {
        await post({
          operation: "mark_validation_batch",
          records: records.slice(index, index + 40),
        });
      }
    },

    async markDeployed(assetIds) {
      for (let index = 0; index < assetIds.length; index += 40) {
        await post({
          operation: "mark_deployed",
          asset_ids: assetIds.slice(index, index + 40),
        });
      }
    },
  });
}
