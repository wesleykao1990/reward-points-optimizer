import { assertAdmitted } from "@jro/recommendation-api";
import {
  type AlphaBranch,
  type AlphaCapRange,
  type AlphaCatalog,
  type AlphaCorrection,
  type AlphaEvaluationResult,
  type AlphaFactStatus,
  type AlphaManualFact,
  type AlphaMerchant,
  type AlphaMerchantSelection,
  type AlphaPurchase,
  type AlphaRecommendationHash,
  type AlphaSensitivity,
  type AlphaStoredValueAnswer,
  type AlphaWallet,
  type AlphaWalletSelection,
  CONSUMER_ALPHA_REGION,
  CONSUMER_ALPHA_TIMEZONE,
  CONSUMER_ALPHA_VERSION,
  type ConsumerEvent,
  type ConsumerEventType,
  type ConsumerInputEvent,
  type ConsumerPhase,
  type ConsumerState,
  ConsumerStateError,
  type ConsumerStateErrorCode,
  type HostEvaluationEvent,
  MAX_CAP_JPY,
  MAX_CUSTOM_VALUE,
  MAX_PURCHASE_JPY,
  MIN_PURCHASE_JPY,
} from "./types.js";

type PlainRecord = Record<string, unknown>;

const DANGEROUS_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "token",
  "access_token",
  "api_key",
  "apikey",
  "password",
  "passcode",
  "secret",
  "private_key",
  "pan",
  "cvv",
  "cvc",
  "pin",
  "barcode",
  "receipt",
  "screenshot",
  "metadata",
]);

const SENSITIVE_TEXT =
  /(?:bearer\s+|api[_ -]?key|access[_ -]?token|password|passcode|private[_ -]?key|\b(?:cvv|cvc|pin|pan)\b|barcode|receipt|screenshot)/i;
const EMAIL_TEXT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_CUSTOM_DECIMAL_LENGTH = 64;

const ALL_PHASES: readonly ConsumerPhase[] = [
  "intro",
  "merchant_selected",
  "purchase_defined",
  "wallets_defined",
  "facts_defined",
  "stored_value_question",
  "caps_defined",
  "ready",
  "evaluating",
  "result",
  "no_valid_plan",
  "blocked",
  "correction",
];

const ALLOWED_EVENTS: Readonly<
  Record<ConsumerPhase, readonly ConsumerEventType[]>
> = {
  intro: ["select_merchant", "reset"],
  merchant_selected: ["define_purchase", "reset"],
  purchase_defined: ["define_wallets", "reset"],
  wallets_defined: ["define_facts", "reset"],
  facts_defined: ["ask_stored_value_question", "reset"],
  stored_value_question: ["answer_stored_value_question", "reset"],
  caps_defined: ["define_caps", "reset"],
  ready: ["start_evaluation", "reset"],
  evaluating: [
    "evaluation_result",
    "evaluation_no_valid_plan",
    "evaluation_blocked",
    "reset",
  ],
  result: ["open_correction", "reset"],
  no_valid_plan: ["reset"],
  blocked: ["reset"],
  correction: ["record_correction", "reset"],
};

const EVENT_KEYS: Readonly<Record<ConsumerEventType, readonly string[]>> = {
  select_merchant: ["type", "merchant_id", "branch_id"],
  define_purchase: ["type", "purchase"],
  define_wallets: ["type", "selection"],
  define_facts: ["type", "facts"],
  ask_stored_value_question: ["type"],
  answer_stored_value_question: ["type", "answers"],
  define_caps: ["type", "caps"],
  start_evaluation: ["type"],
  evaluation_result: ["type", "result"],
  evaluation_no_valid_plan: ["type", "result"],
  evaluation_blocked: ["type", "result"],
  open_correction: ["type"],
  record_correction: ["type", "correction"],
  reset: ["type"],
};

const HOST_EVENT_TYPES = new Set<HostEvaluationEvent["type"]>([
  "evaluation_result",
  "evaluation_no_valid_plan",
  "evaluation_blocked",
]);

const STATE_KEYS = [
  "version",
  "region",
  "timezone",
  "phase",
  "revision",
  "recommendation_hash",
  "catalog",
  "merchant",
  "purchase",
  "wallets",
  "facts",
  "stored_value_answers",
  "caps",
  "result",
  "no_valid_plan_reasons",
  "blockers",
  "correction",
] as const;

const KNOWN_STATES = new WeakSet<object>();

function fail(
  code: ConsumerStateErrorCode,
  message: string,
  phase: ConsumerPhase | null = null,
): never {
  throw new ConsumerStateError(code, message, phase);
}

/** Run the shared M5 admission scanner before any schema property is read. */
function assertSecurityInput(value: unknown, context: string): void {
  try {
    assertAdmitted(value);
  } catch {
    // The shared scanner deliberately exposes only stable redacted diagnostics.
    // Keep this boundary equally value-free; callers never receive the input.
    fail("dangerous_field", `${context}_security_admission_denied`);
  }
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value: unknown, context: string): PlainRecord {
  if (!isPlainRecord(value))
    fail("invalid_event", `${context}_object_required`);
  return value;
}

