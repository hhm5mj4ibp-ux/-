# 完全無料（スリープ許容）でオンライン対戦を使う手順

## 0) フロントを Vercel にデプロイ（このリポジトリの最新版をウェブで開く）

このプロジェクトは **静的 HTML**（`index.html` → `harbin-mahjong.html`）なので、Vercel では **フレームワークなし（Other）** でそのまま配信できます。

### GitHub にプッシュ済みの場合（推奨）

1. [Vercel](https://vercel.com) にログインする。
2. **Add New… → Project** で該当リポジトリを **Import** する。
3. 設定は次のとおり（多くは自動で問題ありません）。
   - **Framework Preset**: `Other`（または「No framework」に相当するもの）
   - **Root Directory**: `./`（リポジトリ直下）
   - **Build Command**: `npm run build`（`package.json` の空ビルド。変更しなくてよい）
   - **Output Directory**: 空欄のまま（プロジェクトルートをそのまま公開）
4. **Deploy** を押す。
5. 完了後に表示される **`https://＜プロジェクト名＞.vercel.app`** が本番 URL。`/` で `index.html` が開き、すぐ `harbin-mahjong.html` に入ります。

**同梱が必要なアセット**: ルートの `7198.png` と、演出用に参照している PNG（リポジトリに含まれているもの）がデプロイ対象に含まれていることを確認してください。

### CLI でデプロイする場合

ローカルに Node/npm がある環境で、リポジトリのルートで:

```bash
npx vercel@latest
```

初回はログインとプロジェクト紐付けの対話が出ます。本番反映は:

```bash
npx vercel@latest --prod
```

---

## 1) サーバーをRender無料に置く

このリポジトリには `render.yaml` を追加済みなので、Render側でほぼ自動設定されます。

1. Renderにログイン
2. `New +` → `Blueprint`
3. このリポジトリを選択
4. `Apply` で作成
5. デプロイ完了後、公開URL（例: `https://harbin-mahjong-online.onrender.com`）を控える

> 無料プランはスリープします。初回復帰に少し時間がかかることがあります。

## 2) Vercel側（フロント）で接続先を設定

1. VercelのゲームURLを開く
2. タイトル画面の `オンライン対戦` セクション
3. `サーバーURL設定` を押す
4. RenderのURLを貼る（末尾スラッシュなし）
   - 例: `https://harbin-mahjong-online.onrender.com`

この値はブラウザに保存されるので、次回以降もそのまま使えます。

## 3) 動作確認

Render URLでヘルスチェック:

`/api/health` が `{"ok":true,...}` を返せばOKです。

例:

`https://harbin-mahjong-online.onrender.com/api/health`

