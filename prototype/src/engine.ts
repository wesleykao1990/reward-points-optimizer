import type {
  AssetMovement,
  NativePlanResult,
  PurchaseInput,
  Recommendation,
  RewardClass,
  RewardComponent,
  ValuedPlanResult,
  ValuedRewardComponent,
} from "./model.ts";
import {
  MICROS_PER_JPY,
  ceilToIncrement,
  formatMicros,
  formatRatio,
  parseJpyPerUnitToMicros,
  pointsPerUnit,
} from "./math.ts";
import { validateConservation } from "./contracts.ts";

function rewardMicrosPerUnit(rewardClass: RewardClass): bigint {
  switch (rewardClass) {
    case "normal":
      return MICROS_PER_JPY;
    case "limited_period":
      return 800_000n;
    case "usage_limited":
      return 700_000n;
    default:
      return 0n;
  }
}

function loyaltyReward(
  amount: bigint,
  operationId: string,
  enabled: boolean,
): RewardComponent[] {
  if (!enabled) return [];
  const units = pointsPerUnit(amount, 200n, 1n);
  if (units === 0n) return [];
  return [
    {
      componentId: `reward_loyalty_${operationId}`,
      operationId,
      ruleId: "rr_demo_loyalty",
      quantity: {
        assetId: "demo.point",
        rewardClass: "normal",
        units,
      },
      certainty: "guaranteed",
    },
  ];
}

export function buildNativePlans(input: PurchaseInput): NativePlanResult[] {
  if (
    !Number.isInteger(input.amountJpy) ||
    input.amountJpy <= 0 ||
    input.amountJpy > 1_000_000
  ) {
    throw new Error("invalid_amount");
  }

  const amount = BigInt(input.amountJpy);
  const directRewards = loyaltyReward(
    amount,
    "op_direct",
    input.pointCardPresented,
  );
  const direct: NativePlanResult = {
    planId: "direct_card",
    steps: [
      "Present the selected point card",
      "Pay directly with Demo Card",
    ],
    movements: [
      {
        movementId: "mov_direct_funding",
        operationId: "op_direct",
        direction: "consume",
        role: "external_funding",
        quantity: {
          assetId: "credit.demo.direct",
          rewardClass: null,
          units: amount,
        },
      },
    ],
    endingLots: [],
    rewards: directRewards,
    externalFundingJpy: amount,
    merchantValueJpy: amount,
    residualUnits: 0n,
  };

  const topup = ceilToIncrement(amount, 1000n);
  const residual = topup - amount;
  const topupRewards: RewardComponent[] = [
    {
      componentId: "reward_topup",
      operationId: "op_topup",
      ruleId: "rr_demo_topup",
      quantity: {
        assetId: "demo.point",
        rewardClass: "normal",
        units: topup / 100n,
      },
      certainty: "guaranteed",
    },
    ...loyaltyReward(
      amount,
      "op_wallet_purchase",
      input.pointCardPresented,
    ),
  ];

  if (input.campaignEnrolled) {
    topupRewards.push({
      componentId: "reward_campaign",
      operationId: "op_wallet_purchase",
      ruleId: "rr_demo_campaign",
      quantity: {
        assetId: "demo.point",
        rewardClass: "limited_period",
        units: 40n,
      },
      certainty: "guaranteed",
    });
  }

  const movements: AssetMovement[] = [
    {
      movementId: "mov_topup_funding",
      operationId: "op_topup",
      direction: "consume",
      role: "external_funding",
      quantity: {
        assetId: "credit.demo.topup",
        rewardClass: null,
        units: topup,
      },
    },
    {
      movementId: "mov_topup_create",
      operationId: "op_topup",
      direction: "create",
      role: "principal_output",
      quantity: {
        assetId: "wallet.demo.balance",
        rewardClass: "stored_value",
        units: topup,
      },
    },
    {
      movementId: "mov_wallet_tender",
      operationId: "op_wallet_purchase",
      direction: "consume",
      role: "principal_tender",
      quantity: {
        assetId: "wallet.demo.balance",
        rewardClass: "stored_value",
        units: amount,
      },
    },
  ];

  const endingLots =
    residual > 0n
      ? [
          {
            lotId: "lot_wallet_residual",
            quantity: {
              assetId: "wallet.demo.balance",
              rewardClass: "stored_value" as const,
              units: residual,
            },
          },
        ]
      : [];

  validateConservation([], movements, endingLots);

  const wallet: NativePlanResult = {
    planId: "topup_wallet",
    steps: [
      `Top up Demo Wallet by ¥${topup}`,
      "Present the selected point card",
      "Pay with Demo Wallet",
      `Keep ¥${residual} wallet balance`,
    ],
    movements,
    endingLots,
    rewards: topupRewards,
    externalFundingJpy: topup,
    merchantValueJpy: amount,
    residualUnits: residual,
  };

  return [direct, wallet];
}

