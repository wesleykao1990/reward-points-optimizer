/**
 * Public aliases for the generated schema types. The source modules remain
 * separate because Draft schemas intentionally reuse local definition names
 * (for example `Review` and `AssetRef`) in different documents.
 */
import type * as AssetSchema from "./generated/asset.js";
import type * as EvidenceSchema from "./generated/evidence-record.js";
import type * as ExtractionSchema from "./generated/extraction-candidate.js";
import type * as GoldenSchema from "./generated/golden-scenario.js";
import type * as PlanSchema from "./generated/purchase-plan.js";
import type * as ClaimSchema from "./generated/reward-claim.js";
import type * as RuleSchema from "./generated/reward-rule.js";
import type * as AccessSchema from "./generated/source-access-observation.js";
import type * as ObservationSchema from "./generated/source-observation.js";
import type * as SourceSchema from "./generated/trusted-source.js";
import type * as RegistrySchema from "./generated/trusted-source-registry.js";
import type * as UserSchema from "./generated/user-state.js";

export type Asset = AssetSchema.RewardAndValueAssetDefinition;
export type AssetKind = AssetSchema.AssetKind;
export type RewardClass = AssetSchema.RewardClass;
export type AssetExpiry = AssetSchema.Expiry;
export type UsageRestrictions = AssetSchema.UsageRestrictions;
export type AssetLot = GoldenSchema.AssetLot;
export type AssetMovement = GoldenSchema.AssetMovement;
export type RewardComponent = GoldenSchema.RewardComponent;
export type Quantity = GoldenSchema.Quantity;
export type AssetRef = GoldenSchema.AssetRef;
export type Settlement = GoldenSchema.Settlement;
export type Certainty = GoldenSchema.Certainty;
export type ClawbackPolicy = GoldenSchema.ClawbackPolicy;
export type JpyValueRange = GoldenSchema.JpyValueRange;

export type EvidenceRecord = EvidenceSchema.EvidenceRecord;
export type ExtractionCandidate =
  ExtractionSchema.LLMAssistedExtractionCandidate;
export type SourceAccessObservation = AccessSchema.SourceAccessObservation;
export type SourceObservation =
  ObservationSchema.RewardsOptimizerSourceObservation;
export type TrustedSource = SourceSchema.TrustedSource;
export type TrustedSourceRegistry = RegistrySchema.TrustedSourceRegistry;
export type UserState = UserSchema.UserRewardState;
export type StateValue = UserSchema.StateValue;
export type CapProgressState = UserSchema.CapProgressState;
export type ComparableBound = UserSchema.ComparableBound;

export type PurchasePlan = PlanSchema.CandidatePurchaseOrConversionPlan;
export type RewardClaimDocument = ClaimSchema.StructuredRewardClaimDocument;
export type RewardClaim = ClaimSchema.Claim;
export type Operation = PlanSchema.Operation;
export type AssetInput = PlanSchema.AssetInput;
export type OutputRequest = PlanSchema.OutputRequest;
export type LineItem = PlanSchema.LineItem;
export type Channel = PlanSchema.Channel;
export type PaymentInterface = PlanSchema.Interface;

export type RewardRule = RuleSchema.RewardRule;
export type RuleAudit = RuleSchema.Audit;
export type RuleValidity = RuleSchema.Validity;
export type RuleOutput = RuleSchema.Output;
export type RuleCap = RuleSchema.Cap;
export type RuleCalculation =
  | RuleSchema.PercentageCalculation
  | RuleSchema.PointsPerUnitCalculation
  | RuleSchema.FixedCalculation
  | RuleSchema.TieredCalculation
  | RuleSchema.MultiplierCalculation
  | RuleSchema.TransferCalculation;

export type GoldenScenario = GoldenSchema.GoldenPurchaseOrConversionScenario;
export type ScenarioObjective = GoldenSchema.Objective;
export type ScenarioReview = GoldenSchema.Review;
export type PlanResult = GoldenSchema.PlanResult;
export type ScenarioEconomics = GoldenSchema.Economics;
export type ExpectedOutcome = GoldenSchema.Expected;

/** Namespaces expose every generated definition without flattening collisions. */
export type {
  AssetSchema,
  ClaimSchema,
  EvidenceSchema,
  ExtractionSchema,
  GoldenSchema,
  PlanSchema,
  RuleSchema,
  AccessSchema,
  ObservationSchema,
  RegistrySchema,
  SourceSchema,
  UserSchema,
};
