/**
 * Consumer-facing Japanese labels for implementation facts.
 *
 * The source paraphrase is used only as a stable, non-public catalogue key.
 * It is never returned to the browser.  Keeping this catalogue in the app
 * makes the fixture deterministic while the fallback keeps newly arriving
 * database facts readable without leaking machine predicates or English
 * implementation prose.
 */

const PREDICATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  campaign_jal_bonus_posting: "JAL増量分の付与予定",
  campaign_moppy_rebate_posting: "モッピー還元分の付与予定",
  campaign_principal_exchange: "キャンペーン本体の交換",
  charge_has_no_kyash_reward: "Kyashチャージ還元の対象外",
  converts_at_fixed_ratio: "固定比率での交換",
  funds_at_face_value_with_rolling_cap: "等価入金と期間上限",
  portal_earn_rate_and_posting: "ポータル経由の付与率と時期",
  requires_eligible_ana_card_holder: "対象ANAカード会員の条件",
  requires_existing_holder: "既存会員の保有条件",
  requires_jq_card_saison_and_permanent_point_card: "JQ CARDセゾン等の保有条件",
  requires_aeon_sugoca: "イオンSUGOCAカードの保有条件",
  requires_bic_camera_jq_sugoca: "BIC CAMERA JQ SUGOCAの保有条件",
  requires_jmb_jq_sugoca: "JMB JQ SUGOCAの保有条件",
  requires_jmb_ponta_linkage: "JMBとPontaの会員連携条件",
  requires_jq_sugoca_ana: "JQ SUGOCA ANAの保有条件",
  requires_recruit_and_d_account_linkage: "リクルートIDとdアカウントの連携条件",
  requires_v_point_card_linkage: "Vポイント付与先カードの連携条件",
  requires_revolut_card_payment_to_ana_pay:
    "RevolutカードによるANA Pay決済条件",
  route_is_unavailable: "利用できない経路",
  route_suspended: "停止中の経路",
  awards_points_per_amount: "金額ごとのポイント付与",
  uses_minimum_unit_and_truncates: "単位計算と端数切り捨て",
  has_service_specific_timing_and_card_exclusion:
    "サービス別の付与時期とカード対象外",
  awards_points_per_amount_with_variable_rate: "変動率による金額別ポイント付与",
  has_separately_defined_expiry: "個別に定められた有効期限",
  uses_limited_and_shorter_expiry_first: "限定ポイント・期限順の利用",
  expires_after_last_balance_event: "最後の残高変動からの有効期限",
  depends_on_calculation_category: "計算区分による付与時期",
  may_cancel_awarded_points_and_offset_future_awards:
    "付与後の取消し・将来分との相殺",
  may_grant_standard_or_limited_points: "通常・限定ポイントの付与",
  requires_eligible_sender_and_recipient: "送受信者の適格条件",
  preserves_point_class_and_limited_expiry: "ポイント区分・限定期限の維持",
  allows_pre_receipt_cancel_and_auto_cancels_after_url_expiry:
    "受取前取消しと期限切れ自動取消し",
  is_not_usable_for_investment_route: "投資利用の対象外",
  supports_one_point_units: "1ポイント単位の利用",
  supports_listed_use_routes: "案内された利用先",
  converts_to_yen_at_parity: "円相当での利用",
  awards_points_by_suica_type: "Suica種別ごとの付与",
  awards_points_by_merchant_rate: "店舗別の付与率",
  lists_maximum_bonus_rates: "最大ボーナス率の案内",
  expires_at_individual_deadline: "個別期限での失効",
  expires_at_month_end_after_last_balance_change: "残高変動後の月末期限",
  supports_card_or_barcode_earn_and_point_use:
    "カード・バーコードでの獲得と利用",
  earns_on_point_used_amount: "ポイント利用額への付与",
  supports_registered_suica_earn_but_not_in_store_point_use:
    "登録Suicaでの獲得と店頭利用対象外",
  allows_transfer_under_family_conditions: "家族条件での移行",
  supports_listed_routes: "案内された利用先",
  awards_fixed_points_after_daily_cash_charge:
    "現金チャージ後の固定ポイント付与",
  discounts_eligible_purchases: "対象購入の割引",
  multiplies_point_rate: "ポイント率の倍率",
  awards_percent_of_premium: "保険料に対する率",
  discounts_first_order_with_cap: "初回注文割引と上限",
  awards_lottery_points: "抽選ポイント付与",
  multiplies_lottery_probability: "抽選確率の倍率",
  requires_payment_during_period: "期間中支払い条件",
  requires_minimum_payment: "最低支払条件",
  doubles_normal_points: "通常ポイントの倍率",
  converts_at_parity: "等価交換",
  ends_point_or_mile_service_on_dates: "ポイント・マイルサービス終了日",
  ends_nanaco_point_earning: "nanacoポイント付与終了",
  ends_exchange_service_at: "交換サービス終了時刻",
  awards_example_rates_by_merchant_type: "店舗区分ごとの付与率例",
  awards_tiered_points_per_amount: "区分別の金額ごとの付与",
  awards_points_per_item_amount_with_truncation: "商品別金額と端数処理",
  posts_aggregated_points_next_month: "翌月の合算付与",
  adds_product_specific_bonus_to_base_points: "商品別ボーナスの加算",
  posts_points_on_fixed_monthly_time: "月次固定時刻の付与",
  expires_by_fiscal_grant_cycle: "年度サイクルによる失効",
  uses_previous_year_points_first: "前年ポイントの優先利用",
  determines_rate_scope_and_posting_by_merchant: "店舗別の率・対象・付与日",
  allows_electronic_money_or_gift_use_but_not_cash_conversion:
    "電子マネー・ギフト利用と現金化対象外",
  exchanges_at_fixed_ratio: "固定比率の交換",
  requires_two_factor_phone_setup: "2段階認証用電話番号の条件",
  supports_listed_channels: "案内された利用手段",
  has_no_fee_and_no_cancellation: "手数料なし・取消し不可",
  converts_to_electronic_money_at_parity: "電子マネーへの等価交換",
  lists_campaign_period: "キャンペーン期間の案内",
  "awards_points_for_target-store_payments": "対象店支払いへの付与",
  "requires_identity_verification_and_excludes_point-funded_award":
    "本人確認条件とポイント払い対象外",
  becomes_required_for_third_party_card_payments_after_planned_date:
    "第三者カード支払いの将来必須条件",
  has_method_specific_timing_and_no_cap: "方法別の付与時期と上限なし",
  awards_points_by_payment_method_rate: "支払い方法別の付与率",
  excludes_named_payment_methods_and_transactions: "指定支払い・取引の対象外",
  adds_rate_after_prior_month_thresholds: "前月条件による率加算",
  uses_monthly_count_then_next_period: "月次集計と次期間適用",
  counts_each_200_yen_payment_and_sums_split_methods:
    "¥200単位の回数計上と方法別合算",
  uses_age_tier_thresholds: "年齢区分別の条件",
  awards_only_on_eligible_cofunded_routes: "対象混合払いのみ付与",
  has_normal_and_limited_classes: "通常・限定区分",
  uses_limited_before_normal: "限定ポイントの優先利用",
  cannot_be_sent_to_accounts: "アカウントへの送付不可",
  cannot_be_withdrawn: "現金引き出し不可",
  allows_one_point_minimum_but_excludes_named_combinations:
    "1ポイント利用と指定組合せ対象外",
  supports_store_online_cardbill_and_operation_routes:
    "店頭・オンライン・請求・運用利用",
  cannot_combine_with_points_and_applies_residual_route:
    "ポイント併用不可と残額利用",
  requires_earning_at_multiple_partners: "複数提携先での獲得条件",
  runs_during: "実施期間",
  draws_multiplier_reward: "倍率特典の抽選",
  draws_fixed_reward: "固定ポイントの抽選",
  splits_rate_into_point_classes: "ポイント区分ごとの還元率",
  awards_points_as_percentage_of_amount: "金額に対する割合付与",
  can_be_earned_from: "獲得できる利用先",
  expires_after_no_balance_change: "残高変動がない場合の失効",
  does_not_extend_expiry_on_periodic_kddi_credit:
    "KDDI定期付与による期限延長なし",
  have_campaign_defined_expiry_and_restricted_use:
    "キャンペーン指定期限と利用範囲",
  deducts_in_priority_order: "優先順での減算",
  expires_at_month_end_after_last_earn: "最終獲得後の月末失効",
  expires_one_year_after_last_use: "最終利用から一年後の失効",
  is_listed_as_earn_and_use_partner: "獲得・利用提携先",
  permits_use_within_current_balance_after_registration:
    "登録後の残高内利用・交換",
  may_change_and_are_published_on_pontaweb: "条件変更とPontaWeb掲載",
  is_irreversible_and_may_be_restricted: "取消し不可・利用制限",
  converts_points_to_miles: "ポイントからマイルへの交換",
  has_minimum_unit_and_processing_time: "最低単位と処理期間",
  converts_one_to_one: "等価交換",
  reduces_payment_by_points: "ポイントによる支払額減額",
  depends_on_recruit_and_au_id_linkage: "ID連携による利用条件",
  generally_excludes_coupon_amount: "クーポン額の原則対象外",
  remain_unreduced_by_rule_change: "ルール変更による既存分の減額なし",
  changed_from_tax_included_to_tax_excluded: "税込から税抜への変更",
  extends_expiry_when_earned_within_year: "年内獲得による期限延長",
  posts_planned_and_confirmed_points: "予定・確定ポイントの表示",
  awards_points_at_rate_range: "還元率範囲での付与",
  are_normal_points: "通常ポイント区分",
  disallows_limited_and_partner_received_points_in_most_exchange_routes:
    "限定・提携先受取ポイントの交換対象外",
  cannot_be_used_for_partner_exchange: "提携先交換への利用不可",
  uses_earliest_expiry_first: "期限の早い順の利用",
  can_be_applied_before_expiry_to_later_service_use:
    "期限前利用による後日サービス充当",
  have_individual_expiry_dates: "個別有効期限",
  lists_points_use_services: "ポイント利用サービス一覧",
  may_change_or_end_program_conditions: "条件変更・サービス終了",
  allows_service_and_campaign_specific_conditions_and_reversal:
    "サービス・キャンペーン条件と取消し",
  cannot_be_transferred_between_members_or_converted_to_cash:
    "会員間移行・現金化不可",
  converts_miles_to_points: "マイルからポイントへの交換",
  reduces_third_same_year_exchange_rate: "同年度三回目の交換率引下げ",
  has_processing_time_and_daily_cap: "処理期間と日次上限",
  posts_after_processing_period_without_reverse: "処理後付与・逆戻し不可",
  limits_per_transaction_and_month: "取引・月間上限",
  requires_service_specific_minimum: "サービス別最低利用数",
  subtract_one_point_from_one_yen_of_bill: "請求額から1円・1ポイント相当減額",
  requires_first_app_login_without_entry: "初回アプリログイン・応募不要",
  expire_on_fixed_date: "固定日失効",
  awards_draw_tiered_points: "段階別抽選ポイント",
  started_vpoint_investment_service: "Vポイント投資サービス開始",
  started_vpoint_exchange: "Vポイント交換開始",
  started_vpoint_service: "Vポイントサービス開始",
  awards_points_for_participant_use_or_campaign: "提携先利用・キャンペーン付与",
  expire_at_individual_fixed_deadline_without_extension: "延長なし個別固定期限",
  expire_one_year_after_last_qualifying_movement: "最終適格変動から一年後失効",
  uses_lots_in_fixed_priority: "固定優先順のロット利用",
  restricts_use_to_named_participants_and_fixed_expiry:
    "指定提携先・固定期限の利用制限",
  is_listed_as_vpoint_earn_partner: "Vポイント獲得提携先",
  is_listed_as_vpoint_use_partner: "Vポイント利用提携先",
  requires_valid_authentication_by_channel: "利用先別の認証条件",
  permits_use_and_exchange_with_participant_limits: "提携先別の利用・交換条件",
  changed_processing_time_and_daily_cap: "処理期間・日次上限の変更",
  converts_points_to_miles_with_annual_cap: "年間上限付きポイント・マイル交換",
  converts_points_to_donation_value: "寄付額への交換",
  redeem_at_one_yen_value: "1ポイント1円相当の利用",
  charges_v_points_to_visa_wallet_route: "VポイントからVisaルートへのチャージ",
  limits_eligible_charge_accounts_and_excludes_mixed_balances:
    "対象アカウント制限・残高合算不可",
  uses_standard_waon_point_expiry: "WAON POINT標準期限",
  draws_points_by_charge_unit: "チャージ額単位の抽選",
  aggregates_same_account_charges_into_entries: "同一アカウントのチャージ合算",
  covers_waon_cards_and_aeonpay_charge_routes: "WAON・AEON Payチャージ対象",
  keeps_basic_earning_unit: "基本獲得単位の維持",
  changes_redemption_scope_by_class: "区分別利用範囲の変更",
  switches_issuance_to_waon_point_sequentially: "WAON POINTへの順次付与切替",
  may_delay_posting_after_integration: "統合後の付与遅延可能性",
  awards_waon_points_per_amount: "金額ごとのWAON POINT付与",
  posts_by_payment_channel_schedule: "支払方法別の付与時期",
  expires_at_end_of_second_year_after_first_posting_month:
    "初回付与月から二年後月末失効",
  expire_after_maximum_two_year_structure: "最大二年構造での失効",
  has_seasonal_receipt_deadline: "受取期限の季節区分",
  expire_at_next_fiscal_year_end: "翌年度末失効",
  defines_first_annual_expiry_window: "初回年間有効期間",
  is_listed_as_use_only_network_partner: "利用のみのネットワーク提携先",
  organizes_partners_by_categories_and_services: "提携先の分類・サービス整理",
  is_listed_as_earn_and_use_network_partner: "獲得・利用ネットワーク提携先",
  allows_merchant_earn_and_partner_exchange: "加盟店獲得・提携先交換",
  cannot_be_exchanged_for_cash: "現金交換不可",
  redeems_at_one_yen_value: "1ポイント1円相当の換算",
  converts_bulk_miles_at_promotional_rate: "キャンペーン率での一括マイル交換",
  has_no_exchange_count_cap_and_card_balance_cap:
    "交換回数上限なし・カード残高上限",
  converts_miles_at_normal_rates: "通常率でのマイル交換",
  replaces_old_waon_point_destination_after_integration:
    "統合後の旧WAON POINT移行先変更",
  supports_multiple_use_routes: "複数利用先",
  requires_initial_cash_or_other_charge: "初回現金等チャージ条件",
  converts_one_point_to_one_yen_waon: "1ポイント1円WAON交換",
  must_be_downloaded_before_receipt_deadline: "受取期限前のダウンロード必須",
  earns_points_per_spend: "利用額ごとのポイント付与",
  applies_multiplier: "倍率適用",
  lists_named_skus: "商品名・型番一覧",
  changes_point_class_progressively_from: "指定日からのポイント区分順次変更",
  excludes_payment_categories: "支払区分の対象外",
  has_annual_fee: "年会費",
  earns_autocharge_bonus: "オートチャージ特典",
  earns_mobile_payment_bonus: "携帯料金支払い特典",
  awards_join_points: "入会特典ポイント",
  excludes_wallet_and_prepaid_charges: "ウォレット・プリペイドチャージ対象外",
  requires_entry_and_minimum_spend: "応募と最低利用額の条件",
  changes_reward_class_on_planned_date: "予定日からの特典区分変更",
  redeems_at_value: "記載価値での利用",
  awards_up_to_rate: "最大還元率",
  awards_annual_spend_benefit: "年間利用特典",
  replaces_prior_bonus_with_annual_reward: "旧特典から年間特典への変更",
  excludes_other_wallet_charges: "他ウォレットチャージ対象外",
  postpones_planned_change: "予定変更の延期",
  assigns_special_wallet_rates_or_exclusions: "ウォレット別率・対象外条件",
  earns_targeted_rate: "対象店還元率",
  offers_maximum_reward_value: "最大特典額",
  identifies_named_skus: "指定商品・型番",
  adds_or_changes_excluded_transactions: "対象外取引の追加・変更",
  excludes_wallet_and_e_money_charges: "ウォレット・電子マネーチャージ対象外",
  has_annual_fee_and_annual_spend_benefit: "年会費・年間利用特典",
  earns_jre_points_per_spend: "利用額ごとのJRE POINT付与",
  earns_bic_points_rate: "ビックポイント還元率",
  earns_combined_points_rate: "合算還元率",
  offers_bic_points: "ビックポイント特典",
  lists_named_sku: "指定商品一覧",
  changes_rate_on_future_date: "将来日からの率変更",
  redeems_at_stated_values: "記載価値での交換",
  limits_high_rate_to_named_routes: "高還元率の対象先限定",
  has_annual_fee_waiver: "年会費免除条件",
  awards_balance: "残高特典付与",
  excludes_payment_methods: "支払方法の対象外",
  supports_funding_methods: "入金方法対応",
  caps_reward: "特典上限",
  applies_location_rates: "地域別還元率",
  lists_named_merchants: "指定加盟店一覧",
  supports_payment_routes: "支払方法対応",
  earns_base_points_per_spend: "利用額ごとの基本付与",
  adds_points_with_monthly_cap: "月間上限付きポイント加算",
  awards_tiered_points: "段階別ポイント付与",
  excludes_or_delays_points_for_listed_payments: "指定支払いの対象外・付与遅延",
  supports_charge_methods: "チャージ方法対応",
  varies_by_merchant: "加盟店別の違い",
  has_payment_code_constraints: "支払コードの条件",
  excludes_payment_types: "支払種別の対象外",
  has_charge_limits: "チャージ上限",
  follows_selected_payment_method: "選択した支払方法に従う",
  defines_point_value_and_methods: "ポイント価値・利用方法",
  raises_reward_rate: "還元率の上乗せ",
  awards_randomized_points: "抽選ポイント付与",
  has_charge_constraints: "チャージ条件",
  has_eKYC_dependent_limits: "eKYC依存上限",
  awards_points_to_both_parties: "双方へのポイント付与",
  states_fee_policy: "手数料条件",
  defines_value: "価値の定義",
  requires_monthly_threshold: "月間条件",
  earns_route_specific_points: "利用先別ポイント付与",
  changes_identity_and_threshold_rules: "本人確認・条件の変更",
  restricts_tenders: "支払手段の制限",
  charges_repeat_softbank_mobile_fee: "SoftBank携帯の二回目以降手数料",
  has_method_specific_limits: "方法別上限",
  depends_on_store_setting: "店舗設定による受入条件",
  requires_identity_verification: "本人確認必須",
  earns_route_specific_rates: "利用先別還元率",
  awards_points_on_route_specific_schedule: "利用先別付与時期",
  expires_limited_points: "限定ポイントの失効",
  expires_on_fixed_date: "固定日での失効",
  awards_daily_randomized_rate: "日次抽選還元率",
  excludes_named_merchants: "指定加盟店対象外",
  has_route_specific_limits: "利用先別上限",
  distinguishes_payment_routes: "支払方法の区分",
  merchant_scope: "加盟店範囲",
  lottery: "抽選",
  methods_registration: "利用方法と登録",
  rate_timing: "還元率・付与時期",
  charge_reward: "チャージ特典",
  exchange: "交換条件",
  transition: "切替",
  rate: "還元率",
  standard_rate: "基本還元率",
  classes: "区分",
  fee_caps: "手数料・上限",
  minimum_limit: "最低利用条件",
  excluded_classes: "対象外区分",
  miles_per_spend: "利用額ごとのマイル付与",
  points_per_spend: "利用額ごとのポイント付与",
  hours_fee_minimum: "営業時間・手数料・最低額",
  methods: "利用方法",
  headline_rate: "表示還元率",
  rate_value_expiry: "還元率・価値・有効期限",
  caps_rates: "上限・還元率",
  app_combination: "アプリ併用条件",
  rate_dates: "還元率・日付",
  threshold_reward: "閾値特典",
  methods_cap: "方法・上限",
  visible_periods: "表示期間",
  rates_use: "還元率・利用価値",
  rates_value: "還元率・価値",
  bonus_period: "特典期間",
  thresholds_cap: "条件閾値・上限",
  ended_period: "終了済み期間",
  rate_expiry: "還元率・有効期限",
  rewards: "特典内容",
  rate_value: "還元率・価値",
  multipliers_cap_expiry: "倍率・上限・期限",
  non_earning: "付与対象外",
  rates_rounding_expiry: "還元率・端数・有効期限",
  period_minimum_caps: "期間・最低額・上限",
  rates_qualification: "還元率・適用条件",
  future_bonus: "将来特典",
  credit_bonus: "クレジット特典",
  effective_scope: "適用範囲",
  publication_scope: "公表範囲",
  search_and_dates: "検索・基準日",
  registration: "登録条件",
  latest_revision: "最新改訂",
  revision_definition: "改訂内容",
  output: "交換結果",
  rate_example: "還元率の例",
  linked_card: "連携カード条件",
  scope: "対象範囲",
});

