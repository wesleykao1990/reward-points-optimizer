-- Prewarm major Tokyo launch areas with exact branch identity and immediately usable
-- payment/point compatibility. Coordinates are intentionally left for runtime
-- enrichment when no clean first-party coordinate is available.

begin;

insert into app_private.entities (entity_key, entity_type, display_name, locale, metadata)
values
  ('merchant.familymart','merchant','FamilyMart','ja-JP','{"launch_seed":"tokyo_major_areas"}'::jsonb),
  ('merchant.lawson','merchant','Lawson','ja-JP','{"launch_seed":"tokyo_major_areas"}'::jsonb),
  ('merchant.mcdonalds','merchant','McDonald''s Japan','ja-JP','{"launch_seed":"tokyo_major_areas"}'::jsonb),
  ('merchant.newdays','merchant','NewDays','ja-JP','{"launch_seed":"tokyo_major_areas"}'::jsonb),
  ('instrument.payment.credit_card_general','payment_interface','Credit card','ja-JP','{"category":"card"}'::jsonb),
  ('instrument.wallet.barcode_generic','qr_wallet','Barcode / QR payment','ja-JP','{"category":"qr_generic"}'::jsonb),
  ('instrument.wallet.paypay','qr_wallet','PayPay','ja-JP','{}'::jsonb),
  ('instrument.wallet.rakutenpay','qr_wallet','Rakuten Pay','ja-JP','{}'::jsonb),
  ('instrument.wallet.dbarai','qr_wallet','d払い','ja-JP','{}'::jsonb),
  ('instrument.wallet.aupay','qr_wallet','au PAY','ja-JP','{}'::jsonb),
  ('instrument.wallet.famipay','qr_wallet','FamiPay','ja-JP','{}'::jsonb),
  ('instrument.wallet.aeonpay','qr_wallet','AEON Pay','ja-JP','{}'::jsonb),
  ('instrument.wallet.merpay','qr_wallet','merpay','ja-JP','{}'::jsonb),
  ('instrument.wallet.smartcode','qr_wallet','Smart Code','ja-JP','{}'::jsonb),
  ('instrument.wallet.jcoinpay','qr_wallet','J-Coin Pay','ja-JP','{}'::jsonb),
  ('instrument.wallet.alipay','qr_wallet','Alipay','ja-JP','{}'::jsonb),
  ('instrument.wallet.wechatpay','qr_wallet','WeChat Pay','ja-JP','{}'::jsonb),
  ('instrument.emoney.transit_ic','electronic_money','Transit IC (Suica/PASMO etc.)','ja-JP','{}'::jsonb),
  ('instrument.emoney.id','electronic_money','iD','ja-JP','{}'::jsonb),
  ('instrument.emoney.quicpay','electronic_money','QUICPay','ja-JP','{}'::jsonb),
  ('instrument.emoney.rakuten_edy','electronic_money','Rakuten Edy','ja-JP','{}'::jsonb),
  ('instrument.emoney.waon','electronic_money','WAON','ja-JP','{}'::jsonb),
  ('instrument.emoney.pitapa','electronic_money','PiTaPa','ja-JP','{}'::jsonb),
  ('program.jp.dpoint','loyalty_program','d Point','ja-JP','{}'::jsonb),
  ('program.jp.rakutenpoint','loyalty_program','Rakuten Point','ja-JP','{}'::jsonb),
  ('program.jp.vpoint','loyalty_program','V Point','ja-JP','{}'::jsonb),
  ('program.jp.ponta','loyalty_program','Ponta','ja-JP','{}'::jsonb),
  ('program.jp.jrepoint','loyalty_program','JRE POINT','ja-JP','{}'::jsonb)
on conflict (entity_key) do update
set display_name = excluded.display_name,
    locale = coalesce(app_private.entities.locale, excluded.locale),
    metadata = app_private.entities.metadata || excluded.metadata,
    updated_at = now();

update app_private.entities set display_name='7-Eleven', locale='ja-JP', updated_at=now()
where entity_key='merchant.seveneleven';
update app_private.entities set display_name='nanaco', locale='ja-JP', updated_at=now()
where entity_key='instrument.jp.nanaco';