export function valuePlan(
  plan: NativePlanResult,
  residualMicrosPerUnit: bigint,
): ValuedPlanResult {
  const endingAssetValueMicros = plan.residualUnits * residualMicrosPerUnit;
  const rewards: ValuedRewardComponent[] = plan.rewards.map((reward) => ({
    ...reward,
    valueMicros:
      reward.quantity.units *
      rewardMicrosPerUnit(reward.quantity.rewardClass),
  }));
  const rewardValueMicros = rewards.reduce(
    (sum, reward) => sum + reward.valueMicros,
    0n,
  );
  const netValueMicros =
    plan.merchantValueJpy * MICROS_PER_JPY +
    endingAssetValueMicros +
    rewardValueMicros -
    plan.externalFundingJpy * MICROS_PER_JPY;
  return {
    ...plan,
    rewards,
    endingAssetValueMicros,
    rewardValueMicros,
    netValueMicros,
  };
}

export function evaluatePurchase(input: PurchaseInput): Recommendation {
  const residualMicros = parseJpyPerUnitToMicros(
    input.residualValueJpyPerUnit,
  );
  const plans = buildNativePlans(input)
    .map((plan) => valuePlan(plan, residualMicros))
    .sort((a, b) =>
      a.netValueMicros === b.netValueMicros
        ? a.planId.localeCompare(b.planId)
        : a.netValueMicros > b.netValueMicros
          ? -1
          : 1,
    );

  const [winner, runnerUp] = plans;
  if (!winner || !runnerUp) throw new Error("insufficient_candidate_plans");

  const wallet = plans.find((plan) => plan.planId === "topup_wallet");
  const direct = plans.find((plan) => plan.planId === "direct_card");
  if (!wallet || !direct) throw new Error("prototype_plan_missing");

  const fixedWalletMicros =
    wallet.merchantValueJpy * MICROS_PER_JPY +
    wallet.rewardValueMicros -
    wallet.externalFundingJpy * MICROS_PER_JPY;
  const breakEvenNumeratorMicros =
    wallet.residualUnits > 0n
      ? direct.netValueMicros - fixedWalletMicros
      : null;
  const breakEvenDisplay =
    breakEvenNumeratorMicros === null
      ? null
      : formatRatio(
          breakEvenNumeratorMicros,
          wallet.residualUnits * MICROS_PER_JPY,
          12,
        );

  const explanation = [
    `${winner.planId === "direct_card" ? "Direct card" : "Wallet top-up"} wins by ¥${formatMicros(winner.netValueMicros - runnerUp.netValueMicros)} of modeled value.`,
    `Wallet residual is valued at ¥${input.residualValueJpyPerUnit} per unit.`,
    ...(breakEvenDisplay === null
      ? []
      : [
          `Wallet becomes preferable above approximately ¥${breakEvenDisplay.slice(0, 8)} per residual unit, holding other assumptions fixed.`,
        ]),
    "All rates and merchants in this prototype are synthetic and are not purchase advice.",
  ];

  return {
    winner,
    runnerUp,
    plans,
    breakEvenResidualValue: breakEvenDisplay,
    explanation,
    synthetic: true,
  };
}

export function serializeRecommendation(result: Recommendation): unknown {
  return JSON.parse(
    JSON.stringify(result, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}