/** Number of known implementation predicates with consumer labels. */
export const IMPLEMENTATION_PREDICATE_LABEL_COUNT =
  Object.keys(PREDICATE_LABELS).length;

const SUBJECT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "BIC CAMERA JQ SUGOCA": "BIC CAMERA JQ SUGOCAカード",
  "JMB JQ SUGOCA": "JMB JQ SUGOCAカード",
  "JQ SUGOCA ANA": "JQ SUGOCA ANAカード",
  "Moppy → JALマイル（20%増量分）": "モッピー → JALマイル（20%増量分）",
  "Moppy JALドリームキャンペーン スカイボーナス":
    "モッピー JALドリームキャンペーン スカイボーナス",
  "Moppy → JALマイル（本体交換）": "モッピー → JALマイル（本体交換）",
  "ANA Pay → 楽天Edy": "ANA Pay → 楽天Edy",
  "ANA Pay → Revolut": "ANA PayからRevolut",
  "JALマイレージパーク → Amazon.co.jp": "JALマイレージパーク → Amazon.co.jp",
  "JALマイレージパーク → 楽天市場": "JALマイレージパーク → 楽天市場",
  "JRキューポ → セゾン永久不滅ポイント": "JRキューポ → セゾン永久不滅ポイント",
  "Kyash → ANA Pay": "KyashからANA Pay",
  ANAカード会員向けVポイント交換コース: "ANAカード会員向けVポイント交換コース",
  "JQ CARDセゾン": "JQ CARDセゾン",
  "みずほマイレージクラブカード/ANA": "みずほマイレージクラブカード/ANA",
  "RevolutカードによるANA Pay決済": "RevolutカードによるANA Pay決済",
  "Revolut → ANA Pay": "RevolutからANA Pay",
  "セゾン永久不滅ポイント → ANAマイル": "セゾン永久不滅ポイント → ANAマイル",
  "Vポイント → ANAマイル（ANAカード会員コース）":
    "Vポイント → ANAマイル（ANAカード会員コース）",
  "Vポイント → JRキューポ": "Vポイント → JRキューポ",
  "JRE POINT family transfer": "JRE POINTの家族間移行",
  "JRE POINT use routes": "JRE POINTの利用先",
  "JRE POINT": "JRE POINTサービス",
  "ONIGO Seven Card Plus JCB payment": "ONIGOのセブンカード・プラスJCB支払い",
  "Seven Mile to nanaco electronic money":
    "セブンマイルからnanaco電子マネーへの交換",
  "App/net shopping nanaco services":
    "アプリ・ネットショッピングのnanacoサービス",
  "Seven-Eleven Saison/UC card payments":
    "セブン‐イレブンのセゾン・UCカード支払い",
  "Seven Card Plus nanaco charge/auto-charge":
    "セブンカード・プラスのnanacoチャージ・オートチャージ",
  "Seven Card Plus credit payment outside Seven-Eleven":
    "セブン‐イレブン以外でのセブンカード・プラス支払い",
  "Seven-Eleven Seven Card Plus credit payment":
    "セブン‐イレブンでのセブンカード・プラス支払い",
  "nanaco net shopping": "nanacoネットショッピング",
  "nanaco immediate-earning shops": "nanaco即時付与店舗",
  "nanaco later-earning shops": "nanaco後日付与店舗",
  "nanaco bonus products": "nanacoボーナス対象商品",
  "nanaco later-earning shop posting": "nanaco後日付与店舗の付与時期",
  "ANA/ANA SKY Coin exchange": "ANA・ANA SKYコイン交換",
  "nanaco point to electronic money exchange":
    "nanacoポイントから電子マネーへの交換",
  "PayPay local point-refund campaign": "PayPay地域ポイント還元キャンペーン",
  "PayPay Step point award": "PayPay Stepポイント付与",
  "PayPay Step base rates": "PayPay Step基本還元率",
  "PayPay Step monthly boost": "PayPay Step月間上乗せ",
  "PayPay Step count and benefit periods": "PayPay Step回数・特典期間",
  "PayPay Step calculation": "PayPay Stepの計算",
  "PayPay U18 Step project": "PayPay U18 Stepプロジェクト",
  "PayPay points used for payment": "支払いに使うPayPayポイント",
  "Recruit limited/site-limited points": "リクルート限定・サイト限定ポイント",
  "Recruit-site point spending": "リクルートサイトポイントの利用",
  "Recruit points": "リクルートポイント",
  "Standard Ponta points": "通常のPontaポイント",
  "Ponta point account": "Pontaポイントアカウント",
  "Ponta program conditions": "Pontaプログラムの条件",
  "Ponta point use/exchange": "Pontaポイントの利用・交換",
  "Recruit points to Ponta points":
    "リクルートポイントからPontaポイントへの交換",
  "Ponta store-use example": "Ponta店舗利用の例",
  "Ponta point service scope": "Pontaポイントのサービス範囲",
  "Rakuten point earning basis": "楽天ポイントの獲得計算基準",
  "Previously earned Rakuten points": "獲得済み楽天ポイント",
  "Normal Rakuten points": "通常の楽天ポイント",
  "Rakuten services": "楽天サービス",
  "Rakuten Ichiba regular purchase": "楽天市場の通常購入",
  "Rakuten Pay app in-store payment": "楽天ペイアプリの店頭支払い",
  "Rakuten Pay mobile Suica charge": "楽天ペイのモバイルSuicaチャージ",
  "Points received from partner exchange": "提携先交換で受け取るポイント",
  "Rakuten point exchange": "楽天ポイント交換",
  "Limited-period Rakuten points": "期間限定楽天ポイント",
  "Multiple limited-period Rakuten points": "複数の期間限定楽天ポイント",
  "Rakuten service directory": "楽天サービス一覧",
  "Rakuten Point program": "楽天ポイントプログラム",
  "Rakuten points": "楽天ポイント",
  "ANA miles to Rakuten points": "ANAマイルから楽天ポイントへの交換",
  "Rakuten points to ANA miles": "楽天ポイントからANAマイルへの交換",
  "Rakuten point use caps": "楽天ポイントの利用上限",
  "Rakuten point use minimums": "楽天ポイントの最低利用数",
  "V Point program": "Vポイントプログラム",
  "V Point partner-rate scenario": "Vポイント提携先還元率の例",
  "Fixed-expiry V points": "有効期限固定のVポイント",
  "Normal V points": "通常のVポイント",
  "V point lots": "Vポイントのロット",
  "Store-limited V points": "店舗限定Vポイント",
  ENEOS: "ENEOSのVポイント",
  "V Point use": "Vポイントの利用",
  "V Point participant program": "Vポイント提携先プログラム",
  "ANA miles to V points": "ANAマイルからVポイントへの交換",
  "V points to ANA miles": "VポイントからANAマイルへの交換",
  "V Point donations": "Vポイントの寄付",
  "V points": "Vポイント",
  "V Point Pay": "VポイントPay",
  "WAON POINT campaign reward": "WAON POINTキャンペーン特典",
  "WAON POINT integration": "WAON POINT統合",
  "WAON POINT versus electronic-money WAON points":
    "WAON POINTと電子マネーWAONポイントの違い",
  "Electronic-money WAON point integration": "電子マネーWAONポイント統合",
  "WAON POINT posting timing": "WAON POINTの付与時期",
  "AEON-mark card payment": "イオンマークカード支払い",
  "WAON POINT posting": "WAON POINTの付与",
  "Green Beans online supermarket": "Green Beansオンラインスーパー",
  "Electronic-money WAON shopping": "電子マネーWAONの買い物",
  "WAON POINT earned by AEON card/debit":
    "イオンカード・デビットで獲得するWAON POINT",
  "WAON POINT rewards": "WAON POINT特典",
  "Campaign or exchanged points awaiting download":
    "ダウンロード待ちのキャンペーン・交換ポイント",
  "WAON POINT annual lots": "WAON POINTの年次ロット",
  "WAON POINT": "WAON POINTサービス",
  "WAON POINT city merchant directory": "WAON POINT加盟店一覧",
  "Green Beans": "Green Beansサービス",
  "WAON POINT service": "WAON POINTサービス",
  "WAON POINT standard use": "WAON POINTの通常利用",
  "JAL miles to WAON campaign": "JALマイルからWAONへのキャンペーン交換",
  "JAL miles to WAON": "JALマイルからWAONへの交換",
  "JAL miles to WAON normal route": "JALマイルからWAONへの通常交換",
  "Partner points to WAON POINT": "提携ポイントからWAON POINTへの交換",
  "WAON point receipt/charge on a first-used WAON card":
    "初回利用WAONカードのポイント受取・チャージ",
  "WAON POINT to WAON": "WAON POINTからWAONへの交換",
  "Campaign/exchanged WAON points": "キャンペーン・交換WAONポイント",
  "AEON Card general credit payment": "イオンカードの一般クレジット支払い",
  "AEON Group target stores": "イオングループ対象店",
  "USMH AEON Pay campaign": "USMH AEON Payキャンペーン",
  "AEON Card catalog": "イオンカードカタログ",
  "AEON CARD Wポイントデー": "AEON CARD Wポイントデー",
  "au PAY Card": "au PAYカード",
  "au PAY Card autocharge": "au PAYカードのオートチャージ",
  "au PAY Gold Card mobile charges": "au PAYゴールドカードの携帯料金チャージ",
  "au PAY Card new-member campaign": "au PAYカード新規入会キャンペーン",
  "au PAY Card issuer products": "au PAYカード発行商品",
  "au PAY Card point accrual": "au PAYカードのポイント獲得",
  "au PAY Card products": "au PAYカード商品",
  "d Card lineup": "dカードのラインアップ",
  "dカード regular": "通常のdカード",
  "d Card payment benefit": "dカードの支払い特典",
  "d Card point accrual": "dカードのポイント獲得",
  "PayPay Card / PayPay Step": "PayPayカード・PayPay Step",
  "PayPay Card issuer products": "PayPayカード発行商品",
  "PayPay Gold annual-use benefit": "PayPayゴールド年間利用特典",
  "PayPayカード ゴールド benefit": "PayPayカード ゴールド特典",
  "PayPay Card products": "PayPayカード商品",
  "Rakuten Card ordinary shopping": "楽天カードの通常の買い物",
  "Rakuten Card named SKUs": "楽天カードの指定商品",
  "Rakuten Pay/card point-condition proposal":
    "楽天ペイ・カードのポイント条件案",
  "Rakuten Card rate table": "楽天カード還元率表",
  "Gold NL current campaign": "Gold NL現在のキャンペーン",
  "SMBC card products in bounded scope": "対象範囲の三井住友カード商品",
  "Gold NL annual-spend aggregation": "Gold NL年間利用額集計",
  "Gold NL annual-spend benefit": "Gold NL年間利用特典",
  "Suica-funded Bic Camera payment": "Suica資金によるビックカメラ支払い",
  "Bic Camera Suica Card usage campaign":
    "ビックカメラSuicaカード利用キャンペーン",
  "View Card partner catalog": "ビューカード提携商品カタログ",
  "Station-building and station-shop JRE POINT rates":
    "駅ビル・駅店舗のJRE POINT還元率",
  "JRE POINT and Bic Point": "JRE POINTとビックポイント",
  "Bic Camera Suica Card Suica charge reward":
    "ビックカメラSuicaカードのSuicaチャージ特典",
  "AEON Pay at AEON Group stores": "イオングループ店舗でのAEON Pay",
  "AEON Pay general use": "AEON Payの通常利用",
  "AEON Pay new-registration reward balance": "AEON Pay新規登録特典残高",
  "AEON Pay new-registration campaign": "AEON Pay新規登録キャンペーン",
  "AEON Group 2x WAON POINT rule": "イオングループWAON POINT2倍ルール",
  "AEON Pay balance": "AEON Pay残高",
  "Kanagawa AEON Pay campaign": "神奈川県AEON Payキャンペーン",
  "AEON Pay merchant acceptance": "AEON Pay加盟店対応",
  "AEON Pay": "AEON Payサービス",
  "au PAY decision benefit": "au PAY基本還元",
  "au Money Activity au PAY extra": "auマネーアクティビティのau PAY上乗せ",
  "au PAY App Store/Google Play campaign":
    "au PAY App Store・Google Playキャンペーン",
  "au PAY Ponta accrual": "au PAYのPonta獲得",
  "au PAY balance": "au PAY残高",
  "au PAY network payment": "au PAYネットワーク支払い",
  "au PAY code payment": "au PAYコード支払い",
  "FamiPay ordinary payment": "FamiPay通常支払い",
  "FamiPay next-month pay": "FamiPay翌月払い",
  "FamiPay payment game": "FamiPay支払いゲーム",
  "FamiPay to mobile Suica charge": "FamiPayからモバイルSuicaへのチャージ",
  "FamiPay balance": "FamiPay残高",
  "FamilyMart app friend-referral campaign":
    "ファミリーマートアプリ友だち紹介キャンペーン",
  "FamiPay payment/charge": "FamiPay支払い・チャージ",
  "PayPay Step condition bonus": "PayPay Step条件特典",
  "PayPay Step basic rates": "PayPay Step基本還元率",
  "PayPay Step": "PayPay Stepサービス",
  "PayPay money-only stores": "PayPayマネーのみ対応店舗",
  "PayPay balance charge": "PayPay残高チャージ",
  "PayPay tender acceptance": "PayPay支払手段の対応",
  "Rakuten Pay point program": "楽天ペイポイントプログラム",
  "Rakuten Pay scratch limited points": "楽天ペイくじ期間限定ポイント",
  "Rakuten Pay daily scratch": "楽天ペイ毎日くじ",
  "Rakuten Pay point conditions": "楽天ペイポイント条件",
  "Rakuten Pay maximum-rate program": "楽天ペイ最大還元プログラム",
  "Rakuten Pay balance charge": "楽天ペイ残高チャージ",
  "Rakuten Pay balance": "楽天ペイ残高",
  "Rakuten Pay payment routes": "楽天ペイ支払い方法",
  nanaco: "nanacoサービス",
  "nanaco summer festival": "nanaco夏祭り",
  "Seven Card Plus/Gold": "セブンカード・プラス／ゴールド",
  "nanaco points": "nanacoポイント",
  "WAON August campaign": "WAON八月キャンペーン",
  "WAON autocharge": "WAONオートチャージ",
  WAON: "WAONサービス",
  "WAON credit charge": "WAONクレジットチャージ",
  "WAON card": "WAONカード",
  "7NOW Pocka Sapporo": "7NOWポッカサッポロ",
  "7NOW": "7NOWサービス",
  "Seven-Eleven ANA card": "セブン‐イレブンANAカード",
  "Seven-Eleven Saison/UC card": "セブン‐イレブンセゾン・UCカード",
  "AEON points": "イオンポイント",
  "AEON target group stores": "イオン対象グループ店舗",
  "Amazon Pay": "Amazon Payサービス",
  "Amazon Pay first use": "Amazon Pay初回利用",
  "Bic Camera.com": "ビックカメラ.com",
  "Bic Point": "ビックポイント",
  FamilyMart: "ファミリーマート",
  "FamiPay August games": "FamiPay八月ゲーム",
  FamiPay: "FamiPayサービス",
  "Ito-Yokado specialty nanaco": "イトーヨーカドー専門店nanaco",
  "Ito-Yokado nanaco charge": "イトーヨーカドーnanacoチャージ",
  Lawson: "ローソン",
  "Lawson sale directory": "ローソンセール一覧",
  "Lawson Ponta/d point": "ローソンPonta・dポイント",
  "d-point transfer": "dポイント移行",
  "Matsukiyo stage": "マツキヨステージ",
  "McDonald's Japan": "マクドナルド日本",
  "Rewards raffle": "特典抽選",
  "My McDonald's Rewards": "My McDonald's Rewards特典",
  "NewDays self-checkout": "NewDaysセルフレジ",
  "JRE POINT scratch": "JRE POINTくじ",
  "JRE POINT at NewDays": "NewDaysでのJRE POINT",
  "Rakuten Ichiba": "楽天市場",
  "Rakuten 18th-day": "楽天市場18日",
  "Starbucks Stars": "スターバックスStars",
  "Welcia summer bonus": "ウエルシア夏ボーナス",
  "Welcia online points": "ウエルシアオンラインポイント",
  "Yahoo PayPay Step": "Yahoo PayPay Stepサービス",
  "Gold Point Card Plus": "ゴールドポイントカード・プラス",
  "Stealth marketing": "ステルスマーケティング",
  "CAA legal-measure statistics": "消費者庁法的措置統計",
  "FSA provider directory": "金融庁事業者一覧",
  "Electronic payment instrument/intermediary business":
    "電子決済手段・仲介業務",
  "PPC guidelines": "個人情報保護委員会ガイドライン",
  "PPC General Rules Guidelines":
    "個人情報保護委員会個人情報保護法ガイドライン",
  "JRE POINT to Suica": "JRE POINTからSuicaへの交換",
  "Suica campaigns": "Suicaキャンペーン",
  "Suica autocharge": "Suicaオートチャージ",
  "JRE POINT with Suica": "Suica利用時のJRE POINT",
  "Mobile Suica autocharge": "モバイルSuicaオートチャージ",
  "Suica/JRE POINT": "Suica・JRE POINTサービス",
  "対象ドコモ料金 with dカード tiers": "対象ドコモ料金とdカード区分",
  "Pontaポイント with KDDI定期付与": "PontaポイントとKDDI定期付与",
  "Pontaポイント to JAL Mileage Bank":
    "PontaポイントからJALマイレージバンクへの交換",
  "ビューカード / VIEWプラス routes": "ビューカード・VIEWプラスの利用先",
  "dポイント member transfer": "dポイントの会員間移行",
  "dポイント URL transfer": "dポイントのリンク移行",
  "nanaco夏祭り qualifying payment": "nanaco夏祭りの対象支払い",
  "nanacoポイント to ANA miles": "nanacoポイントからANAマイルへの交換",
  "nanacoポイント to ANA SKY コイン": "nanacoポイントからANA SKYコインへの交換",
  "nanacoポイント use channels": "nanacoポイントの利用方法",
  "千葉市第2弾・千葉県第3弾 local campaigns":
    "千葉市第2弾・千葉県第3弾の地域キャンペーン",
  "岩手県第3弾 local campaign": "岩手県第3弾の地域キャンペーン",
  "湯沢市 local campaign": "湯沢市の地域キャンペーン",
  "PayPayポイント use routes": "PayPayポイントの利用先",
  "PayPayポイント payment": "PayPayポイント支払い",
  "Vポイントアプリ新規ダウンロードキャンペーン rewards":
    "Vポイントアプリ新規ダウンロードキャンペーン特典",
  "カジュゲータウン for Yahoo! JAPAN": "カジュゲータウンのYahoo! JAPAN交換",
  "AEON Pay・WAONチャージキャンペーン": "AEON Pay・WAONチャージキャンペーン",
  "ビックカメラSuicaカード ordinary credit payment":
    "ビックカメラSuicaカードの通常クレジット支払い",
  "d払い with d Card": "dカードを使ったd払い",
  "d払い balance/telecom payment": "d払い残高・電話料金合算払い",
  "d払い残高 ATM charge": "d払い残高のATMチャージ",
  "d払い残高 bank charge": "d払い残高の銀行チャージ",
});

