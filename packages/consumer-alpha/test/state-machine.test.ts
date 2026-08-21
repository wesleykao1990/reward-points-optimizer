import { describe, expect, it } from "vitest";
import {
  allowedConsumerEvents,
  applyHostEvaluation,
  createInitialConsumerState,
  reduceConsumerState,
  transitionConsumerInputState,
  transitionConsumerState,
} from "../src/state-machine.js";
import type { AlphaCatalog, ConsumerState } from "../src/types.js";

function catalog(): AlphaCatalog {
  return {
    version: "alpha-catalog-v1",
    region: "Tokyo",
    merchants: [
      {
        merchant_id: "merchant.synthetic",
        name: "Synthetic Shop",
        branches: [
          { branch_id: "branch.tokyo", name: "Tokyo Main", city: "Tokyo" },
        ],
      },
    ],
    wallets: [
      {
        wallet_id: "wallet.card",
        name: "Synthetic Card",
        kind: "card",
        product_ids: ["product.points"],
      },
      {
        wallet_id: "wallet.balance",
        name: "Synthetic Balance",
        kind: "stored_value",
        product_ids: ["product.stored"],
      },
    ],
    products: [
      {
        product_id: "product.points",
        name: "Synthetic Points",
        kind: "points",
      },
      {
        product_id: "product.stored",
        name: "Synthetic Stored Value",
        kind: "stored_value",
      },
    ],
  };
}

function toReady(
  source: AlphaCatalog = catalog(),
  reordered = false,
): ConsumerState {
  const inputCatalog = reordered
    ? {
        ...source,
        merchants: [...source.merchants].reverse().map((merchant) => ({
          ...merchant,
          branches: [...merchant.branches].reverse(),
        })),
        wallets: [...source.wallets].reverse().map((wallet) => ({
          ...wallet,
          ...(wallet.product_ids
            ? { product_ids: [...wallet.product_ids].reverse() }
            : {}),
        })),
        products: [...source.products].reverse(),
      }
    : source;
  let state = createInitialConsumerState(inputCatalog);
  state = reduceConsumerState(state, {
    type: "select_merchant",
    merchant_id: "merchant.synthetic",
    branch_id: "branch.tokyo",
  });
  state = reduceConsumerState(state, {
    type: "define_purchase",
    purchase: { amount_jpy: 640, channel: "in_store" },
  });
  state = reduceConsumerState(state, {
    type: "define_wallets",
    selection: {
      wallet_ids: reordered
        ? ["wallet.balance", "wallet.card"]
        : ["wallet.card", "wallet.balance"],
      product_ids: reordered
        ? ["product.stored", "product.points"]
        : ["product.points", "product.stored"],
    },
  });
  state = reduceConsumerState(state, {
    type: "define_facts",
    facts: reordered
      ? [
          { fact_id: "monthly_use", status: "unknown" },
          { fact_id: "owns_card", status: "known", value: true },
        ]
      : [
          { fact_id: "owns_card", status: "known", value: true },
          { fact_id: "monthly_use", status: "unknown" },
        ],
  });
  state = reduceConsumerState(state, { type: "ask_stored_value_question" });
  state = reduceConsumerState(state, {
    type: "answer_stored_value_question",
    answers: reordered
      ? [
          { asset_id: "product.stored", usage: "within_30_days" },
          {
            asset_id: "wallet.balance",
            usage: "custom",
            custom_value: "0.7500",
          },
        ]
      : [
          {
            asset_id: "wallet.balance",
            usage: "custom",
            custom_value: "0.7500",
          },
          { asset_id: "product.stored", usage: "within_30_days" },
        ],
  });
  return reduceConsumerState(state, {
    type: "define_caps",
    caps: reordered
      ? [
          { asset_id: "product.stored", min_jpy: 0, max_jpy: 640 },
          { asset_id: "product.points", min_jpy: 0, max_jpy: 640 },
          { asset_id: "wallet.balance", min_jpy: 0, max_jpy: 640 },
          { asset_id: "wallet.card", min_jpy: 0, max_jpy: 640 },
        ]
      : [
          { asset_id: "wallet.card", min_jpy: 0, max_jpy: 640 },
          { asset_id: "wallet.balance", min_jpy: 0, max_jpy: 640 },
          { asset_id: "product.points", min_jpy: 0, max_jpy: 640 },
          { asset_id: "product.stored", min_jpy: 0, max_jpy: 640 },
        ],
  });
}

