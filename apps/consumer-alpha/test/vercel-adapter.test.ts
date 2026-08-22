import { describe, expect, it } from "vitest";
import {
  createVercelRequestHandler,
  deploymentHosts,
  type VercelLikeResponse,
} from "../src/vercel-adapter.js";

function responseCapture(): VercelLikeResponse & {
  readonly headers: Record<string, string>;
  body: string;
} {
  const headers: Record<string, string> = {};
  return {
    statusCode: 0,
    headers,
    body: "",
    setHeader(name, value) {
      headers[name] = value;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

const environment = {
  JRO_PUBLIC_ORIGIN: "https://rewards.example",
};

describe("consumer-alpha Vercel adapter", () => {
  it("admits the configured origin and Vercel system hosts exactly", () => {
    expect(
      deploymentHosts({
        ...environment,
        VERCEL_URL: "reward-points-abc.vercel.app",
      }),
    ).toEqual(new Set(["rewards.example", "reward-points-abc.vercel.app"]));
    expect(() =>
      deploymentHosts({ JRO_PUBLIC_ORIGIN: "http://rewards.example" }),
    ).toThrow("jro_public_origin_invalid");
  });

  it("forwards a same-origin parsed JSON request into the bounded app", async () => {
    const handler = createVercelRequestHandler({ environment });
    const response = responseCapture();
    await handler(
      {
        method: "POST",
        url: "/api/synthetic/evaluate",
        headers: {
          host: "rewards.example",
          "x-forwarded-proto": "https",
          origin: "https://rewards.example",
          "content-type": "application/json",
        },
        body: {
          merchant_id: "merchant.synthetic",
          branch_id: "location.synthetic",
          amount_jpy: 640,
          owned_instruments: ["synthetic_card"],
          stored_value_use: "unknown",
          facts: [],
          caps: [],
        },
      },
      response,
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      recommendation: { synthetic_only: true, not_current_advice: true },
    });
    expect(response.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("rejects unconfigured hosts, cross-origin requests, and query strings", async () => {
    const handler = createVercelRequestHandler({ environment });
    const hostileHost = responseCapture();
    await handler(
      {
        method: "GET",
        url: "/api/experimental/rules",
        headers: {
          host: "attacker.invalid",
          "x-forwarded-proto": "https",
        },
      },
      hostileHost,
    );
    expect(hostileHost.statusCode).toBe(400);
    expect(JSON.parse(hostileHost.body)).toMatchObject({
      error: { code: "host_invalid" },
    });

    const hostileOrigin = responseCapture();
    await handler(
      {
        method: "GET",
        url: "/api/experimental/rules",
        headers: {
          host: "rewards.example",
          "x-forwarded-proto": "https",
          origin: "https://attacker.invalid",
        },
      },
      hostileOrigin,
    );
    expect(hostileOrigin.statusCode).toBe(403);
    expect(JSON.parse(hostileOrigin.body)).toMatchObject({
      error: { code: "origin_invalid" },
    });

    const query = responseCapture();
    await handler(
      {
        method: "GET",
        url: "/api/experimental/rules?leak=true",
        headers: {
          host: "rewards.example",
          "x-forwarded-proto": "https",
        },
      },
      query,
    );
    expect(query.statusCode).toBe(400);
    expect(JSON.parse(query.body)).toMatchObject({
      error: { code: "query_not_allowed" },
    });
  });

  it("fails closed when the production database binding is absent", async () => {
    const handler = createVercelRequestHandler({
      environment,
      requireDatabase: true,
    });
    const response = responseCapture();
    await handler(
      {
        method: "GET",
        url: "/api/experimental/rules",
        headers: {
          host: "rewards.example",
          "x-forwarded-proto": "https",
        },
      },
      response,
    );
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({
      error: { code: "deployment_not_configured" },
    });
  });

  it("accepts the server-only database URL synchronized by Supabase", async () => {
    let connectionString: string | undefined;
    const handler = createVercelRequestHandler({
      environment: {
        ...environment,
        POSTGRES_URL: "postgresql://server-only.example/postgres",
      },
      requireDatabase: true,
      runtimeFactory(value) {
        connectionString = value;
        return {
          dependencies: {},
          close: async () => undefined,
        };
      },
    });
    const response = responseCapture();
    await handler(
      {
        method: "POST",
        url: "/api/synthetic/evaluate",
        headers: {
          host: "rewards.example",
          "x-forwarded-proto": "https",
          origin: "https://rewards.example",
          "content-type": "application/json",
        },
        body: {
          merchant_id: "merchant.synthetic",
          branch_id: "location.synthetic",
          amount_jpy: 640,
          owned_instruments: ["synthetic_card"],
          stored_value_use: "unknown",
          facts: [],
          caps: [],
        },
      },
      response,
    );
    expect(connectionString).toBe("postgresql://server-only.example/postgres");
  });
});