const SUMMARY_TRANSLATION_ENTRIES = [
  [
    "Eligible mobile and hikari fees earn 10 points per ¥1,000 before tax.",
    "対象の携帯電話回線・ドコモ光の料金は、税抜¥1,000ごとに10ポイント貯まります。",
  ],
  [
    "The page lists 50/100/200 points per pre-tax ¥1,000 for the three named d-card tiers.",
    "ページには、記載された三つのdカード区分について、税抜¥1,000ごとに50/100/200ポイントとあります。",
  ],
  [
    "Terms use a ¥1,000 minimum unit and discard any remainder below ¥1,000.",
    "規約では¥1,000単位で計算し、¥1,000未満の端数は切り捨てます。",
  ],
  [
    "d-card service calculations use a ¥100 minimum unit and discard amounts below it.",
    "dカードのサービス計算は¥100単位で、これ未満の金額は切り捨てます。",
  ],
  [
    "Electricity and gas calculations use a ¥100 minimum unit and truncate lower remainders.",
    "電気・ガスの計算は¥100単位で、下回る端数は切り捨てます。",
  ],
  [
    "Mobile/hikari awards start after next-month day 10; merchant timing varies and non-d-card d払い credit is excluded.",
    "携帯電話・光の進呈は翌月10日以降に始まり、お店ごとに時期が異なります。dカード以外のd払いのクレジット利用は対象外です。",
  ],
  [
    "Utility fees accrue points per pre-tax ¥100, with the point rate varying by electricity area/plan and fractions truncated.",
    "公共料金は税抜¥100ごとにポイントが貯まりますが、電気の地域・プランで率が異なり、端数は切り捨てます。",
  ],
  [
    "Limited-purpose d points follow a separately specified validity period.",
    "期間・用途限定dポイントには、別途定められた有効期間が適用されます。",
  ],
  [
    "At use, limited-use points and then points expiring sooner are consumed first.",
    "利用時は、期間・用途限定ポイントを先に使い、その後は有効期限の早いポイントから使います。",
  ],
  [
    "Standard points expire one year after the latest award, use, transfer, or receipt event.",
    "通常ポイントは、最後の進呈・利用・移行・受け取りのいずれかから一年後に失効します。",
  ],
  [
    "Terms distinguish next-month, separately specified, and second-next-month day-10 award timing by calculation category.",
    "規約では、計算区分により翌月、別途指定、または翌々月の10日など進呈時期が異なります。",
  ],
  [
    "Terms allow proportional point cancellation after refunds/cancellations and offsetting against future points.",
    "規約では、返品・取消し後のポイントの比例取消しと、今後のポイントとの相殺を認めています。",
  ],
  [
    "The terms allow standard or limited-purpose points from service calculations, measures, or partner exchanges.",
    "規約では、サービス計算・施策・提携先との交換により、通常ポイントまたは期間・用途限定ポイントが付く場合があります。",
  ],
  [
    "Transfer requires a line holder or identity-verified member and disallows same-member or refused-recipient transfers.",
    "移行には回線契約者または本人確認済み会員が必要で、同一会員間や受取拒否先への移行はできません。",
  ],
  [
    "Transfers preserve point class and limited expiry; limited points expiring sooner transfer first by default.",
    "移行後もポイント区分と限定ポイントの期限は保たれ、通常は期限の早い限定ポイントから移行されます。",
  ],
  [
    "Only URL transfers can be cancelled before receipt; unclaimed links auto-cancel when their validity ends.",
    "受け取り前に取り消せるのはリンクによる移行だけで、未受取リンクは有効期限が切れると自動取消しになります。",
  ],
  [
    "The use guide marks limited-purpose points as unavailable for the investment route.",
    "利用ガイドでは、期間・用途限定ポイントは投資には使えないと案内しています。",
  ],
  [
    "d points can be applied in one-point units unless a separate rule says otherwise.",
    "dポイントは、別の定めがない限り一ポイント単位で使えます。",
  ],
  [
    "The guide and terms list street, online, DOCOMO service, mobile, hikari, electricity, and gas uses with route-specific restrictions.",
    "ガイドと規約には、街のお店・オンライン・ドコモサービス・携帯電話・光・電気・ガスでの利用と、利用先ごとの制限が記載されています。",
  ],
  [
    "One d point is usable as one Japanese yen.",
    "dポイント一ポイントは、日本円一円分として使えます。",
  ],
  [
    "A registered mobile Suica commuter-pass purchase earns one point per ¥50.",
    "登録したモバイルSuicaの定期券購入では、¥50ごとに一ポイント貯まります。",
  ],
  [
    "JR East rail use earns one point per ¥50 on mobile Suica or ¥200 on card Suica.",
    "JR東日本の鉄道利用では、モバイルSuicaは¥50ごと、カード型Suicaは¥200ごとに一ポイント貯まります。",
  ],
  [
    "Participating Suica shops award one point per tax-included ¥100 or ¥200, depending on the store.",
    "対象のSuica加盟店では、お店により税込¥100または¥200ごとに一ポイントが進呈されます。",
  ],
  [
    "JRE’s overview lists maximum combined rates up to 10%, 6%, 1.5%, and 3.5% for named View-card routes.",
    "JREの案内には、記載されたビューカードの利用先について、合算で最大10%、6%、1.5%、3.5%の率が示されています。",
  ],
  [
    "Limited-time JRE points expire on their individually specified dates.",
    "期間限定JRE POINTは、それぞれに定められた日付で失効します。",
  ],
  [
    "Standard JRE POINT lasts until the month-end two years after the last earn/use and extends when balance changes.",
    "通常のJRE POINTは、最後に貯めた・使った時点から二年後の月末まで有効で、残高が変わると期限が延長されます。",
  ],
  [
    "Green-marker stores accept card/barcode earning and point redemption.",
    "緑色マークのお店では、カード・バーコードでのポイント獲得とポイント利用に対応しています。",
  ],
  [
    "At green-marker stores, the amount paid with points also receives points.",
    "緑色マークのお店では、ポイントで支払った金額にもポイントが付きます。",
  ],
  [
    "Yellow-marker stores earn through registered Suica but do not accept in-store point redemption or card/barcode earning.",
    "黄色マークのお店では、登録Suicaで貯められますが、店頭でのポイント利用やカード・バーコードでの獲得には対応していません。",
  ],
  [
    "Family transfer requires a View Card owner or an invite matching address and surname; limited points cannot transfer.",
    "家族間移行にはビューカード会員、または住所と姓が一致する招待が必要で、期間限定ポイントは移行できません。",
  ],
  [
    "JRE lists station shops, Suica charge, green tickets, products, Eki-net, JRE MALL, and acure as use routes.",
    "JREは、駅の店舗・Suicaチャージ・緑の券売機・商品・えきねっと・JRE MALL・acureを利用先として案内しています。",
  ],
  [
    "One JRE POINT is usable as one yen for listed store payment and Suica charge.",
    "一JRE POINTは、案内された店舗での支払いとSuicaチャージで一円分として使えます。",
  ],
  [
    "On qualifying 8-days, daily cash charging of at least ¥20,000 awards 100 nanaco points.",
    "対象となる8の日には、現金で一日合計¥20,000以上チャージするとnanacoポイント100ポイントが進呈されます。",
  ],
  [
    "On the 8th, 18th, and 28th, qualifying Ito-Yokado purchases receive 5% off.",
    "8日・18日・28日は、対象のイトーヨーカドーの買い物が5%割引になります。",
  ],
  [
    "On the same dates, participating specialist stores award four rather than one point per tax-included ¥200.",
    "同じ日には、対象の専門店で税込¥200ごとに一ポイントではなく四ポイントが進呈されます。",
  ],
  [
    "The listed automobile/motorcycle insurance page advertises nanaco points equal to 2% of premium.",
    "記載された自動車・バイク保険の案内では、保険料の2%相当のnanacoポイントが案内されています。",
  ],
  [
    "The first ONIGO order receives 30% off, capped at ¥2,500.",
    "ONIGOの初回注文は30%割引で、割引上限は¥2,500です。",
  ],
  [
    "The campaign awards two nanaco points per tax-included ¥200 to eligible Seven Card Plus JCB members.",
    "キャンペーンでは、対象のセブンカード・プラスJCB会員に税込¥200ごとに二ポイントが進呈されます。",
  ],
  [
    "The summer campaign draws 10,000 winners for 775 nanaco points each.",
    "夏のキャンペーンでは、当選者10,000人にnanacoポイント775ポイントが進呈されます。",
  ],
  [
    "Newly issued mobile nanaco has three times the lottery-winning probability.",
    "新規発行のモバイルnanacoは、抽選当選確率が三倍になります。",
  ],
  [
    "Entry is unnecessary; one in-store mobile-nanaco payment of at least tax-included ¥500 qualifies during the listed dates.",
    "応募は不要で、記載された期間中に店頭で税込¥500以上をモバイルnanacoで一回支払うと対象になります。",
  ],
  [
    "The campaign requires an in-store mobile-nanaco payment of at least tax-included ¥500 and no entry.",
    "キャンペーンは、店頭で税込¥500以上をモバイルnanacoで支払うことが条件で、応募は不要です。",
  ],
  [
    "The current campaign card says eligible target-store nanaco payments receive twice the normal points without entry.",
    "現在のキャンペーン案内では、対象店でのnanaco支払いに通常の二倍のポイントが進呈され、応募は不要とされています。",
  ],
  [
    "The campaign card says ten Seven Miles can exchange for ¥10 of nanaco electronic money.",
    "キャンペーン案内では、セブンマイル十マイルをnanaco電子マネー¥10分に交換できます。",
  ],
  [
    "The notice ends named app/online point and Seven Mile services on the listed dates while Denny's store nanaco earning continues.",
    "お知らせでは、記載されたアプリ・オンラインポイントとセブンマイルのサービスが指定日に終了する一方、デニーズ店頭のnanaco獲得は続くとしています。",
  ],
  [
    "Nanaco points for the named Seven-Eleven card-payment service ended with payments through 2026-08-10.",
    "記載されたセブン‐イレブンのカード決済サービスのnanacoポイントは、2026-08-10の支払い分までで終了しました。",
  ],
  [
    "The notice ended both named exchange services at 23:59 on 2026-03-31.",
    "お知らせでは、両方の交換サービスが2026-03-31の23:59に終了したとしています。",
  ],
  [
    "Seven Card Plus earns one nanaco point per tax-included ¥200 of eligible charge or auto-charge.",
    "セブンカード・プラスは、対象のチャージまたはオートチャージで税込¥200ごとに一nanacoポイントが貯まります。",
  ],
  [
    "The page gives example rates of two points per ¥200 at listed partner shops and one at JCB/Visa merchants.",
    "ページには、記載された提携店では¥200ごとに二ポイント、JCB・Visa加盟店では一ポイントという例が示されています。",
  ],
  [
    "The official example lists 6, 16, or 19 points per tax-included ¥200 by cardholder status.",
    "公式例では、会員区分により税込¥200ごとに6、16、または19ポイントとされています。",
  ],
  [
    "Net shopping earns one point per pre-tax ¥200 per item; fractions below one point are discarded.",
    "ネットショッピングは商品ごとに税抜¥200で一ポイント貯まり、一ポイント未満の端数は切り捨てられます。",
  ],
  [
    "Immediate-earning stores generally award one point per pre-tax ¥200, subject to listed store exceptions.",
    "即時獲得の店舗では通常、税抜¥200ごとに一ポイントが進呈されますが、記載された店舗は例外です。",
  ],
  [
    "Later-earning shops aggregate the month and make points receivable the following month.",
    "後日獲得の店舗では一か月分を合算し、翌月にポイントを受け取れるようになります。",
  ],
  [
    "Eligible products add a product-specific bonus to the normal pre-tax ¥200 point, only when paid fully with nanaco.",
    "対象商品は、nanacoで全額支払った場合に限り、通常の税抜¥200分のポイントへ商品別ボーナスが加算されます。",
  ],
  [
    "Later-earning points are added on the 10th at 06:00 the following month and received after a balance check or charge.",
    "後日獲得のポイントは翌月10日の06:00に加算され、残高確認またはチャージの後に受け取れます。",
  ],
  [
    "Points granted from April through the next March expire at the end of the following-following March.",
    "四月から翌年三月までに進呈されたポイントは、その翌々年三月末に失効します。",
  ],
  [
    "The balance page says points granted in the prior year are consumed first.",
    "残高ページでは、前年に進呈されたポイントから先に使うと案内しています。",
  ],
  [
    "The special terms defer award rate, eligible goods/services, and posting date to each point merchant.",
    "特約では、進呈率・対象商品やサービス・進呈日を各ポイント加盟店の定めに委ねています。",
  ],
  [
    "Points may be exchanged or used in listed routes but cannot be cashed out and exchanges cannot be cancelled.",
    "ポイントは記載された利用先で交換・利用できますが、現金化できず、交換の取消しもできません。",
  ],
  [
    "ANA exchange is 500 nanaco points to 250 miles in 500-point increments, currently taking about 2–7 days.",
    "ANA交換はnanacoポイント500ポイントを250マイルに、500ポイント単位で交換し、現在は約2–7日かかります。",
  ],
  [
    "The partner exchange requires a preconfigured two-factor-authentication phone number.",
    "提携先との交換には、あらかじめ設定した二段階認証用の電話番号が必要です。",
  ],
  [
    "ANA SKY Coin exchange is 500 nanaco points to 500 coins in 500-point increments, about two days.",
    "ANA SKYコイン交換はnanacoポイント500ポイントを500コインに、500ポイント単位で交換し、約二日かかります。",
  ],
  [
    "The use guide lists electronic money, net shopping, ANA routes, and other displayed services.",
    "利用ガイドには、電子マネー・ネットショッピング・ANAの利用先など、表示されたサービスが記載されています。",
  ],
  [
    "Electronic-money exchange has no fee, but a completed exchange cannot be cancelled.",
    "電子マネー交換に手数料はありませんが、完了した交換は取り消せません。",
  ],
  [
    "One nanaco point exchanges for one yen of nanaco electronic money.",
    "nanacoポイント一ポイントは、nanaco電子マネー一円分に交換できます。",
  ],
  [
    "The directory lists both Chiba campaigns for 2026-08-07 through 2026-08-30.",
    "一覧には、千葉県の各キャンペーンの期間が2026-08-07から2026-08-30までと記載されています。",
  ],
  [
    "The directory lists Iwate campaign 3 for 2026-08-17 through 2026-08-25.",
    "一覧には、岩手キャンペーン3の期間が2026-08-17から2026-08-25までと記載されています。",
  ],
  [
    "The directory says target-store PayPay payments earn points; each municipality page supplies the conditions.",
    "一覧では対象店でのPayPay支払いでポイントが貯まるとし、条件は自治体ごとのページに記載されています。",
  ],
  [
    "The directory lists Yuzawa campaign dates as 2026-07-01 through 2026-09-30.",
    "一覧には、湯沢キャンペーンの期間が2026-07-01から2026-09-30までと記載されています。",
  ],
  [
    "From 2026-06-02, Step requires completed identity verification; point-funded payments do not earn Step points.",
    "2026-06-02以降、Stepには本人確認の完了が必要で、ポイント払いではStepポイントが貯まりません。",
  ],
  [
    "The help page plans mandatory third-party-card vouchers after August 2026 for those card payments.",
    "ヘルプページでは、2026年八月以降、第三者カードの支払いに専用バウチャーを必須にする予定としています。",
  ],
  [
    "Step awards are generally within 30 days by method and have no award cap since January 2023.",
    "Stepの進呈は方法により通常30日以内で、2023年一月以降は進呈上限がありません。",
  ],
  [
    "The Step page lists 0.5% or 1% base rates by payment method, calculated per tax-included ¥200.",
    "Stepページには、支払い方法ごとの基本還元率が0.5%または1%で、税込¥200単位で計算すると記載されています。",
  ],
  [
    "Step awards are limited to balance/credit routes and exclude the listed points, voucher, utility, investment, and bill-payment cases.",
    "Stepの進呈は残高・クレジット利用に限られ、記載されたポイント・バウチャー・公共料金・投資・請求書払いは対象外です。",
  ],
  [
    "Thirty payments of at least ¥200 and ¥100,000 total in the prior month add 0.5 percentage points.",
    "前月に¥200以上の支払いを三十回、合計¥100,000以上行うと、還元率に0.5パーセントポイントが加算されます。",
  ],
  [
    "The prior calendar month is counted; the resulting rate applies from the next month’s day 2 through the following month’s day 1.",
    "前暦月の実績を数え、算出された率は翌月2日から翌々月1日まで適用されます。",
  ],
  [
    "Each ¥200-or-more payment counts once; split methods are calculated separately per ¥200 and then summed.",
    "¥200以上の支払いは一回として数え、支払い方法を分けた場合は¥200単位で別々に計算して合算します。",
  ],
  [
    "The U18 project lowers thresholds to 10/¥3,000 for ages 12–15 and 20/¥8,000 for ages 16–18.",
    "U18プロジェクトでは、12–15歳は10/¥3,000、16–18歳は20/¥8,000に条件が引き下げられます。",
  ],
  [
    "Voucher-only payments may earn coupon/stamp points but not Step or local-campaign points; mixed payments credit only balance/credit portions.",
    "バウチャーのみの支払いではクーポン・スタンプポイントが貯まる場合がありますが、Stepや地域キャンペーンのポイントは貯まりません。混合払いでは残高・クレジット分だけが加算対象です。",
  ],
  [
    "PayPay distinguishes normal points without expiry from limited points with an expiry and narrower service scope.",
    "PayPayでは、期限がなく利用範囲が広い通常ポイントと、期限があり利用範囲が狭い限定ポイントを区別しています。",
  ],
  [
    "When available for payment, limited points are used before normal points.",
    "支払いに使える場合は、限定ポイントを通常ポイントより先に使います。",
  ],
  [
    "PayPay points cannot be sent to other accounts, family, or friends.",
    "PayPayポイントは、他のアカウント・家族・友人には送れません。",
  ],
  [
    "PayPay points cannot be withdrawn as cash.",
    "PayPayポイントは現金として引き出せません。",
  ],
  [
    "Payments can specify from one point and combine with balance/credit, but not credit cards, third-party vouchers, or PayPay gift vouchers.",
    "支払いは一ポイントから指定でき、残高・クレジットと組み合わせられますが、クレジットカード・第三者バウチャー・PayPay商品券とは組み合わせられません。",
  ],
  [
    "The guide lists in-store, online, monthly card-bill, and point-operation uses.",
    "ガイドには、店頭・オンライン・カード請求時・ポイント運用での利用が記載されています。",
  ],
  [
    "One PayPay point is usable as one yen equivalent.",
    "PayPayポイント一ポイントは、一円相当として使えます。",
  ],
  [
    "Voucher purchases are in ¥10,000 units with ¥250,000 monthly and ¥1,000,000 balance caps; residuals use balance/credit, not points.",
    "バウチャー購入は¥10,000単位で、月間上限¥250,000、残高上限¥1,000,000があります。残額はポイントではなく残高・クレジットを使います。",
  ],
  [
    "Earn at least 1 point from at least two eligible partner services during the campaign to enter the draw.",
    "キャンペーン期間中に、対象の提携サービス二つ以上から少なくとも1ポイントずつ獲得すると抽選に参加できます。",
  ],
  [
    "The campaign runs from July 1 through August 31, 2026.",
    "キャンペーンは2026年七月1日から八月31日まで実施されます。",
  ],
  [
    "Three or more eligible partners gives a draw for 100x, with 200 winners and a 2,000-point per-person cap.",
    "対象の提携先が三つ以上なら100倍特典の抽選に参加でき、当選者は200人、一人あたりの上限は2,000ポイントです。",
  ],
  [
    "Two eligible partners gives a draw for 10x, with 1,000 winners and a 500-point per-person cap.",
    "対象の提携先が二つなら10倍特典の抽選に参加でき、当選者は1,000人、一人あたりの上限は500ポイントです。",
  ],
  [
    "The third tier awards 1 Ponta point to 998,800 entrants outside the higher tiers.",
    "第三段階では、上位段階に該当しない参加者998,800人に1 Pontaポイントが進呈されます。",
  ],
  [
    "The displayed lodging example splits 2% into 1% Ponta and 1% Jalan-limited points.",
    "表示された宿泊例では、2%をPontaポイント1%とじゃらん限定ポイント1%に分けて付与します。",
  ],
  [
    "The official example says eligible lodging reservations earn points equal to 2% of the reservation amount.",
    "公式例では、対象の宿泊予約金額の2%相当のポイントが貯まるとしています。",
  ],
  [
    "The overview identifies partner stores, online services, campaigns, games, surveys, and exchanges as earn routes.",
    "概要では、提携店・オンラインサービス・キャンペーン・ゲーム・アンケート・交換が獲得方法として案内されています。",
  ],
  [
    "The terms state all points expire when the balance has not changed for one year after the later of earning or use/exchange.",
    "規約では、獲得または利用・交換のうち後の時点から一年間残高が変わらないと、すべてのポイントが失効します。",
  ],
  [
    "A KDDI periodic credit does not extend the holding expiry; the prior non-periodic earn/use remains the anchor.",
    "KDDIの定期付与では保有期限は延長されず、それ以前の通常の獲得・利用時点が基準として残ります。",
  ],
  [
    "Recruit and site-limited points have campaign-defined expiry/use scopes and cannot be exchanged into Ponta points.",
    "リクルート限定・サイト限定ポイントにはキャンペーンで定めた期限と利用範囲があり、Pontaポイントには交換できません。",
  ],
  [
    "Limited points are consumed before Ponta points, with earlier expiry first and a stated same-date tie-break.",
    "限定ポイントをPontaポイントより先に使い、有効期限の早い順、同日なら定められた順で消費します。",
  ],
  [
    "Recruit points expire at the end of the month 12 months after the last earn.",
    "リクルートポイントは、最後に獲得した月から12か月後の月末に失効します。",
  ],
  [
    "Standard Ponta points expire one year after the last qualifying earn or use.",
    "通常のPontaポイントは、最後に対象となる獲得または利用をした一年後に失効します。",
  ],
  [
    "The rendered partner directory lists JAL Mileage Bank as an earn/use partner.",
    "表示された提携先一覧では、日本航空のマイレージバンクが獲得・利用提携先として掲載されています。",
  ],
  [
    "The rendered directory lists Jalan net as both earn and use, with Recruit ID indicated.",
    "表示された一覧では、じゃらんnetが獲得・利用の両方に対応し、リクルートIDが必要と示されています。",
  ],
  [
    "The rendered directory lists Lawson as earn/use and app-supported.",
    "表示された一覧では、ローソンが獲得・利用に対応し、アプリにも対応すると掲載されています。",
  ],
  [
    "The terms allow exchange or payment use within the current balance after required member registration.",
    "規約では、必要な会員登録後、現在の残高の範囲で交換または支払いに使えるとしています。",
  ],
  [
    "The terms permit changes without prior notice and direct members to PontaWeb for changed conditions.",
    "規約では事前の告知なく条件を変更でき、変更後の条件はPontaWebで確認するよう案内しています。",
  ],
  [
    "After use or exchange, cancellation/refund is not accepted, and some products or services cannot use points.",
    "利用・交換後の取消しや返金は受け付けず、一部の商品・サービスではポイントを使えません。",
  ],
  [
    "One Ponta point converts to 0.5 JAL miles.",
    "Pontaポイント一ポイントはJALマイル0.5マイルに交換できます。",
  ],
  [
    "The transfer starts at 2 points in 2-point units and is stated to take one week.",
    "移行は2ポイントから2ポイント単位で行い、所要期間は一週間と案内されています。",
  ],
  [
    "The visible Recruit-point row shows a 1-to-1 conversion into Ponta points.",
    "表示されたリクルートポイントの行では、Pontaポイントへ1対1で交換すると示されています。",
  ],
  [
    "The overview's worked example applies 500 Ponta points as a 500-yen discount.",
    "概要の計算例では、Pontaポイント500ポイントを500円の割引として使っています。",
  ],
  [
    "Where points can be earned or spent depends on whether Recruit ID and au ID are linked.",
    "ポイントを貯めたり使ったりできる場所は、リクルートIDとau IDを連携しているかどうかで異なります。",
  ],
  [
    "The notice says coupon-used amounts are generally excluded from the earning basis.",
    "お知らせでは、クーポンを使った金額は原則として獲得計算の対象外としています。",
  ],
  [
    "The notice says previously earned points are not reduced by the rule change.",
    "お知らせでは、すでに獲得したポイントはルール変更によって減りません。",
  ],
  [
    "From April 1, 2022, the listed services changed their earning basis from tax-included to tax-excluded amounts.",
    "2022年四月1日から、記載されたサービスの獲得計算は税込金額から税抜金額に変わりました。",
  ],
  [
    "Normal points expire after a one-year window including the last-earn month, and another normal earn extends the window.",
    "通常ポイントは最後に獲得した月を含む一年間の期間後に失効し、通常ポイントをさらに獲得すると期間が延長されます。",
  ],
  [
    "The general rule is one point per 100 yen before tax, subject to service-specific rules.",
    "基本ルールは税抜100円ごとに一ポイントですが、サービスごとの定めが優先されます。",
  ],
  [
    "Regular Ichiba purchases earn 1%: one point per 100 yen before tax per product.",
    "通常の楽天市場の買い物は1%で、商品ごとに税抜100円につき一ポイントが貯まります。",
  ],
  [
    "Ichiba displays planned points the next day and confirms them 20 days after the order in the displayed example.",
    "楽天市場では翌日に予定ポイントを表示し、表示例では注文から20日後に確定します。",
  ],
  [
    "The app page states 1%–1.5% returns for eligible in-store payments.",
    "アプリのページでは、対象の店頭支払いの還元率を1%–1.5%と案内しています。",
  ],
  [
    "Suica charging through the app earns one point per 200 yen.",
    "アプリ経由のSuicaチャージでは200円ごとに一ポイントが貯まります。",
  ],
  [
    "The exchange page states points received from partner services are normal points.",
    "交換ページでは、提携サービスから受け取ったポイントは通常ポイントとしています。",
  ],
  [
    "Limited points and partner-received points generally cannot be exchanged onward, except for the stated Keiba charge route.",
    "限定ポイントと提携先から受け取ったポイントは原則として再交換できませんが、記載された競馬チャージの方法は例外です。",
  ],
  [
    "Limited-period points cannot be exchanged to partners, most Rakuten service points, or Edy.",
    "期間限定ポイントは提携先や多くの楽天サービスのポイント、Edyへ交換できません。",
  ],
  [
    "When several limited-point lots are held, the lot expiring soonest is used first.",
    "複数の期間限定ポイントを持っている場合は、最も早く失効する分から使います。",
  ],
  [
    "A booking/order made before the point expiry can cover a later service or delivery date.",
    "ポイントの有効期限前に予約・注文すれば、後日の利用日や配送日に充当できます。",
  ],
  [
    "Limited-period points receive individual deadlines such as 15 days or month-end and become unusable after expiry.",
    "期間限定ポイントには15日後や月末など個別の期限が設定され、期限後は使えません。",
  ],
  [
    "The visible directory lists Rakuten shopping, travel, payment, banking, and investment services as use destinations.",
    "表示された一覧では、楽天市場・旅行・支払い・銀行・投資のサービスが利用先として掲載されています。",
  ],
  [
    "Rakuten may change eligible services, transactions, rates, or end the program while providing information appropriately.",
    "楽天は対象サービス・取引・還元率を変更したり、サービスを終了したりする場合があり、適切に案内するとしています。",
  ],
  [
    "The terms make service/campaign conditions applicable and permit reversal after returns, cancellations, or other stated causes.",
    "規約ではサービス・キャンペーンごとの条件を適用し、返品・取消しなど定められた事情の後に付与を取り消せるとしています。",
  ],
  [
    "The terms prohibit member-to-member transfer and cash conversion.",
    "規約では会員間の移行と現金化を禁止しています。",
  ],
  [
    "ANA's page states 10,000 miles exchange to 8,000 Rakuten points.",
    "ANAのページでは、10,000マイルを楽天ポイント8,000ポイントに交換すると案内しています。",
  ],
  [
    "The third partner-point exchange in one ANA fiscal year yields 4,000 points per 10,000 miles.",
    "ANA年度内の提携ポイント交換が三回目の場合は、10,000マイルにつき4,000ポイントになります。",
  ],
  [
    "From April 22, 2026, processing is about 2–3 weeks and the daily cap is two units or 20,000 miles.",
    "2026年四月22日以降、処理には約2–3週間かかり、一日の上限は二単位または20,000マイルです。",
  ],
  [
    "Two Rakuten points convert to one ANA mile; transfers start at 50 points and have no fee.",
    "楽天ポイント二ポイントはANAマイル一マイルに交換でき、移行は50ポイントからで手数料はありません。",
  ],
  [
    "ANA says the transfer takes 3–4 weeks, is manual per request, and cannot be reversed to Rakuten points.",
    "ANAでは移行に3–4週間かかり、申請ごとに手続きされ、楽天ポイントへ戻せないと案内しています。",
  ],
  [
    "Diamond members can use up to 500,000 points per transaction/month; other ranks 30,000/100,000.",
    "ダイヤモンド会員は一取引・一か月あたり500,000ポイントまで使え、その他のランクは30,000または100,000ポイントまでです。",
  ],
  [
    "Minimum use is 1 point for several shopping services, 100 for Travel/GORA, and generally 50 elsewhere.",
    "最低利用数は、複数の買い物サービスでは1ポイント、Travel・GORAでは100ポイント、その他では原則50ポイントです。",
  ],
  [
    "The official checkout formula subtracts the number of points used from the yen bill amount.",
    "公式の決済計算では、円の請求額から使用したポイント数を差し引きます。",
  ],
  [
    "The campaign required a first app login, needed no entry, and limited participation to one account/person.",
    "キャンペーンはアプリへの初回ログインが必要で応募は不要、参加は一アカウント・一人に限られていました。",
  ],
  [
    "Campaign rewards had a fixed expiry of October 31, 2026.",
    "キャンペーン特典の有効期限は2026年十月31日で固定されていました。",
  ],
  [
    "The app campaign ran from April 22 through June 30, 2026.",
    "アプリキャンペーンは2026年四月22日から六月30日まで実施されました。",
  ],
  [
    "The draw awards 10,000 points to 10 people, 100 to 10,000 people, and 1 to everyone else.",
    "抽選では10人に10,000ポイント、10,000人に100ポイント、それ以外の人に1ポイントが進呈されます。",
  ],
  [
    "The August 4, 2026 news listing announced V points for an Imamura Securities investment service.",
    "2026年八月4日のお知らせ一覧で、今村証券の投資サービスでVポイントが使えると案内されました。",
  ],
  [
    "The August 3, 2026 listing announced the start of exchange into V points.",
    "2026年八月3日のお知らせ一覧で、Vポイントへの交換開始が案内されました。",
  ],
  [
    "The July 28 notice announced V Point service at the named Zensho restaurants from August 4, 2026.",
    "七月28日のお知らせでは、記載されたゼンショーの飲食店で2026年八月4日からVポイントサービスを開始すると案内されました。",
  ],
  [
    "V points can be earned from participant use or specific campaigns, with participant-specific conditions.",
    "Vポイントは提携先での利用や特定キャンペーンで貯められますが、条件は提携先ごとに異なります。",
  ],
  [
    "The earn page uses a 200-yen-including-tax per point partner rate as an explicit scenario.",
    "獲得ページでは、税込200円ごとに一ポイントという提携先の還元例を明示しています。",
  ],
  [
    "Fixed-expiry V points do not extend through point movement and expire on their individual deadline.",
    "有効期限固定のVポイントはポイント移動で期限が延長されず、それぞれの期限に失効します。",
  ],
  [
    "Normal V points expire one year after the last qualifying movement.",
    "通常のVポイントは、最後に対象となるポイント移動をしてから一年後に失効します。",
  ],
  [
    "Store-limited points are consumed first, then other fixed-expiry points, then normal points; earlier expiry wins within a class.",
    "店舗限定ポイント、その他の期限固定ポイント、通常ポイントの順に使い、同じ区分では期限の早いものを先に使います。",
  ],
  [
    "Store-limited V points can only be used at designated participants and expire on their own fixed date.",
    "店舗限定Vポイントは指定された提携先だけで使え、それぞれの固定日に失効します。",
  ],
  [
    "The rendered earn directory lists ENEOS as a V Point partner.",
    "表示された獲得先一覧では、ENEOSがVポイント提携先として掲載されています。",
  ],
  [
    "The rendered earn directory lists FamilyMart as a V Point partner.",
    "表示された獲得先一覧では、ファミリーマートがVポイント提携先として掲載されています。",
  ],
  [
    "The rendered use directory lists FamilyMart as accepting V points.",
    "表示された利用先一覧では、ファミリーマートがVポイントに対応すると掲載されています。",
  ],
  [
    "The rendered use directory lists Yoshinoya as accepting V points.",
    "表示された利用先一覧では、吉野家がVポイントに対応すると掲載されています。",
  ],
  [
    "Internet use requires the designated ID authentication and store use requires a valid card.",
    "インターネット利用には指定IDの認証が必要で、店頭利用には有効なカードが必要です。",
  ],
  [
    "Participants can set different rates, transaction limits, and excluded goods/services; some points are participant-limited.",
    "提携先ごとに還元率・取引上限・対象外の商品やサービスを定められ、一部のポイントは提携先限定です。",
  ],
  [
    "From April 22, 2026, ANA-to-V processing became 2–3 weeks with a two-unit/20,000-mile daily cap.",
    "2026年四月22日以降、ANAからVポイントへの処理は2–3週間となり、一日の上限は二単位または20,000マイルです。",
  ],
  [
    "The ANA page states 10,000 miles exchange to 10,000 V points.",
    "ANAのページでは、10,000マイルをVポイント10,000ポイントに交換すると案内しています。",
  ],
  [
    "The third partner-point exchange in one ANA fiscal year yields 5,000 V points per 10,000 miles.",
    "ANA年度内の提携ポイント交換が三回目の場合は、10,000マイルにつきVポイント5,000ポイントになります。",
  ],
  [
    "The V Point page shows 500 points to 250 ANA miles, with 20,000 annual miles stated as the cap.",
    "Vポイントのページでは、500ポイントを250 ANAマイルに交換し、年間上限を20,000マイルと案内しています。",
  ],
  [
    "The donation route uses 1 V point as 1 yen of donation value.",
    "寄付ではVポイント1ポイントを1円分の寄付額として使います。",
  ],
  [
    "V points are presented as one yen per point at partner, Visa, and internet use routes.",
    "Vポイントは、提携先・Visa・インターネットの利用先で一ポイント一円として案内されています。",
  ],
  [
    "The official use page allows V points to be charged to V Point Pay for Visa-store and online use.",
    "公式の利用ページでは、VポイントをVポイントPayへチャージし、Visa加盟店やオンラインで使えるとしています。",
  ],
  [
    "Only same-account campaign-period charges count; WAON and AEON Pay balances cannot be combined.",
    "同じアカウントでキャンペーン期間中に行ったチャージだけが対象で、WAONとAEON Payの残高は合算できません。",
  ],
  [
    "The campaign says awarded WAON POINT has the standard maximum-two-year expiry structure.",
    "キャンペーンでは、進呈されたWAON POINTに標準の最大二年の有効期限構造が適用されるとしています。",
  ],
  [
    "The campaign runs August 14–31, 2026, with an early period August 14–16.",
    "キャンペーンは2026年八月14日–31日に実施され、先行期間は八月14日–16日です。",
  ],
  [
    "Each 10,000 yen in eligible charges is one draw; standard prizes are 10,000 points for 1,500 winners, with an early 50,000-point draw.",
    "対象チャージ10,000円ごとに一回抽選し、通常賞は1,500人に10,000ポイント、先行期間には50,000ポイントの抽選があります。",
  ],
  [
    "Charges can be split across transactions; each 10,000 yen accumulated on one account makes one entry.",
    "チャージは複数の取引に分けられ、同じアカウントで合計10,000円になるごとに一口応募できます。",
  ],
  [
    "The campaign covers all electronic-money WAON cards and listed WAON/AEON Pay charge methods.",
    "キャンペーンは電子マネーWAONの全カードと、記載されたWAON・AEON Payのチャージ方法を対象にします。",
  ],
  [
    "The integration notice states the basic unit remains one point per 200 yen including tax.",
    "統合のお知らせでは、基本単位は税込200円ごとに一ポイントのままとしています。",
  ],
  [
    "The integration distinguishes charge-only electronic-money points from WAON POINT, which can also pay directly at stores.",
    "統合では、チャージ専用の電子マネーポイントと、店頭で直接支払いにも使えるWAON POINTを区別しています。",
  ],
  [
    "From March 1, 2026, issuance switches to WAON POINT sequentially by merchant.",
    "2026年三月1日から、加盟店ごとに順次WAON POINTの付与へ切り替わります。",
  ],
  [
    "The notice says posting may take several days rather than being immediate.",
    "お知らせでは、付与は即時ではなく数日かかる場合があるとしています。",
  ],
  [
    "An AEON-mark card payment earns one WAON POINT per 200 yen including tax.",
    "イオンマークのカード支払いでは、税込200円ごとに一 WAON POINTが貯まります。",
  ],
  [
    "Credit/debit points are posted on the 25th; electronic-money or cash-with-card points post at payment.",
    "クレジット・デビット分は25日に付与され、電子マネーまたはカード併用の現金分は支払い時に付与されます。",
  ],
  [
    "Green Beans earns one point per 200 yen before tax after discounts, excluding fees and point-used amounts.",
    "Green Beansでは割引後の税抜200円ごとに一ポイントが貯まり、手数料とポイント利用額は対象外です。",
  ],
  [
    "The main guide shows one point per 200 yen including tax for WAON shopping.",
    "メインガイドでは、WAONでの買い物は税込200円ごとに一ポイントと案内しています。",
  ],
  [
    "The card guide anchors expiry to the first posting month and ends it at the end of the month two years later.",
    "カードガイドでは最初の付与月を基準にし、二年後の月末に有効期限が終わるとしています。",
  ],
  [
    "WAON POINT has a one-year earning period plus validity ending within a maximum two-year structure.",
    "WAON POINTは一年間の獲得期間を持ち、最大二年の構造内で有効期限が終わります。",
  ],
  [
    "Points completed April–September can be received through the following March 31; October–March through the following September 30.",
    "四月–九月に確定したポイントは翌年三月31日まで、十月–三月分は翌年九月30日まで受け取れます。",
  ],
  [
    "Each annual lot expires at the end of the year following the year in which it was added.",
    "各年分のポイントは、追加された年の翌年の年末に失効します。",
  ],
  [
    "The first annual period starts at the first award and ends at the month end after one year.",
    "最初の年間期間は初回付与時に始まり、一年後の月末に終わります。",
  ],
  [
    "The visible AEON Shop record allows use but says ordinary 200-yen earn is not offered; bonus points may apply.",
    "表示されたイオンショップの情報では利用できますが、通常の200円ごとの獲得はなく、ボーナスポイントが付く場合があります。",
  ],
  [
    "The directory organizes partners by merchant category and earn/use/service filters.",
    "一覧では、加盟店の分類と獲得・利用・サービスの絞り込みで提携先を整理しています。",
  ],
  [
    "The visible Green Beans record is marked as both earn and use.",
    "表示されたGreen Beansの情報には、獲得・利用の両方に対応すると記載されています。",
  ],
  [
    "The terms allow issuer-specified merchant earning and partner-point exchange; presenting a card after settlement earns no points.",
    "規約では発行元が定める加盟店での獲得と提携ポイント交換を認めていますが、決済後にカードを提示してもポイントは付きません。",
  ],
  [
    "The service terms prohibit exchanging WAON POINT for cash.",
    "サービス規約では、WAON POINTの現金交換を禁止しています。",
  ],
  [
    "The terms set one yen per WAON POINT for standard use, while partner exchanges can have other rates.",
    "規約では通常利用をWAON POINT一ポイント一円とし、提携先との交換では別の率になる場合があります。",
  ],
  [
    "During the campaign, 40,000 JAL miles exchange to 50,000 WAON, stated as 50,000 yen equivalent.",
    "キャンペーン期間中はJALマイル40,000マイルをWAON50,000に交換でき、50,000円相当と案内されています。",
  ],
  [
    "The JAL page says exchange count is unlimited, while a WAON card can hold up to 50,000 yen.",
    "JALのページでは交換回数に上限がなく、WAONカードには最大50,000円まで保有できるとしています。",
  ],
  [
    "The normal route shown is 3,000 miles to 1,500 WAON or 10,000 miles to 11,000 WAON.",
    "表示された通常ルートでは、3,000マイルをWAON1,500、または10,000マイルをWAON11,000に交換します。",
  ],
  [
    "From March 1, 2026 partner exchanges changed from electronic-money WAON points to WAON POINT; the prior destination ended February 28.",
    "2026年三月1日から提携先との交換先は電子マネーWAONポイントからWAON POINTに変わり、旧交換先は二月28日に終了しました。",
  ],
  [
    "The terms list merchant payment, WAON conversion, goods, partner services, donations, and member gifts as use routes.",
    "規約では、加盟店支払い・WAONへの交換・商品・提携サービス・寄付・会員向けギフトを利用先として挙げています。",
  ],
  [
    "The official exchange/charge guidance requires a first-time WAON card to receive a 1,000-yen-or-more charge before point receipt.",
    "公式の交換・チャージ案内では、初めて使うWAONカードはポイント受取前に1,000円以上のチャージが必要です。",
  ],
  [
    "One WAON point converts to one yen of WAON for shopping.",
    "WAON POINT一ポイントは、買い物でWAON一円分に交換できます。",
  ],
  [
    "Awarded/exchanged points must be downloaded by the applicable seasonal deadline or cannot be received.",
    "進呈・交換されたポイントは季節ごとの受取期限までにダウンロードしないと受け取れません。",
  ],
  [
    "General AEON Card credit payment earns 1 WAON POINT per 200 yen including tax.",
    "一般的なイオンカードのクレジット支払いでは、税込200円ごとに1 WAON POINTが貯まります。",
  ],
  [
    "AEON Group target-store card payment earns 2 WAON POINT per 200 yen including tax.",
    "イオングループの対象店でカード支払いをすると、税込200円ごとに2 WAON POINTが貯まります。",
  ],
  [
    "The USMH campaign gives 3x basic points for eligible AEON Pay code payments through August 31, 2026.",
    "USMHキャンペーンでは、対象のAEON Payコード支払いに基本ポイントの3倍を2026年八月31日まで付与します。",
  ],
  [
    "The fetched catalog rendered 25 cards and named several AEON Card products.",
    "取得したカタログには25種類のカードが表示され、複数のイオンカード商品名が記載されています。",
  ],
  [
    "AEON states that eligible rewards transition sequentially to WAON POINT from March 1, 2026.",
    "イオンは、対象の特典を2026年三月1日から順次WAON POINTへ切り替えるとしています。",
  ],
  [
    "The W-point multiplier excludes listed charge, WAON Touch, point-use, gift-card, transit, and fee categories.",
    "Wポイント倍率は、記載されたチャージ・WAON Touch・ポイント利用・ギフトカード・交通・手数料の区分を対象外にします。",
  ],
  [
    "AEON Card Select has no annual fee; Gold issuance requires stated issuer conditions.",
    "イオンカードセレクトは年会費無料ですが、ゴールド発行には発行元が定める条件が必要です。",
  ],
  [
    "au PAY Card generally earns 1 Ponta point per 100 yen including tax.",
    "au PAYカードは原則として税込100円ごとに1 Pontaポイントが貯まります。",
  ],
  [
    "The comparison page gives product-specific autocharge bonuses with separate monthly caps.",
    "比較ページでは商品ごとにオートチャージ特典があり、月間上限もそれぞれ異なるとしています。",
  ],
  [
    "au PAY Gold Card advertises combined mobile-charge rewards up to 10% under its conditions.",
    "au PAYゴールドカードは、条件を満たすと携帯料金チャージの合算還元が最大10%になると案内しています。",
  ],
  [
    "The current au PAY Card page lists up to 3,000 points for regular and 10,000 for Gold under conditions.",
    "現在のau PAYカードページでは、条件を満たすと通常カードは最大3,000ポイント、ゴールドは10,000ポイントと記載されています。",
  ],
  [
    "The fetched comparison distinguishes regular and Gold au PAY Card products and their brands.",
    "取得した比較情報では、通常とゴールドのau PAYカード商品とブランドを区別しています。",
  ],
  [
    "The official guide excludes listed electronic-money and prepaid-card charges from ordinary points.",
    "公式ガイドでは、記載された電子マネー・プリペイドカードへのチャージを通常ポイントの対象外にしています。",
  ],
  [
    "The regular au PAY Card is free; Gold costs 11,000 yen annually and has separate family-card fees.",
    "通常のau PAYカードは無料で、ゴールドは年11,000円、家族カードには別の手数料があります。",
  ],
  [
    "The regular d Card earns 1 d point per 100 yen of ordinary eligible spend.",
    "通常のdカードは、対象となる通常利用100円ごとに1 dポイントが貯まります。",
  ],
  [
    "The current USJ campaign requires entry and at least 2,000 yen of eligible d払い/d Card spend.",
    "現在のUSJキャンペーンは応募が必要で、対象のd払い・dカード利用が2,000円以上必要です。",
  ],
  [
    "The official lineup distinguishes d Card, GOLD U, GOLD, and PLATINUM products.",
    "公式ラインアップでは、dカード・GOLD U・GOLD・PLATINUMの商品を区別しています。",
  ],
  [
    "The fetched page says the d Card payment benefit is planned to become limited-purpose d points on September 1, 2026.",
    "取得したページでは、dカードの支払い特典を2026年九月1日に期間・用途限定dポイントへ変更する予定としています。",
  ],
  [
    "The official page states 1 d point can be used as 1 yen on listed routes.",
    "公式ページでは、記載された利用先で1 dポイントを1円分として使えるとしています。",
  ],
  [
    "The regular-card page excludes listed electronic-money and prepaid-card charges from ordinary points.",
    "通常カードのページでは、記載された電子マネー・プリペイドカードへのチャージを通常ポイントの対象外にしています。",
  ],
  [
    "d Card PLATINUM has a 29,700-yen annual fee and a stated 100-yen base point unit.",
    "dカード PLATINUMは年会費29,700円で、基本ポイントの単位は100円と記載されています。",
  ],
  [
    "The regular d Card has no annual fee; the official page also states a free family card.",
    "通常のdカードは年会費無料で、公式ページでは家族カードも無料としています。",
  ],
  [
    "PayPay Card can earn up to 1.5% PayPay points when app and identity conditions are met.",
    "PayPayカードは、アプリと本人確認の条件を満たすと最大1.5%のPayPayポイントを獲得できます。",
  ],
  [
    "The Gold annual-use benefit awards 11,000 points after 1,000,000 yen of qualifying annual spend.",
    "ゴールドの年間利用特典では、対象の年間利用額が1,000,000円に達すると11,000ポイントが進呈されます。",
  ],
  [
    "The official page identifies regular and Gold PayPay Card products for PayPay and card-merchant use.",
    "公式ページでは、PayPay利用とカード加盟店利用に対応する通常・ゴールドのPayPayカード商品を示しています。",
  ],
  [
    "From June 2, 2026, Gold's former bonus treatment is replaced by an annual 1-million-yen/11,000-point benefit for applicable terms.",
    "2026年六月2日から、ゴールドの従来の特典は、条件に応じた年間1百万円・11,000ポイント特典へ変更されます。",
  ],
  [
    "Gold annual-use qualifying spend excludes the listed other-wallet and e-money charges.",
    "ゴールドの年間利用特典では、記載された他社ウォレット・電子マネーへのチャージを対象外にします。",
  ],
  [
    "PayPay Card is free annually; PayPay Card Gold costs 11,000 yen per year.",
    "PayPayカードは年会費無料で、PayPayカード ゴールドは年11,000円です。",
  ],
  [
    "Rakuten Card ordinary shopping earns 1 Rakuten point per 100 yen including tax.",
    "楽天カードの通常の買い物では、税込100円ごとに1楽天ポイントが貯まります。",
  ],
  [
    "The fetched official pages identify Gold and Premium Rakuten Card SKUs separately.",
    "取得した公式ページでは、楽天ゴールドカードと楽天プレミアムカードの商品を別々に示しています。",
  ],
  [
    "Rakuten postponed the planned March 1, 2026 point-condition change and says current conditions continue.",
    "楽天は予定していた2026年三月1日のポイント条件変更を延期し、現在の条件を継続するとしています。",
  ],
  [
    "Rakuten's rate table gives separate treatment to named wallet and e-money charge routes.",
    "楽天の還元率表では、記載されたウォレット・電子マネーへのチャージ方法を別に扱っています。",
  ],
  [
    "Rakuten Gold Card annual fee is 2,200 yen and its ordinary card rate is 1 point per 100 yen.",
    "楽天ゴールドカードの年会費は2,200円で、通常の還元率は100円ごとに1ポイントです。",
  ],
  [
    "Rakuten Premium Card costs 11,000 yen annually and states five free Priority Pass visits per year.",
    "楽天プレミアムカードは年11,000円で、Priority Passを年五回無料で利用できると記載されています。",
  ],
  [
    "The named SMBC NL card earns 1 V point per 200 yen including tax in ordinary use.",
    "記載された三井住友カード NLは、通常利用で税込200円ごとに1 Vポイントが貯まります。",
  ],
  [
    "NL advertises 7% at eligible convenience/restaurant merchants only through stated mobile payment modes.",
    "NLは、記載された携帯決済の方法に限り、対象のコンビニ・飲食店で7%と案内しています。",
  ],
  [
    "The current Gold NL campaign advertises up to 31,000 yen-equivalent reward for eligible applicants through September 30, 2026.",
    "現在のGold NLキャンペーンでは、対象応募者に2026年九月30日まで最大31,000円相当の特典を案内しています。",
  ],
  [
    "The bounded SMBC coverage identifies the regular NL and Gold NL named products.",
    "対象範囲の三井住友カード情報では、通常のNLとGold NLの商品を示しています。",
  ],
  [
    "SMBC published a March 1, 2026 notice adding or changing annual-spend aggregation exclusions.",
    "三井住友カードは2026年三月1日付で、年間利用額の集計対象外を追加・変更するお知らせを公開しました。",
  ],
  [
    "The official FAQ excludes named mobile-wallet, e-money, and prepaid-card charges from Gold NL annual-spend aggregation.",
    "公式FAQでは、記載された携帯ウォレット・電子マネー・プリペイドカードへのチャージをGold NLの年間利用額集計から除外しています。",
  ],
  [
    "Gold NL costs 5,500 yen, with a stated fee waiver and 10,000-point benefit after qualifying 1-million-yen annual spend.",
    "Gold NLは年会費5,500円で、対象の年間利用額が1百万円に達すると年会費免除と10,000ポイント特典があると記載されています。",
  ],
  [
    "The named regular SMBC NL card and its family card have no annual fee.",
    "記載された通常の三井住友カード NLと家族カードは年会費無料です。",
  ],
  [
    "Bic Camera Suica Card ordinary credit use earns 5 JRE POINT per 1,000 yen including tax.",
    "ビックカメラSuicaカードの通常クレジット利用では、税込1,000円ごとに5 JRE POINTが貯まります。",
  ],
  [
    "The named card page states a basic 11% Bic Point service for Bic Camera credit payments.",
    "記載されたカードのページでは、ビックカメラのクレジット支払いで基本11%のビックポイントサービスを案内しています。",
  ],
  [
    "Suica payment at Bic Camera can reach 11.5% combined when the 1.5% mobile-Suica charge route applies.",
    "ビックカメラでSuica支払いをすると、モバイルSuicaチャージの1.5%ルートが適用される場合に合算11.5%まで届きます。",
  ],
  [
    "The rendered campaign directory lists up to 6,000 Bic points for eligible Bic Camera Suica Card use through August 31, 2026.",
    "表示されたキャンペーン一覧では、対象のビックカメラSuicaカード利用に最大6,000ビックポイントを2026年八月31日まで付与するとしています。",
  ],
  [
    "The View Card catalog identifies Bic Camera Suica Card with Suica, JRE POINT, and Bic Point functions.",
    "ビューカードのカタログでは、Suica・JRE POINT・ビックポイント機能を持つビックカメラSuicaカードを示しています。",
  ],
  [
    "View Card states that eligible station-building/ekina use can reach 3.5% from September 1, 2026.",
    "ビューカードでは、対象の駅ビル・駅ナカ利用が2026年九月1日から3.5%までになると案内しています。",
  ],
  [
    "The named page states 1 JRE point=1 yen to Suica and a 1,000-to-1,000 JRE/Bic exchange.",
    "記載されたページでは、1 JRE POINTをSuica1円分とし、JRE POINT1,000ポイントとビックポイント1,000ポイントを交換できるとしています。",
  ],
  [
    "The 1.5% Suica-charge rate is limited to mobile/auto-charge routes; other listed routes are lower or excluded.",
    "Suicaチャージの1.5%還元はモバイル・オートチャージの方法に限られ、その他の記載された方法は低率または対象外です。",
  ],
  [
    "The card is free in year one and later years when at least one qualifying credit use occurred in the prior year.",
    "このカードは初年度無料で、翌年度以降も前年に対象クレジット利用が一回以上あれば無料です。",
  ],
  [
    "AEON Pay at AEON Group target stores earns 2 WAON POINT per 200 yen including tax.",
    "イオングループの対象店でAEON Payを使うと、税込200円ごとに2 WAON POINTが貯まります。",
  ],
  [
    "AEON Pay generally earns 1 WAON POINT per 200 yen including tax.",
    "AEON Payは原則として税込200円ごとに1 WAON POINTが貯まります。",
  ],
  [
    "The 200-yen registration balance expires October 15, 2026 and can be deducted around October 26 without qualifying use.",
    "登録時の200円残高は2026年十月15日に失効し、対象利用がなくても十月26日頃に差し引かれる場合があります。",
  ],
  [
    "First-time AEON Pay registrants receive 200 yen of AEON Pay balance once during the July-August campaign.",
    "AEON Payに初めて登録した人には、七月・八月のキャンペーン中に一度だけAEON Pay残高200円が付与されます。",
  ],
  [
    "The 2x rule excludes AEON Pay charge payment, WAON POINT use, and the page's listed methods/merchants.",
    "2倍ルールはAEON Pay残高へのチャージ支払い、WAON POINT利用、ページに記載された方法・加盟店を対象外にします。",
  ],
  [
    "AEON Pay can be funded from a registered AEON Card, bank account, or cash/ATM route, including cardless use.",
    "AEON Payには登録イオンカード、銀行口座、現金・ATMから入金でき、カードを使わない方法にも対応しています。",
  ],
  [
    "The Kanagawa campaign caps balance reward at 1,500 yen per payment and 2,500 yen for the period.",
    "神奈川県キャンペーンの残高特典は、一回の支払いにつき1,500円、期間合計2,500円が上限です。",
  ],
  [
    "The Kanagawa campaign gives 20% at small businesses and 10% at large businesses via AEON Pay code payment.",
    "神奈川県キャンペーンでは、AEON Payコード支払いで小規模事業者20%、大規模事業者10%を付与します。",
  ],
  [
    "The official overview lists AEON, Lawson, restaurants, and other named merchant examples, with some store exceptions.",
    "公式概要では、イオン・ローソン・飲食店などの加盟店例を挙げつつ、一部店舗は例外としています。",
  ],
  [
    "AEON Pay supports card, balance-charge, code, and touch routes through the official apps.",
    "AEON Payは公式アプリを通じて、カード・残高チャージ・コード・タッチの方法に対応しています。",
  ],
  [
    "au PAY base decision benefit is 1 Ponta point per 200 yen including tax.",
    "au PAYの基本還元は税込200円ごとに1 Pontaポイントです。",
  ],
  [
    "The au Money Activity plan adds 0.5%, up to 150 points monthly, for a combined maximum of 1%.",
    "auマネーアクティビティプランでは0.5%を月150ポイントまで上乗せし、合算で最大1%になります。",
  ],
  [
    "The app-store campaign runs from July 30 through September 8, 2026.",
    "アプリストアキャンペーンは2026年七月30日から九月8日まで実施されます。",
  ],
  [
    "The campaign awards one non-cumulative Ponta tier from 10 to 5,000 points based on eligible spend.",
    "キャンペーンでは、対象利用額に応じて10〜5,000ポイントのPontaポイントを、重複しない一つの段階で進呈します。",
  ],
  [
    "au says KDDI fee payments and excluded stores earn no ordinary points; posting timing varies by payment route.",
    "auでは、KDDI料金の支払いと対象外店舗では通常ポイントが付かず、付与時期は支払方法により異なるとしています。",
  ],
  [
    "The official FAQ lists telecom, card, bank, cash, credit-card, and Ponta funding routes and three autocharge routes.",
    "公式FAQでは、通信料金・カード・銀行・現金・クレジットカード・Pontaからの入金方法と、三つのオートチャージ方法を挙げています。",
  ],
  [
    "au states that au PAY network-payment availability differs by merchant and service.",
    "auでは、au PAYネットワーク支払いの利用可否は加盟店とサービスによって異なるとしています。",
  ],
  [
    "An au PAY payment code is valid for five minutes and the stated per-payment ceiling is 300,000 yen including tax.",
    "au PAYの支払いコードは五分間有効で、一回あたりの上限は税込300,000円と記載されています。",
  ],
  [
    "d払い with d Card earns 2 d points per 200 yen, combining the 0.5% base and 0.5% card benefit.",
    "dカードを使ったd払いでは、基本0.5%とカード特典0.5%を合わせ、200円ごとに2 dポイントが貯まります。",
  ],
  [
    "d払い balance and telephone-bill-combined payment earn 1 d point per 200 yen including tax.",
    "d払い残高と電話料金合算払いでは、税込200円ごとに1 dポイントが貯まります。",
  ],
  [
    "The current USJ campaign requires entry and at least 2,000 yen of eligible d払い/d Card spending.",
    "現在のUSJキャンペーンは応募が必要で、対象のd払い・dカード利用が2,000円以上必要です。",
  ],
  [
    "d払い excludes bill payments and non-d Card credit-card routes from ordinary d point award.",
    "d払いでは、請求書払いとdカード以外のクレジットカードの方法は通常のdポイント付与対象外です。",
  ],
  [
    "ATM cash charge is free, in 1,000-yen units up to 100,000 yen per transaction, with a 1-million-yen balance ceiling.",
    "ATM現金チャージは無料で、1,000円単位、一回100,000円まで、残高上限は1百万円です。",
  ],
  [
    "Bank charge is limited to 300,000 yen per transaction/day and 500,000 yen monthly; post-charge cancellation is unavailable.",
    "銀行チャージは一取引・一日300,000円、月500,000円までで、チャージ後の取消しはできません。",
  ],
  [
    "d払いタッチ follows the selected d払い payment route, subject to merchant acceptance limits.",
    "d払いタッチは選択したd払いの支払方法に従いますが、加盟店側の対応範囲が適用されます。",
  ],
  [
    "d払い supports bill-combined, balance, and card routes; 1 d point is usable as 1 yen.",
    "d払いは電話料金合算・残高・カードの方法に対応し、1 dポイントを1円分として使えます。",
  ],
  [
    "FamiPay ordinary payment earns 1 Fami point per 200 yen including tax.",
    "FamiPayの通常支払いでは、税込200円ごとに1 Famiポイントが貯まります。",
  ],
  [
    "FamiPay next-month pay combines the ordinary rate with up to 9.5% extra, for up to 10% total.",
    "FamiPay翌月払いでは通常還元に最大9.5%を上乗せし、合計最大10%になります。",
  ],
  [
    "The official campaign page advertises a 90% win probability statement and up to 1,500 yen-equivalent Fami points per payment game.",
    "公式キャンペーンページでは、当選確率90%と、支払いゲーム一回につき最大1,500円相当のFamiポイントを案内しています。",
  ],
  [
    "FamiPay mobile-Suica charge starts at 1,000 yen, uses 1-yen units, and tops out at 10,000 yen per charge.",
    "FamiPayからモバイルSuicaへのチャージは1,000円から、1円単位で、一回10,000円までです。",
  ],
  [
    "FamiPay lists 100,000-yen default balance, higher next-month-pay/eKYC ceilings, and a 1.3-million-yen eKYC payment cap.",
    "FamiPayは通常残高100,000円、翌月払い・eKYC利用時はより高い上限、eKYC支払い上限1.3百万円を案内しています。",
  ],
  [
    "FamiPay supports cash, bank, JCB credit, Apple Pay, and gift charging with no stated charge fee.",
    "FamiPayは現金・銀行・JCBクレジット・Apple Pay・ギフトからのチャージに対応し、チャージ手数料は記載されていません。",
  ],
  [
    "The referral campaign gives each qualifying party 100 yen-equivalent points and sets a 60-day reward expiry.",
    "友だち紹介キャンペーンでは、条件を満たした双方に100円相当のポイントを付与し、特典の有効期限を60日としています。",
  ],
  [
    "The official FamiPay overview states no payment or charge fee for the described service routes.",
    "公式のFamiPay概要では、記載されたサービス方法の支払い・チャージ手数料は無料としています。",
  ],
  [
    "FamiPay defines one FamiPay balance unit as one yen of value.",
    "FamiPayでは残高一単位を一円の価値と定めています。",
  ],
  [
    "The normal Step bonus requires 30 payments of at least 200 yen and 100,000 yen total in the prior month.",
    "通常のStep特典には、前月に200円以上の支払いを30回、合計100,000円以上行う条件があります。",
  ],
  [
    "PayPay Step gives 0.5% on balance and 1% on PayPay credit/registered card, calculated per 200 yen.",
    "PayPay Stepは残高で0.5%、PayPayクレジット・登録カードで1%を、200円単位で計算します。",
  ],
  [
    "PayPay changed Step conditions from June 2, 2026, including identity verification and the 30/100,000-yen threshold.",
    "PayPayは2026年六月2日からStep条件を変更し、本人確認と30回・100,000円の条件を含めました。",
  ],
  [
    "Money-only stores accept PayPay money and money salary, not money light or PayPay points.",
    "マネーのみ対応の店舗ではPayPayマネーとマネー給与は使えますが、マネーライトとPayPayポイントは使えません。",
  ],
  [
    "The charge guide states first monthly SoftBank/Y!mobile charge is free and later charges cost 2.5%; other methods are free.",
    "チャージ案内では、SoftBank・Y!mobileの月初回は無料、二回目以降は2.5%で、その他の方法は無料としています。",
  ],
  [
    "PayPay lists separate bank, ATM, PayPay Card, and eKYC limits, with a 1-million-yen balance ceiling.",
    "PayPayは銀行・ATM・PayPayカード・eKYCごとに上限を定め、残高上限を1百万円としています。",
  ],
  [
    "PayPay merchant settings determine whether money light and points are accepted alongside PayPay money.",
    "PayPayの加盟店設定により、PayPayマネーと一緒にマネーライトやポイントを使えるかが決まります。",
  ],
  [
    "Current PayPay Step points require completed PayPay identity verification and use 200-yen calculation units.",
    "現在のPayPay StepポイントにはPayPay本人確認の完了が必要で、計算単位は200円です。",
  ],
  [
    "Rakuten Pay's current program gives route-specific rates, including 1.0–1.5% for balance payment and 1% for other listed routes.",
    "楽天ペイの現在のプログラムは利用先別の還元率で、残高払いは1.0–1.5%、その他の記載方法は1%などです。",
  ],
  [
    "The page states next-day award for some routes and around the following month's 15th for the Rakuten Card route.",
    "ページでは、一部の方法は翌日、楽天カードの方法は翌月15日頃に付与するとしています。",
  ],
  [
    "Scratch rewards are limited points expiring at the end of the second month, with a stated 10,000-yen daily cap.",
    "スクラッチ特典は期間限定ポイントで、翌々月末に失効し、一日の上限は10,000円と記載されています。",
  ],
  [
    "The scratch campaign gives 100%, 5%, or 1-point outcomes based on eligible prior-day payments of at least 200 yen.",
    "スクラッチキャンペーンでは、前日に200円以上の対象支払いをすると、100%、5%、または1ポイントの結果になります。",
  ],
  [
    "Rakuten Pay postponed its planned March 1 point-condition change; current conditions remain in force.",
    "楽天ペイは予定していた三月1日のポイント条件変更を延期し、現在の条件を継続しています。",
  ],
  [
    "Rakuten Pay's maximum-rate code/QR program excludes the merchants listed on its official page.",
    "楽天ペイの最大還元コード・QRプログラムでは、公式ページに記載された加盟店を対象外にしています。",
  ],
  [
    "The charge table lists 500,000-yen caps for card/bank/ATM/Edy routes and 1,000,000 yen for Rakuma.",
    "チャージ表では、カード・銀行・ATM・Edyの方法は500,000円、ラクマは1,000,000円を上限としています。",
  ],
  [
    "Rakuten Pay balance supports Rakuten Card, bank, ATM, Rakuma, and Edy charging routes.",
    "楽天ペイ残高は、楽天カード・銀行・ATM・ラクマ・Edyからのチャージに対応しています。",
  ],
  [
    "The official program distinguishes balance, point, bank, and card routes for Rakuten Pay code/QR payments.",
    "公式プログラムでは、楽天ペイのコード・QR支払いについて、残高・ポイント・銀行・カードの方法を区別しています。",
  ],
  [
    "The page names the merchants and warns some stores differ.",
    "ページでは加盟店名を挙げ、一部の店舗は異なると注意しています。",
  ],
  [
    "The page displays a 10,000-winner lottery for 775 points without visible dates.",
    "ページには、日付の表示がないまま、当選者10,000人に775ポイントを進呈する抽選が表示されています。",
  ],
  [
    "Nanaco supports cash/card/autocharge/app and prior registration with 24-hour wait.",
    "nanacoは現金・カード・オートチャージ・アプリに対応し、事前登録後24時間待つ必要があります。",
  ],
  [
    "Nanaco shows 1 point per ¥200 before tax and later-store monthly posting.",
    "nanacoでは税抜¥200ごとに1ポイントで、後日付与の店舗は月次で付与されます。",
  ],
  [
    "Seven Card Plus/Gold earn 1 point per ¥200 on credit charge.",
    "セブンカード・プラス／ゴールドは、クレジットチャージ¥200ごとに1ポイントが貯まります。",
  ],
  [
    "One point exchanges to ¥1 with no fee and cannot be canceled.",
    "一ポイントは手数料なしで¥1に交換できますが、取消しはできません。",
  ],
  [
    "The directory lists a 10,000-point lottery for charging August 14–31.",
    "一覧には、八月14日–31日のチャージを対象に10,000ポイントの抽選が掲載されています。",
  ],
  [
    "From March 1, stores transition to WAON POINT with two-year maximum expiry.",
    "三月1日から店舗はWAON POINTへ切り替わり、有効期限は最大二年です。",
  ],
  [
    "Autocharge earns 1 per ¥200 or 2 at registered target stores.",
    "オートチャージでは¥200ごとに1ポイント、登録した対象店では2ポイントが貯まります。",
  ],
  [
    "WAON earns 1 point per ¥200 including tax.",
    "WAONでは税込¥200ごとに1ポイントが貯まります。",
  ],
  [
    "The official list includes the named WAON/AEON/JAL/Apple Pay classes.",
    "公式一覧には、記載されたWAON・AEON・JAL・Apple Payの区分が含まれています。",
  ],
  [
    "WAON card costs ¥350, has no annual fee and has ¥50,000/¥49,000 limits.",
    "WAONカードは¥350で、年会費はなく、上限は¥50,000／¥49,000です。",
  ],
  [
    "Each period requires at least ¥1,000 before tax and one use per 7iD.",
    "各期間で税抜¥1,000以上の利用が必要で、7iDごとに一回までです。",
  ],
  [
    "7NOW excludes the listed postal, prepaid, publication and flammable-goods classes.",
    "7NOWでは、記載された郵便・プリペイド・出版物・可燃物の区分を対象外にしています。",
  ],
  [
    "The ANA benefit was 1 mile per ¥200 including tax and ended 2026-05-31.",
    "ANA特典は税込¥200ごとに1マイルでしたが、2026-05-31に終了しました。",
  ],
  [
    "The Saison/UC benefit was 1 point per ¥100 including tax and ended 2026-08-10.",
    "セゾン・UC特典は税込¥100ごとに1ポイントでしたが、2026-08-10に終了しました。",
  ],
  [
    "7NOW shows the stated hours, fee range, minimum and payment methods.",
    "7NOWでは、記載された営業時間・手数料の範囲・最低額・支払方法を案内しています。",
  ],
  [
    "The page lists product, point-paid, non-AEON QR and non-target-store exclusions.",
    "ページでは、商品・ポイント払い・AEON以外のQR・対象外店舗を除外対象として挙げています。",
  ],
  [
    "Target tenders earn 2 per ¥200 including tax; basic is 1 and grant day is 25.",
    "対象の支払方法では税込¥200ごとに2ポイント、基本は1ポイントで、付与日は25日です。",
  ],
  [
    "Amazon Pay lists cards, Amazon Gift Card, Paidy, JCB J-POINT and merpay.",
    "Amazon Payでは、カード・Amazonギフトカード・Paidy・JCB J-POINT・メルペイを利用方法として挙げています。",
  ],
  [
    "The directory displays a first-use offer up to 20%; child dates were not rendered.",
    "一覧には初回利用で最大20%の特典が表示されていますが、詳細な日付は表示されていません。",
  ],
  [
    "J-Debit is unavailable and some methods depend on merchants.",
    "J-Debitは利用できず、一部の方法は加盟店によって異なります。",
  ],
  [
    "The official online list includes cards, bank/convenience/netbank/ATM, wallets, Paidy and gift cards.",
    "公式オンライン一覧には、カード・銀行／コンビニ／ネットバンク／ATM・ウォレット・Paidy・ギフトカードが含まれます。",
  ],
  [
    "Bic displays 10%, 1 point=¥1 and two-year-after-last-use expiry.",
    "ビックでは10%と、1ポイント=¥1、最後の利用から二年後までの有効期限を案内しています。",
  ],
  [
    "FamilyMart lists FamiPay, points, cards, wallets and e-money.",
    "ファミリーマートでは、FamiPay・ポイント・カード・ウォレット・電子マネーを利用方法として挙げています。",
  ],
  [
    "August games show a ¥100,000 daily maximum and 90%/¥1,500 payment game.",
    "八月のゲームでは、一日¥100,000の上限と、当選確率90%・¥1,500の支払いゲームが表示されています。",
  ],
  [
    "FamiPay excludes listed agency collections, multicopy services and e-money charging.",
    "FamiPayでは、記載された収納代行・マルチコピーサービス・電子マネーチャージを対象外にしています。",
  ],
  [
    "FamiPay requires the app and cannot combine with other e-money or credit card.",
    "FamiPayはアプリが必要で、他の電子マネーやクレジットカードとの併用はできません。",
  ],
  [
    "Eligible nanaco earns 4 per ¥200 including tax on listed dates.",
    "対象のnanaco利用では、記載された日に税込¥200ごとに4ポイントが貯まります。",
  ],
  [
    "At the two named stores, Thursday ¥10,000 charging earns 100 points once daily.",
    "記載された二店舗では、木曜日に¥10,000チャージすると一日一回100ポイントが貯まります。",
  ],
  [
    "Lawson lists the methods and au PAY ¥300,000 cap.",
    "ローソンでは利用方法とau PAYの上限¥300,000を案内しています。",
  ],
  [
    "The current directory shows August 18–31 and August 18–September 7 campaigns.",
    "現在の一覧には、八月18日–31日と八月18日–九月7日のキャンペーンが表示されています。",
  ],
  [
    "Lawson shows time-band rates, Ponta Plus maxima and 1 point=¥1 with 20,000 cap.",
    "ローソンでは時間帯別の還元率、Ponta Plusの最大率、1ポイント=¥1、上限20,000ポイントを案内しています。",
  ],
  [
    "The August campaign advertises +50% with maximum 15% bonus.",
    "八月のキャンペーンでは+50%を案内し、ボーナスの上限は15%です。",
  ],
  [
    "Matsukiyo shows monthly/annual 2x/3x thresholds and ¥150,000 cap.",
    "マツキヨでは月間・年間の2倍／3倍条件と、¥150,000の上限を示しています。",
  ],
  [
    "McDonald's lists barcode, e-money, mobile wallets, cards, JCB PreMo and McCard.",
    "マクドナルドでは、バーコード・電子マネー・モバイルウォレット・カード・JCB PreMo・McCardを利用方法として挙げています。",
  ],
  [
    "The 250-point raffle ran in two February–March 2026 periods and is ended.",
    "250ポイントの抽選は2026年二月–三月の二つの期間に実施され、現在は終了しています。",
  ],
  [
    "Registered mobile-order/McDelivery spend earns 1 point per ¥10 including tax, valid one year.",
    "登録済みのモバイルオーダー・McDelivery利用では税込¥10ごとに1ポイントが貯まり、有効期限は一年です。",
  ],
  [
    "NewDays self-checkout lists transit e-money, cards and named barcodes.",
    "NewDaysのセルフレジでは、交通系電子マネー・カード・記載されたバーコードを利用できます。",
  ],
  [
    "The campaign gives ¥150/¥100/¥50 rewards, one per person/period, valid two weeks.",
    "キャンペーンでは¥150／¥100／¥50の特典を、一人・一期間につき一つ進呈し、有効期間は二週間です。",
  ],
  [
    "Registered Suica earns 1 point per ¥200 including tax; 1 point is ¥1.",
    "登録Suicaでは税込¥200ごとに1ポイントが貯まり、1ポイントは¥1相当です。",
  ],
  [
    "Rakuten Ichiba lists the methods and ¥9,999,999 including-tax cap.",
    "楽天市場では利用方法と、税込¥9,999,999の上限を案内しています。",
  ],
  [
    "The campaign shows rank multipliers, 1,000 cap, entry and following-month expiry.",
    "キャンペーンでは会員ランク別の倍率、上限1,000ポイント、応募条件、翌月の有効期限を示しています。",
  ],
  [
    "Standard earning is 1 point per ¥100 before tax with the stated grant window.",
    "通常の獲得は税抜¥100ごとに1ポイントで、付与期間は記載された範囲です。",
  ],
  [
    "Card issue/load, balance transfer and return-card purchases do not earn Stars.",
    "カードの発行・チャージ、残高移行、返品カードの購入ではStarsは貯まりません。",
  ],
  [
    "Starbucks gives store/eGift and online formulas, rounding, Gold threshold and reward validity.",
    "スターバックスでは店頭・eGift・オンラインの計算方法、端数処理、Gold条件、特典の有効期限を案内しています。",
  ],
  [
    "The ended campaign required ¥1,500 and capped bonus at ¥1,000 per transaction/¥20,000 per period.",
    "終了したキャンペーンは¥1,500以上が条件で、ボーナス上限は一取引¥1,000、期間合計¥20,000でした。",
  ],
  [
    "Welcia shows online rates/value and physical-only 20th-day 1.5x use.",
    "ウエルシアではオンラインの還元率・価値と、店頭限定で20日に1.5倍になる利用を示しています。",
  ],
  [
    "The future sale shows +4% from ¥5,000, +7% from ¥20,000 and 21% maximum total.",
    "今後のセールでは¥5,000から+4%、¥20,000から+7%、合計最大21%と表示されています。",
  ],
  [
    "The page gives funding rates and 30-payment/¥100,000 qualification for +0.5% next month.",
    "ページでは入金方法別の還元率と、翌月+0.5%の条件として30回・¥100,000を示しています。",
  ],
  [
    "Gold Point Card Plus adds 3% special points to regular cash rate in named scopes.",
    "ゴールドポイントカード・プラスは、記載された対象で通常の現金還元率に3%の特別ポイントを上乗せします。",
  ],
  [
    "CAA states the effective date and covered media/regulated actor.",
    "消費者庁は施行日と対象となる媒体・規制対象者を示しています。",
  ],
  [
    "CAA published a July 31 notice covering through June 30, 2026.",
    "消費者庁は2026年六月30日までを対象とする七月31日付のお知らせを公開しました。",
  ],
  [
    "FSA provides searchable provider files with displayed as-of dates.",
    "金融庁は検索できる事業者ファイルを提供し、基準日を表示しています。",
  ],
  [
    "FSA states domestic operation requires registration under the named Acts.",
    "金融庁は、国内での営業には記載された法律に基づく登録が必要としています。",
  ],
  [
    "June 2026 is the bounded PPC change notice.",
    "個人情報保護委員会の対象のお知らせは2026年六月の変更です。",
  ],
  [
    "The guideline records a June 2026 partial revision and covered operator definition.",
    "ガイドラインには2026年六月の一部改訂と対象事業者の定義が記録されています。",
  ],
  [
    "JRE POINT converts 1:1 with minimum 1 and ¥20,000 balance cap.",
    "JRE POINTは1対1で交換でき、最低1ポイント、残高上限¥20,000です。",
  ],
  [
    "The directory lists the stated 2026 campaign ranges.",
    "一覧には、記載された2026年のキャンペーン期間が掲載されています。",
  ],
  [
    "View Card is required; official examples give 1.5% and 5/15 points per ¥1,000.",
    "ビューカードが必要で、公式例では¥1,000ごとに1.5%、または5／15ポイントとしています。",
  ],
  [
    "Registration is required for described rail/Mobile Suica earning.",
    "記載された鉄道・モバイルSuicaでの獲得には登録が必要です。",
  ],
  [
    "Mobile Suica autocharge requires linked View Card.",
    "モバイルSuicaのオートチャージには連携したビューカードが必要です。",
  ],
  [
    "JR East describes rail/Mobile Suica earning and listed uses.",
    "JR東日本は、鉄道・モバイルSuicaでの獲得と記載された利用先を案内しています。",
  ],
  [
    "JALの20%増量分1,200マイルは6,000マイルの本体交換とは分離した後日積算の研究データであり、抽選は算術対象外です。",
    "JALの20%増量分1,200マイルは6,000マイルの本体交換とは分離した後日積算の研究データであり、抽選は算術対象外です。",
  ],
  [
    "条件付きのモッピー4,500ポイントは本体交換と別の月1回リベートとして保持し、抽選は計算しません。",
    "条件付きのモッピー4,500ポイントは本体交換と別の月1回リベートとして保持し、抽選は計算しません。",
  ],
  [
    "本体はモッピーポイント12,000をJALマイル6,000へ交換する研究データとして保存し、増量・リベート・抽選を別扱いにします。",
    "本体はモッピーポイント12,000をJALマイル6,000へ交換する研究データとして保存し、増量・リベート・抽選を別扱いにします。",
  ],
  [
    "通常交換はモッピーポイント1,000をJALマイル500へ、最低1,000ポイントから手数料無料で交換します。",
    "通常交換はモッピーポイント1,000をJALマイル500へ、最低1,000ポイントから手数料無料で交換します。",
  ],
  [
    "ANA Payから楽天Edyへの経路は利用不可の情報エッジであり、変換ルールにはしません。",
    "ANA Payから楽天Edyへの経路は利用不可の情報エッジであり、変換ルールにはしません。",
  ],
  [
    "ANA PayからRevolutへの経路は利用不可の情報エッジであり、RevolutからANA Payへのカード決済とは方向が異なります。",
    "ANA PayからRevolutへの経路は利用不可の情報エッジであり、RevolutからANA Payへのカード決済とは方向が異なります。",
  ],
  [
    "JALマイレージパークのAmazon routeは2026年6月12日から停止中です。",
    "JALマイレージパークのAmazon routeは2026年6月12日から停止中です。",
  ],
  [
    "楽天市場はJALマイレージパーク経由で300円ごとに1マイル、積算は約3〜4か月後ですが、直前のポータル遷移が必要です。",
    "楽天市場はJALマイレージパーク経由で300円ごとに1マイル、積算は約3〜4か月後ですが、直前のポータル遷移が必要です。",
  ],
  [
    "JRキューポ10,000ポイントをセゾン永久不滅ポイント2,000ポイントへ交換します。JQ CARDセゾンが必要です。",
    "JRキューポ10,000ポイントをセゾン永久不滅ポイント2,000ポイントへ交換します。JQ CARDセゾンが必要です。",
  ],
  [
    "ANA PayへのチャージはKyashポイント還元対象外であり、報酬を計算しません。",
    "ANA PayへのチャージはKyashポイント還元対象外であり、報酬を計算しません。",
  ],
  [
    "Kyash VisaからANA Payへの経路は利用不可として扱い、実行ルールにはしません。",
    "Kyash VisaからANA Payへの経路は利用不可として扱い、実行ルールにはしません。",
  ],
  [
    "直接Vポイント交換は対象ANAカード会員の専用コースに限ります。",
    "直接Vポイント交換は対象ANAカード会員の専用コースに限ります。",
  ],
  [
    "JRキューポと永久不滅ポイントの交換にはJQ CARDセゾン等の明示条件があります。",
    "JRキューポと永久不滅ポイントの交換にはJQ CARDセゾン等の明示条件があります。",
  ],
  [
    "ANA交換の前提は既存の対象カード保有者であり、新規申込可否は推測しません。",
    "ANA交換の前提は既存の対象カード保有者であり、新規申込可否は推測しません。",
  ],
  [
    "このベンチマーク辺はRevolutカードを使うANA Pay決済に限り、保有資格を推測せず明示条件として扱います。",
    "このベンチマーク辺はRevolutカードを使うANA Pay決済に限り、保有資格を推測せず明示条件として扱います。",
  ],
  [
    "RevolutカードからANA Pay残高への額面1:1のfunding edgeとして表現し、報酬は算出しません。30日間合計10万円を超える決済は全体が失敗するためpartial_consumptionはfalseです。",
    "RevolutカードからANA Pay残高への額面1:1のfunding edgeとして表現し、報酬は算出しません。30日間合計10万円を超える決済は全体が失敗するためpartial_consumptionはfalseです。",
  ],
  [
    "みずほマイレージクラブカード/ANA向けに永久不滅ポイント2,000をANAマイル7,000へ交換します。",
    "みずほマイレージクラブカード/ANA向けに永久不滅ポイント2,000をANAマイル7,000へ交換します。",
  ],
  [
    "対象ANAカード会員のVポイントは5ポイントから5ポイント単位で5→3 ANAマイルです。",
    "対象ANAカード会員のVポイントは5ポイントから5ポイント単位で5→3 ANAマイルです。",
  ],
  [
    "Vポイント10,000をJRキューポ10,000へ交換するベンチマーク辺です。",
    "Vポイント10,000をJRキューポ10,000へ交換するベンチマーク辺です。",
  ],
] as const;