with locations(location_key, merchant_key, display_name, address, external_ids, confidence, metadata) as (
values
  ('tokyo.shinjuku.familymart.shinjuku-shintoshin','merchant.familymart','FamilyMart 新宿新都心店',
   '{"postal_code":"160-0023","prefecture":"東京都","city":"新宿区","street":"西新宿1-20-2","country_code":"JP"}'::jsonb,
   '{"familymart_store_id":"77204"}'::jsonb,'official_directory',
   '{"launch_area":"shinjuku","source_url":"https://store.family.co.jp/points/77204","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.shinjuku.lawson.h-nishishinjuku','merchant.lawson','Lawson H 西新宿',
   '{"postal_code":"160-0023","prefecture":"東京都","city":"新宿区","street":"西新宿1-23-1","country_code":"JP"}'::jsonb,
   '{}'::jsonb,'official_directory',
   '{"launch_area":"shinjuku","source_url":"https://www.lawson.co.jp/service/others/in/lang/en.html","source_kind":"official_directory","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.shinjuku.mcdonalds.nishi-shinjuku-ekimae','merchant.mcdonalds','McDonald''s 西新宿駅前店',
   '{"postal_code":"160-0023","prefecture":"東京都","city":"新宿区","street":"西新宿6-2-19","country_code":"JP"}'::jsonb,
   '{"mcdonalds_store_id":"13595"}'::jsonb,'official_directory',
   '{"launch_area":"shinjuku","source_url":"https://map.mcdonalds.co.jp/map/13595","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.shinjuku.newdays.shinjuku','merchant.newdays','NewDays 新宿',
   '{"prefecture":"東京都","city":"新宿区","station":"新宿駅","site_detail":"B1F 東改札外コンコース","country_code":"JP"}'::jsonb,
   '{"jr_cross_code":"1048000"}'::jsonb,'official_directory',
   '{"launch_area":"shinjuku","source_url":"https://shop.jr-cross.co.jp/eki/spot/detail?code=1048000","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.shinjuku.seveneleven.shinjuku-1chome','merchant.seveneleven','7-Eleven 新宿1丁目',
   '{"postal_code":"162-0022","prefecture":"東京都","city":"新宿区","street":"新宿1-28-10","country_code":"JP"}'::jsonb,
   '{"google_place_id":"ChIJDwGrFeiMGGARLCeEfqSx1T0"}'::jsonb,'third_party',
   '{"launch_area":"shinjuku","source_kind":"runtime_provider","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),

  ('tokyo.shibuya.familymart.shibuya-meijidori','merchant.familymart','FamilyMart 渋谷明治通り店',
   '{"postal_code":"150-0002","prefecture":"東京都","city":"渋谷区","street":"渋谷3-12-22","country_code":"JP"}'::jsonb,
   '{"familymart_store_id":"23103"}'::jsonb,'official_directory',
   '{"launch_area":"shibuya","source_url":"https://store.family.co.jp/points/23103","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.shibuya.lawson.shibuya-dogenzakaue','merchant.lawson','Lawson 渋谷道玄坂上',
   '{"postal_code":"150-0044","prefecture":"東京都","city":"渋谷区","street":"円山町19-1","country_code":"JP"}'::jsonb,
   '{}'::jsonb,'official_directory',
   '{"launch_area":"shibuya","source_url":"https://www.lawson.co.jp/service/others/in/lang/en.html","source_kind":"official_directory","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.shibuya.mcdonalds.center-gai','merchant.mcdonalds','McDonald''s 渋谷センター街店',
   '{"postal_code":"150-0042","prefecture":"東京都","city":"渋谷区","street":"宇田川町28-15","country_code":"JP"}'::jsonb,
   '{"mcdonalds_store_id":"13092"}'::jsonb,'official_directory',
   '{"launch_area":"shibuya","source_url":"https://map.mcdonalds.co.jp/mcdonalds/map/13092","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.shibuya.newdays.shibuya-shinminami','merchant.newdays','NewDays 渋谷新南改札内',
   '{"prefecture":"東京都","city":"渋谷区","station":"渋谷駅","site_detail":"2F 新南改札内","country_code":"JP"}'::jsonb,
   '{"jr_cross_code":"1044400"}'::jsonb,'official_directory',
   '{"launch_area":"shibuya","source_url":"https://shop.jr-cross.co.jp/eki/spot/detail?code=1044400","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.shibuya.seveneleven.uguisudanicho','merchant.seveneleven','7-Eleven 渋谷鶯谷町',
   '{"postal_code":"150-0032","prefecture":"東京都","city":"渋谷区","street":"鶯谷町19-15","country_code":"JP"}'::jsonb,
   '{"google_place_id":"ChIJzd8vryGLGGARyNptfbafyA8"}'::jsonb,'third_party',
   '{"launch_area":"shibuya","source_kind":"runtime_provider","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),

  ('tokyo.marunouchi.familymart.shin-kokusai-bldg','merchant.familymart','FamilyMart 丸の内新国際ビル店',
   '{"postal_code":"100-0005","prefecture":"東京都","city":"千代田区","street":"丸の内3-4-1","site_detail":"新国際ビル B1F","country_code":"JP"}'::jsonb,
   '{}'::jsonb,'official_directory',
   '{"launch_area":"tokyo_marunouchi","source_url":"https://www.marunouchi.com/tenants/7366/","source_kind":"official_directory","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.marunouchi.lawson.kitte','merchant.lawson','Lawson KITTE 丸の内',
   '{"postal_code":"100-7090","prefecture":"東京都","city":"千代田区","street":"丸の内2-7-2","site_detail":"JPタワー B1F","country_code":"JP"}'::jsonb,
   '{"google_place_id":"ChIJG6NSNvqLGGARqM9jJZk9M-c"}'::jsonb,'official_directory',
   '{"launch_area":"tokyo_marunouchi","source_url":"https://www.marunouchi.com/tenants/5086/","source_kind":"official_directory","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.marunouchi.mcdonalds.jr-tokyo','merchant.mcdonalds','McDonald''s JR東京駅店',
   '{"postal_code":"100-0005","prefecture":"東京都","city":"千代田区","street":"丸の内1-9-1","site_detail":"東京駅一番街","country_code":"JP"}'::jsonb,
   '{"mcdonalds_store_id":"13928"}'::jsonb,'official_directory',
   '{"launch_area":"tokyo_marunouchi","source_url":"https://map.mcdonalds.co.jp/map/13928","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.marunouchi.newdays.gransta-south','merchant.newdays','NewDays グランスタ丸の内南口',
   '{"postal_code":"100-0005","prefecture":"東京都","city":"千代田区","station":"東京駅","site_detail":"B1F 丸の内地下南口 改札外","country_code":"JP"}'::jsonb,
   '{"jr_cross_code":"1010222"}'::jsonb,'official_directory',
   '{"launch_area":"tokyo_marunouchi","source_url":"https://shop.jr-cross.co.jp/eki/spot/detail?code=1010222","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),

  ('tokyo.ikebukuro.familymart.east-meijidori','merchant.familymart','FamilyMart 池袋東口明治通り店',
   '{"postal_code":"171-0022","prefecture":"東京都","city":"豊島区","street":"南池袋1-19-6","site_detail":"オリックス池袋ビル","country_code":"JP"}'::jsonb,
   '{"familymart_store_id":"26795"}'::jsonb,'official_directory',
   '{"launch_area":"ikebukuro","source_url":"https://store.family.co.jp/points/26795","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.ikebukuro.lawson.higashi-ikebukuro','merchant.lawson','Lawson 東池袋',
   '{"postal_code":"170-0013","prefecture":"東京都","city":"豊島区","street":"東池袋1-31-10","country_code":"JP"}'::jsonb,
   '{}'::jsonb,'official_directory',
   '{"launch_area":"ikebukuro","source_url":"https://www.lawson.co.jp/service/others/in/lang/en.html","source_kind":"official_directory","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.ikebukuro.mcdonalds.east-exit','merchant.mcdonalds','McDonald''s 池袋東口店',
   '{"postal_code":"171-0022","prefecture":"東京都","city":"豊島区","street":"南池袋1-27-8","country_code":"JP"}'::jsonb,
   '{"mcdonalds_store_id":"13101"}'::jsonb,'official_directory',
   '{"launch_area":"ikebukuro","source_url":"https://map.mcdonalds.co.jp/map/13101","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.ikebukuro.newdays.ikebukuro','merchant.newdays','NewDays 池袋',
   '{"prefecture":"東京都","city":"豊島区","station":"池袋駅","site_detail":"1F 東口","country_code":"JP"}'::jsonb,
   '{"jr_cross_code":"1040188"}'::jsonb,'official_directory',
   '{"launch_area":"ikebukuro","source_url":"https://shop.jr-cross.co.jp/eki/spot/detail?code=1040188","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.ikebukuro.seveneleven.metropolitan-theatre','merchant.seveneleven','7-Eleven 池袋東京芸術劇場前',
   '{"postal_code":"171-0021","prefecture":"東京都","city":"豊島区","street":"西池袋3-26-5","country_code":"JP"}'::jsonb,
   '{"google_place_id":"ChIJXXk7FlyNGGARgI_KWD7ZVys"}'::jsonb,'third_party',
   '{"launch_area":"ikebukuro","source_kind":"runtime_provider","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),

  ('tokyo.ginza.familymart.matsuya-dori','merchant.familymart','FamilyMart 銀座松屋通り店',
   '{"postal_code":"104-0061","prefecture":"東京都","city":"中央区","street":"銀座3-10-9","country_code":"JP"}'::jsonb,
   '{"familymart_store_id":"77293"}'::jsonb,'official_directory',
   '{"launch_area":"ginza_yurakucho","source_url":"https://store.family.co.jp/points/77293","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.ginza.lawson.ginza-8chome','merchant.lawson','Lawson 銀座8丁目',
   '{"postal_code":"104-0061","prefecture":"東京都","city":"中央区","street":"銀座8-4-9","country_code":"JP"}'::jsonb,
   '{}'::jsonb,'official_directory',
   '{"launch_area":"ginza_yurakucho","source_url":"https://www.lawson.co.jp/service/others/in/lang/en.html","source_kind":"official_directory","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.ginza.mcdonalds.ginza-inz','merchant.mcdonalds','McDonald''s 銀座インズ店',
   '{"postal_code":"104-0061","prefecture":"東京都","city":"中央区","street":"銀座西1-2","site_detail":"銀座インズ3内","country_code":"JP"}'::jsonb,
   '{"mcdonalds_store_id":"13887"}'::jsonb,'official_directory',
   '{"launch_area":"ginza_yurakucho","source_url":"https://map.mcdonalds.co.jp/mcdonalds/map/13887","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.ginza.newdays.yurakucho-kyobashi','merchant.newdays','NewDays エキュートエディション有楽町京橋口',
   '{"postal_code":"100-0006","prefecture":"東京都","city":"千代田区","street":"有楽町2-9-12","site_detail":"1F 京橋口改札外","country_code":"JP"}'::jsonb,
   '{"google_place_id":"ChIJOfqRGSOLGGARLG1JVZA7KxY"}'::jsonb,'third_party',
   '{"launch_area":"ginza_yurakucho","source_kind":"runtime_provider","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.ginza.seveneleven.ginza-2','merchant.seveneleven','7-Eleven 銀座2丁目',
   '{"postal_code":"104-0061","prefecture":"東京都","city":"中央区","street":"銀座2-15-2","country_code":"JP"}'::jsonb,
   '{"google_place_id":"ChIJ065LTuCLGGARoRZzOqaGlVk"}'::jsonb,'third_party',
   '{"launch_area":"ginza_yurakucho","source_kind":"runtime_provider","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),

  ('tokyo.akihabara.familymart.akihabara-ekimae','merchant.familymart','FamilyMart 秋葉原駅前店',
   '{"postal_code":"101-0025","prefecture":"東京都","city":"千代田区","street":"神田佐久間町2-20-2","site_detail":"翔和秋葉原ビル","country_code":"JP"}'::jsonb,
   '{"familymart_store_id":"26588"}'::jsonb,'official_directory',
   '{"launch_area":"akihabara","source_url":"https://store.family.co.jp/points/26588","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.akihabara.lawson.suehirocho-ekimae','merchant.lawson','Lawson 末広町駅前',
   '{"postal_code":"101-0021","prefecture":"東京都","city":"千代田区","street":"外神田6-14-2","country_code":"JP"}'::jsonb,
   '{}'::jsonb,'official_directory',
   '{"launch_area":"akihabara","source_url":"https://www.lawson.co.jp/service/others/in/lang/en.html","source_kind":"official_directory","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.akihabara.mcdonalds.akihabara-ekimae','merchant.mcdonalds','McDonald''s 秋葉原駅前店',
   '{"postal_code":"101-0028","prefecture":"東京都","city":"千代田区","street":"神田相生町1","country_code":"JP"}'::jsonb,
   '{"mcdonalds_store_id":"13898"}'::jsonb,'official_directory',
   '{"launch_area":"akihabara","source_url":"https://map.mcdonalds.co.jp/map/13898","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb),
  ('tokyo.akihabara.newdays.mini-akihabara-1','merchant.newdays','NewDaysミニ 秋葉原1号',
   '{"postal_code":"101-0021","prefecture":"東京都","city":"千代田区","street":"外神田1-17-6","site_detail":"秋葉原駅 3F 5番線 総武線上りホーム中央","country_code":"JP"}'::jsonb,
   '{"jr_cross_code":"1063905"}'::jsonb,'official_directory',
   '{"launch_area":"akihabara","source_url":"https://shop.jr-cross.co.jp/eki/spot/detail?code=1063905","source_kind":"official_store_page","source_checked_at":"2026-08-23","coordinate_status":"pending_runtime_backfill"}'::jsonb)
)
insert into app_private.merchant_locations
(location_key, merchant_entity_id, display_name, address, external_place_ids, confidence, metadata, valid_from)
select l.location_key, e.id, l.display_name, l.address, l.external_ids, l.confidence, l.metadata, now()
from locations l join app_private.entities e on e.entity_key=l.merchant_key
on conflict (location_key) do update
set display_name=excluded.display_name,
    address=excluded.address,
    external_place_ids=app_private.merchant_locations.external_place_ids || excluded.external_place_ids,
    confidence=excluded.confidence,
    metadata=app_private.merchant_locations.metadata || excluded.metadata,
    valid_to=null,
    updated_at=now();

with chain_facts(merchant_key,instrument_key,action,source_family,confidence,derivation) as (
values
  ('merchant.familymart','instrument.wallet.famipay','pay','merchant.familymart',0.94,'direct'),
  ('merchant.familymart','instrument.payment.credit_card_general','pay','merchant.familymart',0.94,'direct'),
  ('merchant.familymart','instrument.wallet.barcode_generic','pay','merchant.familymart',0.86,'normalized'),
  ('merchant.familymart','instrument.emoney.transit_ic','pay','merchant.familymart',0.94,'direct'),
  ('merchant.familymart','instrument.emoney.rakuten_edy','pay','merchant.familymart',0.94,'direct'),
  ('merchant.familymart','instrument.emoney.waon','pay','merchant.familymart',0.94,'direct'),
  ('merchant.familymart','instrument.emoney.id','pay','merchant.familymart',0.94,'direct'),
  ('merchant.familymart','instrument.emoney.quicpay','pay','merchant.familymart',0.94,'direct'),
  ('merchant.familymart','program.jp.dpoint','earn','merchant.familymart',0.78,'inferred'),
  ('merchant.familymart','program.jp.dpoint','redeem','merchant.familymart',0.78,'inferred'),
  ('merchant.familymart','program.jp.rakutenpoint','earn','merchant.familymart',0.78,'inferred'),
  ('merchant.familymart','program.jp.rakutenpoint','redeem','merchant.familymart',0.78,'inferred'),
  ('merchant.lawson','instrument.wallet.aupay','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.wallet.dbarai','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.wallet.paypay','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.wallet.rakutenpay','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.wallet.aeonpay','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.wallet.merpay','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.wallet.smartcode','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.wallet.jcoinpay','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.emoney.transit_ic','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.emoney.id','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.emoney.quicpay','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.emoney.rakuten_edy','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.emoney.waon','pay','merchant.lawson',0.96,'direct'),
  ('merchant.lawson','instrument.emoney.pitapa','pay','merchant.lawson',0.90,'direct'),
  ('merchant.mcdonalds','instrument.wallet.dbarai','pay','merchant.mcdonalds',0.94,'direct'),
  ('merchant.mcdonalds','instrument.wallet.rakutenpay','pay','merchant.mcdonalds',0.94,'direct'),
  ('merchant.mcdonalds','instrument.wallet.paypay','pay','merchant.mcdonalds',0.94,'direct'),
  ('merchant.mcdonalds','instrument.wallet.aupay','pay','merchant.mcdonalds',0.94,'direct'),
  ('merchant.mcdonalds','instrument.emoney.id','pay','merchant.mcdonalds',0.94,'direct'),
  ('merchant.mcdonalds','instrument.emoney.rakuten_edy','pay','merchant.mcdonalds',0.94,'direct'),
  ('merchant.mcdonalds','instrument.emoney.waon','pay','merchant.mcdonalds',0.94,'direct'),
  ('merchant.mcdonalds','instrument.jp.nanaco','pay','merchant.mcdonalds',0.94,'direct'),
  ('merchant.mcdonalds','instrument.emoney.quicpay','pay','merchant.mcdonalds',0.94,'direct'),
  ('merchant.mcdonalds','instrument.emoney.transit_ic','pay','merchant.mcdonalds',0.94,'direct'),
  ('merchant.mcdonalds','instrument.payment.credit_card_general','pay','merchant.mcdonalds',0.94,'direct'),
  ('merchant.newdays','instrument.emoney.transit_ic','pay','merchant.newdays',0.92,'direct'),
  ('merchant.newdays','instrument.emoney.rakuten_edy','pay','merchant.newdays',0.92,'direct'),
  ('merchant.newdays','instrument.emoney.waon','pay','merchant.newdays',0.92,'direct'),
  ('merchant.newdays','instrument.jp.nanaco','pay','merchant.newdays',0.92,'direct'),
  ('merchant.newdays','instrument.emoney.id','pay','merchant.newdays',0.92,'direct'),
  ('merchant.newdays','instrument.emoney.quicpay','pay','merchant.newdays',0.92,'direct'),
  ('merchant.newdays','instrument.payment.credit_card_general','pay','merchant.newdays',0.92,'direct'),
  ('merchant.newdays','instrument.wallet.dbarai','pay','merchant.newdays',0.88,'direct'),
  ('merchant.newdays','instrument.wallet.paypay','pay','merchant.newdays',0.88,'direct'),
  ('merchant.newdays','instrument.wallet.aupay','pay','merchant.newdays',0.88,'direct'),
  ('merchant.newdays','instrument.wallet.rakutenpay','pay','merchant.newdays',0.88,'direct'),
  ('merchant.newdays','instrument.wallet.jcoinpay','pay','merchant.newdays',0.88,'direct'),
  ('merchant.newdays','instrument.wallet.alipay','pay','merchant.newdays',0.86,'direct'),
  ('merchant.newdays','instrument.wallet.wechatpay','pay','merchant.newdays',0.86,'direct'),
  ('merchant.seveneleven','instrument.wallet.barcode_generic','pay','merchant.seveneleven',0.85,'normalized'),
  ('merchant.seveneleven','instrument.payment.credit_card_general','pay','merchant.seveneleven',0.92,'normalized'),
  ('merchant.seveneleven','instrument.emoney.id','pay','merchant.seveneleven',0.92,'direct'),
  ('merchant.seveneleven','instrument.jp.nanaco','pay','merchant.seveneleven',0.96,'direct'),
  ('merchant.seveneleven','instrument.emoney.quicpay','pay','merchant.seveneleven',0.92,'direct'),
  ('merchant.seveneleven','instrument.emoney.rakuten_edy','pay','merchant.seveneleven',0.92,'direct'),
  ('merchant.seveneleven','instrument.emoney.transit_ic','pay','merchant.seveneleven',0.92,'normalized')
), resolved as (
select cf.*, me.id merchant_id, ie.id instrument_id,
       coalesce((select max(created_at) from app_private.p0_implementation_facts p where p.family_id=cf.source_family and p.claim_type='merchant_acceptance'), now()) as checked_at
from chain_facts cf
join app_private.entities me on me.entity_key=cf.merchant_key
join app_private.entities ie on ie.entity_key=cf.instrument_key
)
insert into app_private.merchant_acceptance_facts
(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_checked_at,confidence,derivation,provenance)
select
  'maf_' || regexp_replace(merchant_key,'[^a-z0-9_-]+','_','g') || '_' || action || '_' || regexp_replace(instrument_key,'[^a-z0-9_-]+','_','g'),
  merchant_id,instrument_id,action,'yes','chain_default','existing_implementation_fact',
  'p0:'||source_family||':merchant_acceptance',checked_at,confidence,derivation,
  jsonb_build_object('source_family',source_family,'trust_policy','active_on_collection','seed','tokyo_major_areas')
from resolved
on conflict (fact_key) do nothing;

insert into app_private.merchant_acceptance_facts
(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_checked_at,confidence,derivation,provenance)
select 'maf_familymart_'||x.action||'_vpoint', me.id, ie.id, x.action, 'yes','chain_default','existing_implementation_fact',
       'p0:point.v:familymart:'||x.action,
       coalesce((select max(created_at) from app_private.p0_implementation_facts where family_id='point.v' and subject='ファミリーマート'),now()),
       0.97,'direct',jsonb_build_object('trust_policy','active_on_collection','seed','tokyo_major_areas')
from (values ('earn'),('redeem')) x(action)
join app_private.entities me on me.entity_key='merchant.familymart'
join app_private.entities ie on ie.entity_key='program.jp.vpoint'
on conflict (fact_key) do nothing;

insert into app_private.merchant_acceptance_facts
(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,derivation,provenance)
select 'maf_lawson_'||x.program_slug||'_'||x.action,
       me.id, ie.id, x.action,'yes','chain_default',x.source_kind,x.source_ref,x.source_url,now(),x.confidence,'direct',
       jsonb_build_object('trust_policy','active_on_collection','seed','tokyo_major_areas')
from (values
  ('ponta','program.jp.ponta','earn','existing_implementation_fact','p0:point.ponta:lawson:earn',null::text,0.98::numeric),
  ('ponta','program.jp.ponta','redeem','existing_implementation_fact','p0:point.ponta:lawson:redeem',null::text,0.98::numeric),
  ('dpoint','program.jp.dpoint','earn','official_store_page','lawson:point-card-current','https://www.lawson.co.jp/lab/tsuushin/art/1505668_4659.html',0.98::numeric),
  ('dpoint','program.jp.dpoint','redeem','official_store_page','lawson:point-redemption-current','https://lawson-faq.lawson.co.jp/faq/show/444?category_id=8&site_domain=default',0.98::numeric)
) x(program_slug,instrument_key,action,source_kind,source_ref,source_url,confidence)
join app_private.entities me on me.entity_key='merchant.lawson'
join app_private.entities ie on ie.entity_key=x.instrument_key
on conflict (fact_key) do nothing;

with nd as (
  select ml.id location_id, ml.location_key, ml.merchant_entity_id,
         ml.metadata->>'source_url' source_url
  from app_private.merchant_locations ml
  join app_private.entities me on me.id=ml.merchant_entity_id
  where me.entity_key='merchant.newdays' and ml.metadata->>'launch_area' in ('shinjuku','shibuya','tokyo_marunouchi','ikebukuro','ginza_yurakucho','akihabara')
), specs(instrument_key,action,suffix) as (
  values
    ('instrument.emoney.transit_ic','pay','pay_transit_ic'),
    ('instrument.payment.credit_card_general','pay','pay_credit_card'),
    ('program.jp.jrepoint','earn','earn_jrepoint')
)
insert into app_private.merchant_acceptance_facts
(fact_key,merchant_entity_id,merchant_location_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,derivation,provenance)
select 'maf_'||regexp_replace(nd.location_key,'[^a-z0-9_-]+','_','g')||'_'||specs.suffix,
       nd.merchant_entity_id,nd.location_id,ie.id,specs.action,'yes','branch','official_store_page',
       'jr-cross:'||nd.location_key,nd.source_url,now(),0.99,'direct',
       jsonb_build_object('source_display','JR East Cross Station store page','trust_policy','active_on_collection','seed','tokyo_major_areas')
from nd cross join specs join app_private.entities ie on ie.entity_key=specs.instrument_key
on conflict (fact_key) do nothing;

insert into app_private.merchant_enrichment_jobs
(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'runtime_place_lookup','coordinates',80,'pending',
       jsonb_build_object('reason','launch seed intentionally avoids invented geocodes','launch_area',ml.metadata->>'launch_area')
from app_private.merchant_locations ml
where ml.metadata->>'launch_area' in ('shinjuku','shibuya','tokyo_marunouchi','ikebukuro','ginza_yurakucho','akihabara')
  and ml.latitude is null and ml.longitude is null
on conflict (merchant_location_id,provider,enrichment_kind) do nothing;

insert into app_private.merchant_enrichment_jobs
(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'runtime_place_lookup','external_id',60,'pending',
       jsonb_build_object('reason','add durable provider place id on first live lookup','launch_area',ml.metadata->>'launch_area')
from app_private.merchant_locations ml
where ml.metadata->>'launch_area' in ('shinjuku','shibuya','tokyo_marunouchi','ikebukuro','ginza_yurakucho','akihabara')
  and ml.external_place_ids = '{}'::jsonb
on conflict (merchant_location_id,provider,enrichment_kind) do nothing;

commit;
