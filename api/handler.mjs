import { createNearbyVercelRequestHandler } from "../apps/consumer-alpha/dist/nearby-vercel-adapter.js";
import { createVercelRequestHandler } from "../apps/consumer-alpha/dist/vercel-adapter.js";

const appHandler = createVercelRequestHandler({
  environment: process.env,
  requireDatabase: true,
});

const nearbyHandler = createNearbyVercelRequestHandler({
  environment: process.env,
});

function geolocationEnabledResponse(response) {
  return {
    get statusCode() {
      return response.statusCode;
    },
    set statusCode(value) {
      response.statusCode = value;
    },
    setHeader(name, value) {
      const rewritten =
        typeof value === "string" &&
        String(name).toLowerCase() === "permissions-policy"
          ? value.replace("geolocation=()", "geolocation=(self)")
          : value;
      response.setHeader(name, rewritten);
    },
    end(body) {
      response.end(body);
    },
  };
}

export default async function handler(request, response) {
  const parsed = new URL(
    request.url ?? "/api/handler",
    "https://handler.invalid",
  );
  const path = parsed.searchParams.get("path");
  const securedResponse = geolocationEnabledResponse(response);
  if (path === "nearby" || parsed.pathname === "/api/nearby") {
    await nearbyHandler(request, securedResponse);
    return;
  }
  await appHandler(request, securedResponse);
}
