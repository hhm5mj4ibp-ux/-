# 完全無料（スリープ許容）でオンライン対戦を使う手順

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

