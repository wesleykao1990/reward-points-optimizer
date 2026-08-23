import { describe, expect, it } from "vitest";
import {
  buildOverpassQuery,
  normalizeOverpassResponse,
} from "../src/nearby-vercel-adapter.js";

describe("nearby OSM discovery", () => {
  it("builds a bounded Overpass radius query from numeric input", () => {
    const query = buildOverpassQuery({
      latitude: 35.690921,
      longitude: 139.700258,
      radiusM: 600,
      limit: 15,
    });
    expect(query).toContain("around:600,35.690921,139.700258");
    expect(query).toContain('["shop"]');
    expect(query).toContain("out center tags 80");
    expect(query).not.toContain("<script");
  });

  it("normalizes a known FamilyMart and its payment tags", () => {
    const places = normalizeOverpassResponse(
      {
        elements: [
          {
            type: "node",
            id: 123456,
            lat: 35.6898,
            lon: 139.7001,
            tags: {
              name: "ファミリーマート 新宿新都心店",
              brand: "FamilyMart",
              "addr:city": "新宿区",
              "addr:street": "西新宿",
              "payment:paypay": "yes",
              "payment:quicpay": "yes",
              "payment:visa": "yes",
            },
          },
        ],
      },
      [
        {
          location_key: "tokyo.shinjuku.familymart.shinjuku-shintoshin",
          merchant_key: "merchant.familymart",
          location_name: "FamilyMart 新宿新都心店",
          address: {},
        },
      ],
    );

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      osm_id: "node/123456",
      merchant_key: "merchant.familymart",
      location_key: "tokyo.shinjuku.familymart.shinjuku-shintoshin",
      lat: 35.6898,
      lon: 139.7001,
    });
    expect(places[0]?.payments).toEqual(
      expect.arrayContaining([
        {
          instrument_key: "instrument.wallet.paypay",
          state: "yes",
        },
        {
          instrument_key: "instrument.emoney.quicpay",
          state: "yes",
        },
        {
          instrument_key: "instrument.payment.credit_card_general",
          state: "yes",
        },
      ]),
    );
  });

  it("does not guess a prewarm match from only a partial branch label", () => {
    const places = normalizeOverpassResponse(
      {
        elements: [
          {
            type: "node",
            id: 999,
            lat: 35.69,
            lon: 139.7,
            tags: {
              name: "ファミリーマート 新宿店",
              brand: "FamilyMart",
            },
          },
        ],
      },
      [
        {
          location_key: "tokyo.shinjuku.familymart.shinjuku-shintoshin",
          merchant_key: "merchant.familymart",
          location_name: "FamilyMart 新宿新都心店",
          address: {},
        },
      ],
    );
    expect(places[0]?.merchant_key).toBe("merchant.familymart");
    expect(places[0]?.location_key).toBeUndefined();
  });

  it("drops malformed and non-Japan elements", () => {
    const places = normalizeOverpassResponse({
      elements: [
        { type: "node", id: 1, lat: 48.85, lon: 2.35, tags: { name: "Paris" } },
        {
          type: "node",
          id: "bad",
          lat: 35.68,
          lon: 139.76,
          tags: { name: "bad" },
        },
        { type: "way", id: 2, tags: { name: "missing center" } },
      ],
    });
    expect(places).toEqual([]);
  });

  it("rejects a malformed Overpass envelope", () => {
    expect(() =>
      normalizeOverpassResponse({ elements: "not-an-array" }),
    ).toThrow("osm_response_invalid");
  });
});
