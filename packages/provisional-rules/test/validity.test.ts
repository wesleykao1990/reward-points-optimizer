import { describe, expect, it } from "vitest";
import {
  classifyProvisionalRuleValidity,
  classifyProvisionalValidity,
  isActiveProvisionalValidity,
} from "../src/index.js";

const VALIDITY = {
  valid_from: "2026-08-20T00:00:00Z",
  valid_to: "2026-08-21T00:00:00Z",
};

describe("provisional economic validity", () => {
  it("uses an explicit half-open interval", () => {
    expect(
      classifyProvisionalValidity(VALIDITY, "2026-08-20T00:00:00Z").status,
    ).toBe("active");
    expect(
      classifyProvisionalValidity(VALIDITY, "2026-08-21T00:00:00Z").status,
    ).toBe("expired");
    expect(
      classifyProvisionalValidity(VALIDITY, "2026-08-19T23:59:59Z").status,
    ).toBe("scheduled");
  });

  it("rejects missing, date-only, malformed, and inverted validity", () => {
    expect(classifyProvisionalValidity(VALIDITY, undefined).status).toBe(
      "unknown",
    );
    expect(
      classifyProvisionalValidity(
        { valid_from: "2026-08-20", valid_to: null },
        "2026-08-20T00:00:00Z",
      ).status,
    ).toBe("unknown");
    expect(
      classifyProvisionalValidity(
        { valid_from: "bad", valid_to: null },
        "2026-08-20T00:00:00Z",
      ).status,
    ).toBe("unknown");
    expect(
      classifyProvisionalValidity(
        {
          valid_from: "2026-08-21T00:00:00Z",
          valid_to: "2026-08-20T00:00:00Z",
        },
        "2026-08-20T00:00:00Z",
      ).status,
    ).toBe("unknown");
    expect(
      classifyProvisionalValidity(
        { valid_from: "2026-09-31T00:00:00+09:00", valid_to: null },
        "2026-09-30T00:00:00+09:00",
      ).status,
    ).toBe("unknown");
    expect(
      classifyProvisionalValidity(
        { valid_from: "2026-02-28T00:00:00Z", valid_to: null },
        "2026-02-29T00:00:00Z",
      ).status,
    ).toBe("unknown");
    expect(
      classifyProvisionalValidity(
        { valid_from: "2028-02-29T00:00:00Z", valid_to: null },
        "2028-02-29T00:00:00Z",
      ).status,
    ).toBe("active");
  });

  it("reads only rule.validity and never a raw effective claim", () => {
    expect(
      classifyProvisionalRuleValidity(
        {
          effective_time: { effective_from: "2026-08-20T00:00:00Z" },
          validity: { valid_from: "2026-08-21T00:00:00Z", valid_to: null },
        },
        "2026-08-20T00:00:00Z",
      ).status,
    ).toBe("scheduled");
    expect(
      isActiveProvisionalValidity(
        { valid_from: "2026-08-20T00:00:00Z", valid_to: null },
        "2026-08-20T00:00:00Z",
      ),
    ).toBe(true);
  });
});