const SUMMARY_TRANSLATIONS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(SUMMARY_TRANSLATION_ENTRIES),
);

/** Number of checked-in source paraphrases with a Japanese translation. */
export const IMPLEMENTATION_SUMMARY_TRANSLATION_COUNT =
  Object.keys(SUMMARY_TRANSLATIONS).length;

const SUBJECT_MACHINE_PATTERN =
  /(?:[_]|\b(?:with|to|for|and|from|after|ordinary|regular|general|limited|use|payment|program|service|route|routes|catalog|directory|transfer|scope|benefit|shopping|stores?|products?|rewards?|earning|expiry|posting|conditions?|transactions?|methods?|value|partners?|account|exchange|accepted|classes?|activity|pay|PontaWeb|URL)\b)/iu;

export function localizeImplementationSubject(subject: string): string {
  const translated = SUBJECT_LABELS[subject];
  if (translated !== undefined) return translated;
  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(subject) &&
    !SUBJECT_MACHINE_PATTERN.test(subject)
  )
    return subject;
  return "このサービス";
}

function safeFallbackSubject(subject: string): string {
  const normalized = localizeImplementationSubject(subject.trim());
  return normalized.length > 160 ? "このサービス" : normalized;
}

export function localizeImplementationPredicate(predicate: string): string {
  return PREDICATE_LABELS[predicate] ?? "適用条件";
}

export function localizeImplementationSummary(
  summary: string,
  subject: string,
  claim: string,
  family = "ポイント情報",
): string {
  const translated = SUMMARY_TRANSLATIONS[summary];
  if (translated !== undefined) return translated;
  const safeSubject = safeFallbackSubject(subject);
  const safeFamily =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(family)
      ? family
      : "ポイント情報";
  return `「${safeSubject}」の${safeFamily}・${claim}に関する情報です。`;
}
