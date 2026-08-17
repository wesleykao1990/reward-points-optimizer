export type RewardClass = "normal" | "limited_period" | "usage_limited" | "stored_value" | null;
export type MovementDirection = "create" | "consume" | "return" | "expire";

export interface AssetQuantity {
  assetId: string;
  rewardClass: RewardClass;
  units: bigint;
}

export interface AssetMovement {
  movementId: string;
  operationId: string;
  direction: MovementDirection;
  role:
    | "external_funding"
    | "principal_output"
    | "principal_tender"
    | "fee"
    | "refund"
    | "reversal";
  quantity: AssetQuantity;
}

export interface AssetLot {
  lotId: string;
  quantity: AssetQuantity;
}

/** Native accounting component. It deliberately contains no JPY valuation. */
export interface RewardComponent {
  componentId: string;
  operationId: string;
  ruleId: string;
  quantity: AssetQuantity;
  certainty: "guaranteed" | "probabilistic";
}

export interface ValuedRewardComponent extends RewardComponent {
  valueMicros: bigint;
}

export interface NativePlanResult {
  planId: string;
  steps: string[];
  movements: AssetMovement[];
  endingLots: AssetLot[];
  rewards: RewardComponent[];
  externalFundingJpy: bigint;
  merchantValueJpy: bigint;
  residualUnits: bigint;
}

export interface ValuedPlanResult extends Omit<NativePlanResult, "rewards"> {
  rewards: ValuedRewardComponent[];
  endingAssetValueMicros: bigint;
  rewardValueMicros: bigint;
  netValueMicros: bigint;
}

export interface PurchaseInput {
  amountJpy: number;
  residualValueJpyPerUnit: string;
  pointCardPresented: boolean;
  campaignEnrolled: boolean;
}

export interface Recommendation {
  winner: ValuedPlanResult;
  runnerUp: ValuedPlanResult;
  plans: ValuedPlanResult[];
  breakEvenResidualValue: string | null;
  explanation: string[];
  synthetic: true;
}

export type ReviewMode =
  | "solo_dual_pass"
  | "agent_challenged"
  | "human_second_review"
  | "expert_review";

export interface ReviewEvent {
  mode: ReviewMode;
  decision: "approved" | "rejected" | "needs_more_evidence";
  reviewerId: string;
  completedAt: string;
}
