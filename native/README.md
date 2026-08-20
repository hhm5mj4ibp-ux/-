# Capacitor ストアシェル

Web 本体（`harbin-mahjong.html`）を App Store / Google Play に載せるための薄いシェルです。**アプリ内課金（IAP）は未接続**です。Web の Stripe は iOS 審査で使えないため、ストア公開時は StoreKit 2 / Google Play Billing（または RevenueCat）に切り替えます。

## 手順

1. リポジトリルートで `npm run build`（`public/` を生成）
2. このフォルダで:

```bash
cd native
npx --yes @capacitor/cli@6 add ios     # macOS + Xcode
npx --yes @capacitor/cli@6 add android
npx --yes @capacitor/cli@6 sync
```

3. Xcode / Android Studio でアイコンを `icons/icon-512.png` から設定する
4. ストア説明に「現金を賭けた対局はできません」と明記する

## 課金の切り替え

- Web: `server/shop.mjs` の Stripe Checkout
- ネイティブ: 同一 `playerId` でレシートを検証し、同じ entitlement トークンを発行する（未実装）
