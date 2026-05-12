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
   - **Output Directory**: Vercel ダッシュボードでは **`public`**（`vercel.json` の `outputDirectory` と一致）。ローカルでは `npm run build` で生成。
4. **Deploy** を押す。
5. 完了後に表示される **`https://＜プロジェクト名＞.vercel.app`** が本番 URL。`/` で `index.html` が開き、すぐ `harbin-mahjong.html` に入ります。

**同梱が必要なアセット**: ルートの `7198.png` と、演出用に参照している PNG（リポジトリに含まれているもの）がデプロイ対象に含まれていることを確認してください。

### CLI でデプロイする（「とにかくできる」ようにする手順）

**ポイントは 2 つだけです。** (1) パソコンに **Node.js（npm 付き）** を入れる、(2) **Vercel にログイン**してこのフォルダとプロジェクトを紐付ける。グローバルに `vercel` を入れる必要はありません（`npx` で毎回最新 CLI が使えます）。

#### 1. Node.js を入れる（まだなら）

- 公式: [https://nodejs.org/](https://nodejs.org/) の **LTS** をインストール  
- または macOS + Homebrew: `brew install node`

ターミナルで確認:

```bash
node -v
npm -v
```

どちらもバージョンが表示されれば OK です。

#### 2. Vercel にログイン（ブラウザで一度だけ）

リポジトリのルート（`package.json` がある場所）で:

```bash
npm run vercel:login
```

ブラウザが開くので、Vercel アカウントで承認します。

#### 3. このリポジトリと Vercel プロジェクトを紐付ける（初回だけ）

```bash
npm run vercel:link
```

対話で **既存の Vercel プロジェクトを選ぶ**か、**新規作成**できます。完了すると `.vercel/` に設定ができますが、**`.gitignore` に含まれているため Git には上がりません**（各自のマシンで一度ずつ `link` すればよいです）。

#### 4. 本番（Production）に反映する

```bash
npm run vercel:prod
```

プレビュー用にだけ試す場合:

```bash
npm run vercel:deploy
```

#### グローバルに CLI を入れたい場合（任意）

```bash
npm install -g vercel
vercel login
vercel link
vercel deploy --prod
```

#### 非対話（CI・Cursor など）でデプロイしたい場合

1. Vercel: [Account Settings → Tokens](https://vercel.com/account/tokens) で **Token を作成**  
2. 環境変数に設定: `export VERCEL_TOKEN=（発行した文字列）`  
3. プロジェクトは一度ローカルで `npm run vercel:link` 済みで `.vercel/project.json` があるか、または `--scope` / プロジェクト指定をドキュメント通りに付ける  
4. デプロイ:

```bash
npx --yes vercel@latest deploy --prod --token "$VERCEL_TOKEN"
```

GitHub Actions では Repository secrets に `VERCEL_TOKEN`（必要なら `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`）を入れ、上記コマンドを workflow で実行する形にします。

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