function exactKeys(
  record: PlainRecord,
  allowed: readonly string[],
  context: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string") fail("unknown_field", `${context}_symbol_key`);
    if (DANGEROUS_KEYS.has(key.toLowerCase()))
      fail("dangerous_field", `${context}.${key}`);
    if (!allowedSet.has(key)) fail("unknown_field", `${context}.${key}`);
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor))
      fail("invalid_event", `${context}.${key}_accessor_not_allowed`);
  }
}

function optionalValue(record: PlainRecord, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  if (value === undefined)
    fail("invalid_event", `${key}_must_not_be_undefined`);
  return value;
}

function requireText(value: unknown, context: string, maxLength = 256): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  )
    fail("invalid_event", `${context}_text_required`);
  if (
    value.trim() !== value ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  )
    fail("invalid_event", `${context}_text_not_canonical`);
  if (SENSITIVE_TEXT.test(value))
    fail("dangerous_field", `${context}_sensitive_text`);
  return value;
}

function requireIdentifier(value: unknown, context: string): string {
  const identifier = requireText(value, context, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(identifier))
    fail("invalid_event", `${context}_identifier_not_canonical`);
  return identifier;
}

function compareCanonicalIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireFiniteInteger(
  value: unknown,
  context: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    fail("invalid_event", `${context}_bounded_integer_required`);
  return value;
}