function toFacts(): ConsumerState {
  let state = createInitialConsumerState(catalog());
  state = reduceConsumerState(state, {
    type: "select_merchant",
    merchant_id: "merchant.synthetic",
    branch_id: "branch.tokyo",
  });
  state = reduceConsumerState(state, {
    type: "define_purchase",
    purchase: { amount_jpy: 640, channel: "in_store" },
  });
  return reduceConsumerState(state, {
    type: "define_wallets",
    selection: { wallet_ids: ["wallet.card"], product_ids: [] },
  });
}

describe("consumer alpha state machine", () => {
  it("allows only the declared linear phases and preserves unknown facts", () => {
    const state = toReady();
    expect(state.phase).toBe("ready");
    expect(state.facts).toEqual([
      { fact_id: "monthly_use", status: "unknown" },
      { fact_id: "owns_card", status: "known", value: true },
    ]);
    expect(state.facts[0]).not.toHaveProperty("value");
    expect(allowedConsumerEvents(state)).toEqual(["start_evaluation", "reset"]);
  });

  it("freezes both catalogue and state and isolates caller mutation", () => {
    const input = catalog();
    const state = createInitialConsumerState(input);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.catalog)).toBe(true);
    expect(Object.isFrozen(state.catalog.merchants)).toBe(true);
    const merchant = input.merchants[0];
    const branch = merchant?.branches[0];
    if (!merchant || !branch) throw new Error("catalog fixture incomplete");
    branch.name = "mutated";
    const frozenMerchant = state.catalog.merchants[0];
    const frozenBranch = frozenMerchant?.branches[0];
    expect(frozenBranch?.name).toBe("Tokyo Main");
    expect(() => {
      (state as { phase: string }).phase = "ready";
    }).toThrow();
  });

  it("rejects transition bypass, unknown fields, duplicate IDs, and bad cap ranges", () => {
    const state = createInitialConsumerState(catalog());
    expect(() =>
      transitionConsumerState({ ...state, phase: "ready" } as ConsumerState, {
        type: "start_evaluation",
      }),
    ).toThrow(/state_not_created_by_consumer_alpha/);
    expect(() =>
      transitionConsumerState(state, {
        type: "select_merchant",
        merchant_id: "merchant.synthetic",
        branch_id: "branch.tokyo",
        extra: true,
      }),
    ).toThrow(/event.select_merchant.extra/);
    let purchaseState = reduceConsumerState(state, {
      type: "select_merchant",
      merchant_id: "merchant.synthetic",
      branch_id: "branch.tokyo",
    });
    purchaseState = reduceConsumerState(purchaseState, {
      type: "define_purchase",
      purchase: { amount_jpy: 1, channel: "in_store" },
    });
    expect(() =>
      reduceConsumerState(purchaseState, {
        type: "define_wallets",
        selection: { wallet_ids: [], product_ids: [] },
      }),
    ).toThrow(/wallet_selection_required/);
    const duplicateCatalog = catalog();
    const duplicateWallet = duplicateCatalog.wallets[0];
    if (!duplicateWallet) throw new Error("catalog wallet fixture incomplete");
    expect(() =>
      createInitialConsumerState({
        ...duplicateCatalog,
        wallets: [...duplicateCatalog.wallets, { ...duplicateWallet }],
      }),
    ).toThrow(/duplicate_id/);
    const almostReady = reduceConsumerState(
      reduceConsumerState(
        reduceConsumerState(
          reduceConsumerState(
            reduceConsumerState(state, {
              type: "select_merchant",
              merchant_id: "merchant.synthetic",
              branch_id: "branch.tokyo",
            }),
            {
              type: "define_purchase",
              purchase: { amount_jpy: 1, channel: "in_store" },
            },
          ),
          {
            type: "define_wallets",
            selection: { wallet_ids: ["wallet.card"], product_ids: [] },
          },
        ),
        {
          type: "define_facts",
          facts: [{ fact_id: "known", status: "unknown" }],
        },
      ),
      { type: "ask_stored_value_question" },
    );
    expect(() =>
      reduceConsumerState(almostReady, {
        type: "answer_stored_value_question",
        answers: [],
      }),
    ).not.toThrow();
    const capsReady = reduceConsumerState(almostReady, {
      type: "answer_stored_value_question",
      answers: [],
    });
    expect(() =>
      reduceConsumerState(capsReady, {
        type: "define_caps",
        caps: [{ asset_id: "not.selected", min_jpy: 100, max_jpy: 1 }],
      }),
    ).toThrow(/cap_asset_not_selected/);
  });

  it("canonicalizes custom stored-value decimals and rejects missing valuation", () => {
    let state = createInitialConsumerState(catalog());
    state = reduceConsumerState(state, {
      type: "select_merchant",
      merchant_id: "merchant.synthetic",
      branch_id: "branch.tokyo",
    });
    state = reduceConsumerState(state, {
      type: "define_purchase",
      purchase: { amount_jpy: 1, channel: "in_store" },
    });
    state = reduceConsumerState(state, {
      type: "define_wallets",
      selection: { wallet_ids: ["wallet.balance"], product_ids: [] },
    });
    state = reduceConsumerState(state, {
      type: "define_facts",
      facts: [{ fact_id: "balance_known", status: "known", value: false }],
    });
    state = reduceConsumerState(state, { type: "ask_stored_value_question" });
    expect(() =>
      reduceConsumerState(state, {
        type: "answer_stored_value_question",
        answers: [],
      }),
    ).toThrow(/stored_value_answer_missing/);
    state = reduceConsumerState(state, {
      type: "answer_stored_value_question",
      answers: [
        { asset_id: "wallet.balance", usage: "custom", custom_value: "0.7500" },
      ],
    });
    expect(state.stored_value_answers).toEqual([
      { asset_id: "wallet.balance", usage: "custom", custom_value: "0.75" },
    ]);
  });

  it("canonicalizes semantically equivalent catalog and onboarding order", () => {
    expect(JSON.stringify(toReady())).toBe(
      JSON.stringify(toReady(catalog(), true)),
    );
  });

  it("rejects proxies, hidden fields, symbols, and accessors before dereferencing", () => {
    const state = createInitialConsumerState(catalog());
    const proxyEvent = new Proxy(
      {
        type: "select_merchant",
        merchant_id: "merchant.synthetic",
        branch_id: "branch.tokyo",
      },
      {},
    );
    expect(() => transitionConsumerState(state, proxyEvent)).toThrow(
      /security_admission_denied/,
    );

    const hiddenEvent: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({
      type: "select_merchant",
      merchant_id: "merchant.synthetic",
      branch_id: "branch.tokyo",
    })) {
      Object.defineProperty(hiddenEvent, key, {
        value,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
    expect(() => transitionConsumerState(state, hiddenEvent)).toThrow(
      /security_admission_denied/,
    );

    let reads = 0;
    const accessorEvent: Record<string, unknown> = {};
    Object.defineProperty(accessorEvent, "type", {
      enumerable: true,
      get: () => {
        reads += 1;
        return "select_merchant";
      },
    });
    expect(() => transitionConsumerState(state, accessorEvent)).toThrow(
      /security_admission_denied/,
    );
    expect(reads).toBe(0);

    expect(() => createInitialConsumerState(new Proxy(catalog(), {}))).toThrow(
      /security_admission_denied/,
    );
    const hiddenCatalog: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(catalog())) {
      Object.defineProperty(hiddenCatalog, key, {
        value,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
    expect(() => createInitialConsumerState(hiddenCatalog)).toThrow(
      /security_admission_denied/,
    );
  });

  it("rejects credentials and personal contact values without echoing them", () => {
    const state = toFacts();
    for (const value of [
      "4111 1111 1111 1111",
      "Bearer very-secret-token",
      "person@example.test",
    ]) {
      expect(() =>
        reduceConsumerState(state, {
          type: "define_facts",
          facts: [{ fact_id: "user_value", status: "known", value }],
        }),
      ).toThrow(/security_admission_denied/);
      try {
        reduceConsumerState(state, {
          type: "define_facts",
          facts: [{ fact_id: "user_value", status: "known", value }],
        });
      } catch (error) {
        expect(String(error)).not.toContain(value);
      }
    }
  });

  it("bounds custom decimal length and compares the range lexically", () => {
    let state = createInitialConsumerState(catalog());
    state = reduceConsumerState(state, {
      type: "select_merchant",
      merchant_id: "merchant.synthetic",
      branch_id: "branch.tokyo",
    });
    state = reduceConsumerState(state, {
      type: "define_purchase",
      purchase: { amount_jpy: 1, channel: "in_store" },
    });
    state = reduceConsumerState(state, {
      type: "define_wallets",
      selection: { wallet_ids: ["wallet.balance"], product_ids: [] },
    });
    state = reduceConsumerState(state, {
      type: "define_facts",
      facts: [{ fact_id: "balance_known", status: "unknown" }],
    });
    state = reduceConsumerState(state, { type: "ask_stored_value_question" });
    for (const customValue of [
      "1.000000000000000000000000000000000001",
      `0${"0".repeat(100_000)}1`,
    ]) {
      expect(() =>
        reduceConsumerState(state, {
          type: "answer_stored_value_question",
          answers: [
            {
              asset_id: "wallet.balance",
              usage: "custom",
              custom_value: customValue,
            },
          ],
        }),
      ).toThrow(/stored_value_answer_invalid/);
    }
  });

  it("requires explicit Tokyo branch scope", () => {
    const source = catalog();
    const merchant = source.merchants[0];
    if (!merchant) throw new Error("catalog merchant fixture incomplete");
    const branch = merchant.branches[0];
    if (!branch) throw new Error("catalog branch fixture incomplete");
    const withoutCity = {
      ...source,
      merchants: [
        {
          ...merchant,
          branches: [{ branch_id: branch.branch_id, name: branch.name }],
        },
      ],
    };
    expect(() => createInitialConsumerState(withoutCity)).toThrow(
      /branch_not_tokyo/,
    );
  });

  it("keeps evaluation outcomes explicit, supports correction, and resets deterministically", () => {
    const ready = toReady();
    const evaluating = transitionConsumerState(ready, {
      type: "start_evaluation",
    });
    const hostEvent = {
      type: "evaluation_result",
      result: {
        outcome: "conditional",
        recommendation_hash: `sha256:${"a".repeat(64)}`,
        winner_plan_id: "plan.winner",
        fallback_plan_id: "plan.safe",
        explanation: "Use the winner when the stated cap remains available.",
        sensitivities: [
          { label: "cap", base_jpy: 640, low_jpy: 0, high_jpy: 640 },
        ],
      },
    } as const;
    expect(() =>
      transitionConsumerInputState(ready, hostEvent as never),
    ).toThrow(/host_event_requires_trusted_boundary/);
    const result = applyHostEvaluation(evaluating, hostEvent);
    expect(result.phase).toBe("result");
    const correction = transitionConsumerState(result, {
      type: "open_correction",
    });
    expect(correction.phase).toBe("correction");
    expect(correction.result?.recommendation_hash).toBe(
      result.recommendation_hash,
    );
    const recorded = transitionConsumerState(correction, {
      type: "record_correction",
      correction: {
        category: "wrong_reward_amount",
        recommendation_hash: `sha256:${"a".repeat(64)}`,
      },
    });
    expect(recorded.correction?.category).toBe("wrong_reward_amount");
    expect(() =>
      transitionConsumerState(correction, {
        type: "record_correction",
        correction: {
          category: "wrong_reward_amount",
          recommendation_hash: `sha256:${"b".repeat(64)}`,
        },
      }),
    ).toThrow(/correction_recommendation_mismatch/);

    const blocked = applyHostEvaluation(evaluating, {
      type: "evaluation_blocked",
      result: { reason: "synthetic host gate" },
    });
    expect(() =>
      transitionConsumerState(blocked, { type: "open_correction" }),
    ).toThrow(/phase_event_not_allowed/);
    const reset = transitionConsumerState(recorded, { type: "reset" });
    expect(reset.phase).toBe("intro");
    expect(reset.revision).toBe(ready.revision + 5);
    expect(reset.catalog).toBe(ready.catalog);
    expect({ ...reset, revision: 0 }).toEqual(
      createInitialConsumerState(catalog()),
    );
  });
});