function requireArray(
  value: unknown,
  context: string,
  maximum = 64,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    fail("invalid_event", `${context}_bounded_array_required`);
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    fail("invalid_event", `${context}_array_unreadable`);
  }
  for (const key of keys) {
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !/^\d+$/u.test(key) ||
      Number(key) < 0 ||
      Number(key) >= value.length ||
      !Object.hasOwn(value, key)
    )
      fail("unknown_field", `${context}.${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor))
      fail("invalid_event", `${context}.${key}_accessor_not_allowed`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, String(index)))
      fail("invalid_event", `${context}[${index}]_sparse`);
  }
  return value;
}

function requireStringArray(
  value: unknown,
  context: string,
  maximum = 64,
): readonly string[] {
  return Array.from(requireArray(value, context, maximum), (_, index) =>
    requireIdentifier(_, `${context}[${index}]`),
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as PlainRecord)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function rejectSensitiveIdentifier(identifier: string, context: string): void {
  if (
    DANGEROUS_KEYS.has(identifier.toLowerCase()) ||
    SENSITIVE_TEXT.test(identifier)
  )
    fail("dangerous_field", `${context}_sensitive_identifier`);
}

function canonicalDecimal(value: unknown, context: string): string {
  let source: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > MAX_CUSTOM_VALUE)
      fail("stored_value_answer_invalid", `${context}_range`);
    source = String(value);
  } else if (typeof value === "string") {
    source = value;
  } else {
    fail("stored_value_answer_invalid", `${context}_decimal_required`);
  }

  if (source.length === 0 || source.length > MAX_CUSTOM_DECIMAL_LENGTH)
    fail("stored_value_answer_invalid", `${context}_decimal_too_long`);
  if (!/^\d+(?:\.\d+)?$/u.test(source))
    fail("stored_value_answer_invalid", `${context}_decimal_not_canonical`);
  const [integerPart, fractionPart = ""] = source.split(".");
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/u, "");
  const normalizedFraction = fractionPart.replace(/0+$/u, "");
  if (normalizedInteger !== "0" && normalizedInteger !== "1")
    fail("stored_value_answer_invalid", `${context}_range`);
  if (normalizedInteger === "1" && /[1-9]/u.test(fractionPart))
    fail("stored_value_answer_invalid", `${context}_range`);
  const normalized = normalizedFraction
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger;
  return normalized;
}

function validateCatalogShape(input: unknown): AlphaCatalog {
  assertSecurityInput(input, "catalog");
  const catalog = requireRecord(input, "catalog");
  exactKeys(
    catalog,
    ["version", "merchants", "wallets", "products", "region"],
    "catalog",
  );
  const version = requireText(catalog.version, "catalog.version", 64);
  const regionValue = optionalValue(catalog, "region");
  if (regionValue !== CONSUMER_ALPHA_REGION)
    fail("catalog_region_unsupported", "catalog.region_must_be_tokyo");

  const merchantInputs = requireArray(
    catalog.merchants,
    "catalog.merchants",
    256,
  );
  if (merchantInputs.length === 0)
    fail("catalog_invalid", "catalog.merchants_required");
  const merchants: AlphaMerchant[] = [];
  const merchantIds = new Set<string>();
  const branchIds = new Set<string>();
  for (
    let merchantIndex = 0;
    merchantIndex < merchantInputs.length;
    merchantIndex += 1
  ) {
    const merchant = requireRecord(
      merchantInputs[merchantIndex],
      `catalog.merchants[${merchantIndex}]`,
    );
    exactKeys(
      merchant,
      ["merchant_id", "name", "branches"],
      `catalog.merchants[${merchantIndex}]`,
    );
    const merchantId = requireIdentifier(
      merchant.merchant_id,
      `catalog.merchants[${merchantIndex}].merchant_id`,
    );
    rejectSensitiveIdentifier(merchantId, "catalog.merchant_id");
    if (merchantIds.has(merchantId))
      fail("duplicate_id", `merchant_id:${merchantId}`);
    merchantIds.add(merchantId);
    const name = requireText(
      merchant.name,
      `catalog.merchants[${merchantIndex}].name`,
    );
    const branchesInput = requireArray(
      merchant.branches,
      `catalog.merchants[${merchantIndex}].branches`,
      256,
    );
    if (branchesInput.length === 0)
      fail("catalog_invalid", `branches_required:${merchantId}`);
    const branches: AlphaBranch[] = [];
    for (
      let branchIndex = 0;
      branchIndex < branchesInput.length;
      branchIndex += 1
    ) {
      const branch = requireRecord(
        branchesInput[branchIndex],
        `catalog.merchants[${merchantIndex}].branches[${branchIndex}]`,
      );
      exactKeys(
        branch,
        ["branch_id", "name", "city"],
        `catalog.merchants[${merchantIndex}].branches[${branchIndex}]`,
      );
      const branchId = requireIdentifier(
        branch.branch_id,
        `catalog.merchants[${merchantIndex}].branches[${branchIndex}].branch_id`,
      );
      rejectSensitiveIdentifier(branchId, "catalog.branch_id");
      if (branchIds.has(branchId))
        fail("duplicate_id", `branch_id:${branchId}`);
      branchIds.add(branchId);
      const city = optionalValue(branch, "city");
      if (city !== CONSUMER_ALPHA_REGION)
        fail("branch_not_tokyo", `branch_id:${branchId}`);
      branches.push({
        branch_id: branchId,
        name: requireText(branch.name, `branch.name:${branchId}`),
        city: CONSUMER_ALPHA_REGION,
      });
    }
    merchants.push({ merchant_id: merchantId, name, branches });
  }

  const productInputs = requireArray(catalog.products, "catalog.products", 256);
  const products: AlphaCatalog["products"][number][] = [];
  const productIds = new Set<string>();
  for (
    let productIndex = 0;
    productIndex < productInputs.length;
    productIndex += 1
  ) {
    const product = requireRecord(
      productInputs[productIndex],
      `catalog.products[${productIndex}]`,
    );
    exactKeys(
      product,
      ["product_id", "name", "kind"],
      `catalog.products[${productIndex}]`,
    );
    const productId = requireIdentifier(
      product.product_id,
      `product.product_id[${productIndex}]`,
    );
    rejectSensitiveIdentifier(productId, "catalog.product_id");
    if (
      productIds.has(productId) ||
      branchIds.has(productId) ||
      merchantIds.has(productId)
    )
      fail("duplicate_id", `product_id:${productId}`);
    const kind = product.kind;
    if (kind !== "stored_value" && kind !== "points")
      fail("catalog_invalid", `product_kind:${productId}`);
    productIds.add(productId);
    products.push({
      product_id: productId,
      name: requireText(product.name, `product.name:${productId}`),
      kind,
    });
  }

  const walletInputs = requireArray(catalog.wallets, "catalog.wallets", 256);
  const wallets: AlphaWallet[] = [];
  const walletIds = new Set<string>();
  for (
    let walletIndex = 0;
    walletIndex < walletInputs.length;
    walletIndex += 1
  ) {
    const wallet = requireRecord(
      walletInputs[walletIndex],
      `catalog.wallets[${walletIndex}]`,
    );
    exactKeys(
      wallet,
      ["wallet_id", "name", "kind", "product_ids"],
      `catalog.wallets[${walletIndex}]`,
    );
    const walletId = requireIdentifier(
      wallet.wallet_id,
      `wallet.wallet_id[${walletIndex}]`,
    );
    rejectSensitiveIdentifier(walletId, "catalog.wallet_id");
    if (
      walletIds.has(walletId) ||
      productIds.has(walletId) ||
      branchIds.has(walletId) ||
      merchantIds.has(walletId)
    )
      fail("duplicate_id", `wallet_id:${walletId}`);
    const kind = wallet.kind;
    if (
      kind !== "card" &&
      kind !== "qr_wallet" &&
      kind !== "stored_value" &&
      kind !== "points"
    )
      fail("catalog_invalid", `wallet_kind:${walletId}`);
    const productIdsValue = optionalValue(wallet, "product_ids");
    const supportedProducts =
      productIdsValue === undefined
        ? undefined
        : [
            ...requireStringArray(
              productIdsValue,
              `wallet.product_ids:${walletId}`,
            ),
          ].sort(compareCanonicalIds);
    if (supportedProducts) {
      const supportedSet = new Set<string>();
      for (const productId of supportedProducts) {
        if (supportedSet.has(productId))
          fail("duplicate_id", `wallet_product_id:${productId}`);
        if (!productIds.has(productId))
          fail("wallet_product_mismatch", `${walletId}:${productId}`);
        supportedSet.add(productId);
      }
    }
    walletIds.add(walletId);
    wallets.push({
      wallet_id: walletId,
      name: requireText(wallet.name, `wallet.name:${walletId}`),
      kind,
      ...(supportedProducts === undefined
        ? {}
        : { product_ids: supportedProducts }),
    });
  }

  const canonicalMerchants = merchants
    .map((merchant) => ({
      ...merchant,
      branches: [...merchant.branches].sort((left, right) =>
        compareCanonicalIds(left.branch_id, right.branch_id),
      ),
    }))
    .sort((left, right) =>
      compareCanonicalIds(left.merchant_id, right.merchant_id),
    );
  const canonicalWallets = [...wallets].sort((left, right) =>
    compareCanonicalIds(left.wallet_id, right.wallet_id),
  );
  const canonicalProducts = [...products].sort((left, right) =>
    compareCanonicalIds(left.product_id, right.product_id),
  );

  return deepFreeze({
    version,
    region: CONSUMER_ALPHA_REGION,
    merchants: canonicalMerchants,
    wallets: canonicalWallets,
    products: canonicalProducts,
  });
}

/** Validate, clone, and freeze a host-owned alpha catalogue. */
export function validateAlphaCatalog(input: unknown): AlphaCatalog {
  return validateCatalogShape(input);
}

function findMerchant(
  catalog: AlphaCatalog,
  merchantId: string,
): AlphaMerchant {
  const merchant = catalog.merchants.find(
    (candidate) => candidate.merchant_id === merchantId,
  );
  if (!merchant) fail("merchant_not_found", `merchant_id:${merchantId}`);
  return merchant;
}

function findBranch(merchant: AlphaMerchant, branchId: string): AlphaBranch {
  const branch = merchant.branches.find(
    (candidate) => candidate.branch_id === branchId,
  );
  if (!branch) fail("branch_not_found", `branch_id:${branchId}`);
  if (branch.city !== CONSUMER_ALPHA_REGION)
    fail("branch_not_tokyo", `branch_id:${branchId}`);
  return branch;
}

function findWallet(catalog: AlphaCatalog, walletId: string): AlphaWallet {
  const wallet = catalog.wallets.find(
    (candidate) => candidate.wallet_id === walletId,
  );
  if (!wallet) fail("wallet_not_allowlisted", `wallet_id:${walletId}`);
  return wallet;
}

function selectedAssetIds(state: ConsumerState): readonly string[] {
  if (!state.wallets) return [];
  return [...state.wallets.wallet_ids, ...state.wallets.product_ids];
}

function storedValueAssetIds(state: ConsumerState): readonly string[] {
  if (!state.wallets) return [];
  const productKinds = new Map(
    state.catalog.products.map((product) => [product.product_id, product.kind]),
  );
  const walletKinds = new Map(
    state.catalog.wallets.map((wallet) => [wallet.wallet_id, wallet.kind]),
  );
  return selectedAssetIds(state).filter(
    (assetId) =>
      productKinds.get(assetId) === "stored_value" ||
      walletKinds.get(assetId) === "stored_value",
  );
}

function validatePurchase(state: ConsumerState, input: unknown): AlphaPurchase {
  const purchase = requireRecord(input, "purchase");
  exactKeys(
    purchase,
    ["amount_jpy", "channel", "merchant_id", "branch_id", "currency"],
    "purchase",
  );
  if (!state.merchant)
    fail("invalid_state", "merchant_selection_missing", state.phase);
  const amount = requireFiniteInteger(
    purchase.amount_jpy,
    "purchase.amount_jpy",
    MIN_PURCHASE_JPY,
    MAX_PURCHASE_JPY,
  );
  if (purchase.channel !== "in_store")
    fail("purchase_channel_unsupported", "channel_in_store_required");
  const merchantId = optionalValue(purchase, "merchant_id");
  const branchId = optionalValue(purchase, "branch_id");
  if (merchantId !== undefined && merchantId !== state.merchant.merchant_id)
    fail("purchase_location_mismatch", "purchase.merchant_id_mismatch");
  if (branchId !== undefined && branchId !== state.merchant.branch_id)
    fail("purchase_location_mismatch", "purchase.branch_id_mismatch");
  if (
    optionalValue(purchase, "currency") !== undefined &&
    purchase.currency !== "JPY"
  )
    fail("purchase_invalid", "purchase.currency_jpy_required");
  return { amount_jpy: amount, channel: "in_store", currency: "JPY" };
}

function validateWalletSelection(
  catalog: AlphaCatalog,
  input: unknown,
): AlphaWalletSelection {
  const selection = requireRecord(input, "selection");
  exactKeys(selection, ["wallet_ids", "product_ids"], "selection");
  const walletIds = requireStringArray(
    selection.wallet_ids,
    "selection.wallet_ids",
  );
  const productIds = requireStringArray(
    selection.product_ids,
    "selection.product_ids",
  );
  if (walletIds.length === 0 && productIds.length === 0)
    fail("wallet_selection_required", "selection_at_least_one_asset_required");
  const seen = new Set<string>();
  for (const walletId of walletIds) {
    if (seen.has(walletId))
      fail("duplicate_id", `selected_wallet_id:${walletId}`);
    seen.add(walletId);
    findWallet(catalog, walletId);
  }
  const products = new Set(
    catalog.products.map((product) => product.product_id),
  );
  for (const productId of productIds) {
    if (seen.has(productId))
      fail("duplicate_id", `selected_asset_id:${productId}`);
    seen.add(productId);
    if (!products.has(productId))
      fail("product_not_allowlisted", `product_id:${productId}`);
  }
  return {
    wallet_ids: [...walletIds].sort(compareCanonicalIds),
    product_ids: [...productIds].sort(compareCanonicalIds),
  };
}

function requireFactStatus(value: unknown, context: string): AlphaFactStatus {
  if (
    value !== "known" &&
    value !== "estimated" &&
    value !== "unknown" &&
    value !== "not_applicable"
  )
    fail("fact_invalid", `${context}_status_invalid`);
  return value;
}

function requireFactValue(
  value: unknown,
  context: string,
): string | number | boolean {
  if (typeof value === "string") {
    if (EMAIL_TEXT.test(value))
      fail("dangerous_field", `${context}_security_admission_denied`);
    return requireText(value, context, 256);
  }
  if (typeof value === "boolean") return value;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value)
  )
    return value;
  fail("fact_invalid", `${context}_scalar_value_required`);
}

function validateFacts(input: unknown): readonly AlphaManualFact[] {
  const values = requireArray(input, "facts", 64);
  if (values.length === 0) fail("fact_invalid", "facts_at_least_one_required");
  const facts: AlphaManualFact[] = [];
  const factIds = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const fact = requireRecord(values[index], `facts[${index}]`);
    exactKeys(fact, ["fact_id", "status", "value"], `facts[${index}]`);
    const factId = requireIdentifier(fact.fact_id, `facts[${index}].fact_id`);
    rejectSensitiveIdentifier(factId, "fact_id");
    if (factIds.has(factId)) fail("fact_duplicate", `fact_id:${factId}`);
    factIds.add(factId);
    const status = requireFactStatus(fact.status, `facts[${index}]`);
    const hasValue = Object.hasOwn(fact, "value");
    if ((status === "unknown" || status === "not_applicable") && hasValue)
      fail("fact_invalid", `${factId}_status_must_not_have_value`);
    if ((status === "known" || status === "estimated") && !hasValue)
      fail("fact_invalid", `${factId}_value_required`);
    facts.push({
      fact_id: factId,
      status,
      ...(hasValue
        ? { value: requireFactValue(fact.value, `facts[${index}].value`) }
        : {}),
    });
  }
  return facts.sort((left, right) =>
    compareCanonicalIds(left.fact_id, right.fact_id),
  );
}

function validateStoredValueAnswers(
  state: ConsumerState,
  input: unknown,
): readonly AlphaStoredValueAnswer[] {
  const values = requireArray(input, "answers", 64);
  const requiredAssets = storedValueAssetIds(state);
  const requiredSet = new Set(requiredAssets);
  const answers: AlphaStoredValueAnswer[] = [];
  const answered = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const answer = requireRecord(values[index], `answers[${index}]`);
    exactKeys(
      answer,
      ["asset_id", "usage", "custom_value"],
      `answers[${index}]`,
    );
    const assetId = requireIdentifier(
      answer.asset_id,
      `answers[${index}].asset_id`,
    );
    if (!requiredSet.has(assetId))
      fail(
        "stored_value_answer_invalid",
        `asset_not_stored_value_or_not_selected:${assetId}`,
      );
    if (answered.has(assetId))
      fail("duplicate_id", `stored_value_answer:${assetId}`);
    answered.add(assetId);
    const usage = answer.usage;
    if (
      usage !== "within_30_days" &&
      usage !== "within_90_days" &&
      usage !== "eventually" &&
      usage !== "rarely" &&
      usage !== "custom"
    )
      fail("stored_value_answer_invalid", `${assetId}_usage_invalid`);
    const hasCustomValue = Object.hasOwn(answer, "custom_value");
    if (usage === "custom" && !hasCustomValue)
      fail("stored_value_answer_invalid", `${assetId}_custom_value_required`);
    if (usage !== "custom" && hasCustomValue)
      fail(
        "stored_value_answer_invalid",
        `${assetId}_custom_value_not_allowed`,
      );
    answers.push({
      asset_id: assetId,
      usage,
      ...(usage === "custom"
        ? {
            custom_value: canonicalDecimal(
              answer.custom_value,
              `${assetId}.custom_value`,
            ),
          }
        : {}),
    });
  }
  for (const requiredAsset of requiredAssets) {
    if (!answered.has(requiredAsset))
      fail(
        "missing_valuation",
        `stored_value_answer_missing:asset_id:${requiredAsset}`,
      );
  }
  return answers.sort((left, right) =>
    compareCanonicalIds(left.asset_id, right.asset_id),
  );
}

function validateCaps(
  state: ConsumerState,
  input: unknown,
): readonly AlphaCapRange[] {
  const values = requireArray(input, "caps", 64);
  const selected = new Set(selectedAssetIds(state));
  const caps: AlphaCapRange[] = [];
  const capIds = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const cap = requireRecord(values[index], `caps[${index}]`);
    exactKeys(cap, ["asset_id", "min_jpy", "max_jpy"], `caps[${index}]`);
    const assetId = requireIdentifier(cap.asset_id, `caps[${index}].asset_id`);
    if (!selected.has(assetId))
      fail("cap_asset_not_selected", `asset_id:${assetId}`);
    if (capIds.has(assetId)) fail("cap_duplicate", `asset_id:${assetId}`);
    const minimum = requireFiniteInteger(
      cap.min_jpy,
      `caps[${index}].min_jpy`,
      0,
      MAX_CAP_JPY,
    );
    const maximum = requireFiniteInteger(
      cap.max_jpy,
      `caps[${index}].max_jpy`,
      0,
      MAX_CAP_JPY,
    );
    if (minimum > maximum)
      fail("cap_invalid", `asset_id:${assetId}_min_gt_max`);
    capIds.add(assetId);
    caps.push({ asset_id: assetId, min_jpy: minimum, max_jpy: maximum });
  }
  for (const assetId of selected) {
    if (!capIds.has(assetId)) fail("cap_asset_missing", `asset_id:${assetId}`);
  }
  return caps.sort((left, right) =>
    compareCanonicalIds(left.asset_id, right.asset_id),
  );
}

function validateSensitivity(
  value: unknown,
  context: string,
): AlphaSensitivity {
  const sensitivity = requireRecord(value, context);
  exactKeys(sensitivity, ["label", "base_jpy", "low_jpy", "high_jpy"], context);
  const label = requireText(sensitivity.label, `${context}.label`, 128);
  const base = requireFiniteInteger(
    sensitivity.base_jpy,
    `${context}.base_jpy`,
    -MAX_CAP_JPY,
    MAX_CAP_JPY,
  );
  const low = requireFiniteInteger(
    sensitivity.low_jpy,
    `${context}.low_jpy`,
    -MAX_CAP_JPY,
    MAX_CAP_JPY,
  );
  const high = requireFiniteInteger(
    sensitivity.high_jpy,
    `${context}.high_jpy`,
    -MAX_CAP_JPY,
    MAX_CAP_JPY,
  );
  if (low > base || base > high)
    fail("evaluation_result_invalid", `${context}_range_not_ordered`);
  return { label, base_jpy: base, low_jpy: low, high_jpy: high };
}

function validateEvaluationResult(input: unknown): AlphaEvaluationResult {
  const result = requireRecord(input, "result");
  exactKeys(
    result,
    [
      "outcome",
      "recommendation_hash",
      "winner_plan_id",
      "fallback_plan_id",
      "explanation",
      "sensitivities",
    ],
    "result",
  );
  const outcome = result.outcome;
  if (outcome !== "definite" && outcome !== "conditional")
    fail("evaluation_result_invalid", "result.outcome_invalid");
  if (
    typeof result.recommendation_hash !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(result.recommendation_hash)
  )
    fail("evaluation_result_invalid", "result.recommendation_hash_invalid");
  const winnerPlanId = requireIdentifier(
    result.winner_plan_id,
    "result.winner_plan_id",
  );
  const fallbackValue = result.fallback_plan_id;
  if (fallbackValue !== null && typeof fallbackValue !== "string")
    fail("evaluation_result_invalid", "result.fallback_plan_id_invalid");
  const fallbackPlanId =
    fallbackValue === null
      ? null
      : requireIdentifier(fallbackValue, "result.fallback_plan_id");
  if (fallbackPlanId === winnerPlanId)
    fail(
      "evaluation_result_invalid",
      "result.fallback_must_differ_from_winner",
    );
  const explanation = requireText(
    result.explanation,
    "result.explanation",
    2_000,
  );
  const sensitivityValues = requireArray(
    result.sensitivities,
    "result.sensitivities",
    16,
  );
  if (outcome === "conditional" && sensitivityValues.length === 0)
    fail(
      "evaluation_result_invalid",
      "conditional_result_requires_sensitivity",
    );
  const sensitivities = sensitivityValues.map((value, index) =>
    validateSensitivity(value, `result.sensitivities[${index}]`),
  );
  return {
    outcome,
    recommendation_hash: result.recommendation_hash as AlphaRecommendationHash,
    winner_plan_id: winnerPlanId,
    fallback_plan_id: fallbackPlanId,
    explanation,
    sensitivities,
  };
}

function validateNoValidPlan(input: unknown): readonly string[] {
  const result = requireRecord(input, "result");
  exactKeys(result, ["reasons"], "result");
  const reasons = requireArray(result.reasons, "result.reasons", 16);
  if (reasons.length === 0)
    fail("evaluation_result_invalid", "no_valid_plan_reason_required");
  return reasons.map((reason, index) =>
    requireText(reason, `result.reasons[${index}]`, 512),
  );
}

function validateBlocked(input: unknown): string {
  const result = requireRecord(input, "result");
  exactKeys(result, ["reason"], "result");
  return requireText(result.reason, "result.reason", 512);
}

function validateCorrection(
  input: unknown,
  expectedRecommendationHash: AlphaRecommendationHash | null,
): AlphaCorrection {
  if (expectedRecommendationHash === null)
    fail("correction_invalid", "correction_recommendation_missing");
  const correction = requireRecord(input, "correction");
  exactKeys(correction, ["category", "recommendation_hash"], "correction");
  const category = correction.category;
  if (
    category !== "wrong_merchant" &&
    category !== "wrong_branch" &&
    category !== "wrong_plan" &&
    category !== "missing_reward" &&
    category !== "unexpected_reward" &&
    category !== "wrong_reward_amount"
  )
    fail("correction_invalid", "correction.category_invalid");
  if (
    typeof correction.recommendation_hash !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(correction.recommendation_hash)
  )
    fail("correction_invalid", "correction.recommendation_hash_invalid");
  if (correction.recommendation_hash !== expectedRecommendationHash)
    fail("correction_invalid", "correction_recommendation_mismatch");
  return {
    category,
    recommendation_hash: correction.recommendation_hash as `sha256:${string}`,
  };
}

function validateEventShape(event: unknown): ConsumerEvent {
  const record = requireRecord(event, "event");
  const type = record.type;
  if (typeof type !== "string" || !Object.hasOwn(EVENT_KEYS, type))
    fail("invalid_event", "event.type_unknown");
  exactKeys(record, EVENT_KEYS[type as ConsumerEventType], `event.${type}`);
  return record as ConsumerEvent;
}

function assertState(state: unknown): asserts state is ConsumerState {
  if (
    !isPlainRecord(state) ||
    !KNOWN_STATES.has(state) ||
    !Object.isFrozen(state)
  )
    fail("invalid_state", "state_not_created_by_consumer_alpha");
  const candidate = state as unknown as ConsumerState;
  exactKeys(state, STATE_KEYS, "state");
  if (
    candidate.version !== CONSUMER_ALPHA_VERSION ||
    !ALL_PHASES.includes(candidate.phase)
  )
    fail("invalid_state", "state_version_or_phase_invalid");
  if (!Number.isSafeInteger(candidate.revision) || candidate.revision < 0)
    fail("invalid_state", "state_revision_invalid");
}

function makeState(
  state: Omit<ConsumerState, "revision" | "phase">,
  phase: ConsumerPhase,
  revision: number,
): ConsumerState {
  const next = deepFreeze({ ...state, phase, revision }) as ConsumerState;
  KNOWN_STATES.add(next);
  return next;
}

function baseState(catalog: AlphaCatalog, revision = 0): ConsumerState {
  return makeState(
    {
      version: CONSUMER_ALPHA_VERSION,
      region: CONSUMER_ALPHA_REGION,
      timezone: CONSUMER_ALPHA_TIMEZONE,
      catalog,
      recommendation_hash: null,
      merchant: null,
      purchase: null,
      wallets: null,
      facts: [],
      stored_value_answers: [],
      caps: [],
      result: null,
      no_valid_plan_reasons: [],
      blockers: [],
      correction: null,
    },
    "intro",
    revision,
  );
}

/** Create the initial immutable state for a Tokyo-only local alpha session. */
export function createInitialConsumerState(input: unknown): ConsumerState {
  const catalog = validateCatalogShape(input);
  return baseState(catalog);
}

export const createConsumerState = createInitialConsumerState;

/** Return the exact event types accepted at the current phase. */
export function allowedConsumerEvents(
  state: ConsumerState,
): readonly ConsumerEventType[] {
  assertState(state);
  return deepFreeze([...ALLOWED_EVENTS[state.phase]]);
}

export const getAllowedConsumerEvents = allowedConsumerEvents;

function nextState(
  state: ConsumerState,
  patch: Partial<ConsumerState>,
  phase: ConsumerPhase,
): ConsumerState {
  return makeState(
    {
      version: state.version,
      region: state.region,
      timezone: state.timezone,
      catalog: state.catalog,
      recommendation_hash: state.recommendation_hash,
      merchant: state.merchant,
      purchase: state.purchase,
      wallets: state.wallets,
      facts: state.facts,
      stored_value_answers: state.stored_value_answers,
      caps: state.caps,
      result: state.result,
      no_valid_plan_reasons: state.no_valid_plan_reasons,
      blockers: state.blockers,
      correction: state.correction,
      ...patch,
    },
    phase,
    state.revision + 1,
  );
}

function resetState(state: ConsumerState): ConsumerState {
  return baseState(state.catalog, state.revision + 1);
}

/**
 * Apply one closed-world event at the trusted host orchestration boundary.
 * Browser/user code must use `transitionConsumerInputState`; evaluation
 * events are accepted here only after the host has selected the result.
 * Every transition returns a fresh, deeply frozen state; inputs are never
 * mutated.
 */
export function transitionConsumerState(
  state: ConsumerState,
  inputEvent: unknown,
): ConsumerState {
  assertState(state);
  assertSecurityInput(inputEvent, "event");
  const event = validateEventShape(inputEvent);
  if (!ALLOWED_EVENTS[state.phase].includes(event.type))
    fail(
      "phase_event_not_allowed",
      `${state.phase}:${event.type}`,
      state.phase,
    );

  switch (event.type) {
    case "reset":
      return resetState(state);
    case "select_merchant": {
      const merchantId = requireIdentifier(
        event.merchant_id,
        "event.merchant_id",
      );
      const branchId = requireIdentifier(event.branch_id, "event.branch_id");
      const merchant = findMerchant(state.catalog, merchantId);
      findBranch(merchant, branchId);
      const selection: AlphaMerchantSelection = {
        merchant_id: merchantId,
        branch_id: branchId,
      };
      return nextState(
        state,
        {
          merchant: selection,
          purchase: null,
          wallets: null,
          facts: [],
          stored_value_answers: [],
          caps: [],
          recommendation_hash: null,
          result: null,
          no_valid_plan_reasons: [],
          blockers: [],
          correction: null,
        },
        "merchant_selected",
      );
    }
    case "define_purchase": {
      const purchase = validatePurchase(state, event.purchase);
      return nextState(state, { purchase }, "purchase_defined");
    }
    case "define_wallets": {
      const wallets = validateWalletSelection(state.catalog, event.selection);
      return nextState(
        state,
        {
          wallets,
          facts: [],
          stored_value_answers: [],
          caps: [],
          recommendation_hash: null,
          result: null,
          no_valid_plan_reasons: [],
          blockers: [],
          correction: null,
        },
        "wallets_defined",
      );
    }
    case "define_facts": {
      const facts = validateFacts(event.facts);
      return nextState(
        state,
        {
          facts,
          stored_value_answers: [],
          caps: [],
          recommendation_hash: null,
          result: null,
          no_valid_plan_reasons: [],
          blockers: [],
          correction: null,
        },
        "facts_defined",
      );
    }
    case "ask_stored_value_question":
      return nextState(
        state,
        { stored_value_answers: [], caps: [], recommendation_hash: null },
        "stored_value_question",
      );
    case "answer_stored_value_question": {
      const answers = validateStoredValueAnswers(state, event.answers);
      return nextState(
        state,
        {
          stored_value_answers: answers,
          caps: [],
          recommendation_hash: null,
          result: null,
          no_valid_plan_reasons: [],
          blockers: [],
          correction: null,
        },
        "caps_defined",
      );
    }
    case "define_caps": {
      const caps = validateCaps(state, event.caps);
      return nextState(
        state,
        {
          caps,
          recommendation_hash: null,
          result: null,
          no_valid_plan_reasons: [],
          blockers: [],
          correction: null,
        },
        "ready",
      );
    }
    case "start_evaluation":
      return nextState(
        state,
        {
          recommendation_hash: null,
          result: null,
          no_valid_plan_reasons: [],
          blockers: [],
          correction: null,
        },
        "evaluating",
      );
    case "evaluation_result": {
      const result = validateEvaluationResult(event.result);
      return nextState(
        state,
        {
          recommendation_hash: result.recommendation_hash,
          result,
          no_valid_plan_reasons: [],
          blockers: [],
          correction: null,
        },
        "result",
      );
    }
    case "evaluation_no_valid_plan": {
      const reasons = validateNoValidPlan(event.result);
      return nextState(
        state,
        {
          result: null,
          recommendation_hash: null,
          no_valid_plan_reasons: reasons,
          blockers: [],
          correction: null,
        },
        "no_valid_plan",
      );
    }
    case "evaluation_blocked": {
      const reason = validateBlocked(event.result);
      return nextState(
        state,
        {
          result: null,
          recommendation_hash: null,
          no_valid_plan_reasons: [],
          blockers: [reason],
          correction: null,
        },
        "blocked",
      );
    }
    case "open_correction":
      return nextState(state, { correction: null }, "correction");
    case "record_correction": {
      const correction = validateCorrection(
        event.correction,
        state.recommendation_hash,
      );
      return nextState(state, { correction }, "correction");
    }
    default:
      return fail("invalid_event", "event_unhandled");
  }
}

/** Apply only browser/user onboarding and bounded correction events. */
export function transitionConsumerInputState(
  state: ConsumerState,
  inputEvent: ConsumerInputEvent,
): ConsumerState {
  assertState(state);
  assertSecurityInput(inputEvent, "event");
  const record = requireRecord(inputEvent, "event");
  if (
    typeof record.type === "string" &&
    HOST_EVENT_TYPES.has(record.type as HostEvaluationEvent["type"])
  )
    fail(
      "phase_event_not_allowed",
      "host_event_requires_trusted_boundary",
      state.phase,
    );
  return transitionConsumerState(state, inputEvent);
}

/** Apply one evaluator result through the explicitly trusted host facade. */
export function applyHostEvaluation(
  state: ConsumerState,
  event: HostEvaluationEvent,
): ConsumerState {
  assertState(state);
  assertSecurityInput(event, "event");
  const record = requireRecord(event, "event");
  if (
    typeof record.type !== "string" ||
    !HOST_EVENT_TYPES.has(record.type as HostEvaluationEvent["type"])
  )
    fail("invalid_event", "host_evaluation_event_required", state.phase);
  return transitionConsumerState(state, event);
}

export const reduceConsumerState = transitionConsumerState;
export const transition = transitionConsumerState;

/** Internal helper for tests and host adapters; it does not persist state. */
export function isConsumerState(value: unknown): value is ConsumerState {
  return (
    isPlainRecord(value) && KNOWN_STATES.has(value) && Object.isFrozen(value)
  );
}
