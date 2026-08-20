# エージェント向け（Cursor / Codex / 他）

このリポジトリは **哈尔滨麻雀（ハルビン麻雀）** のブラウザゲームです。実装の「正」は単一 HTML と Node サーバにあります。

## 最初に読む（順番固定）

1. `ゲームDB/00_ゲームDBインデックス.md` — ここに書かれた **読む順番** どおりにノートを読む。  
2. `ゲームDB/04_ルール仕様_コード対応.md` — ルールとコードの対応。  
3. `ゲームDB/02_製品アーキテクチャ.md` — ファイル配置と URL メンテ欄。

人間向けの Obsidian 運用は `オブシディアン取扱説明.md` と `00-ホーム.md` を参照。

## 触ってよい主なパス

| パス | 内容 |
|------|------|
| `harbin-mahjong.html` | UI・オフライン AI・オンライン UI |
| `server/online-server.mjs` | 部屋・SSE・合法手 |
| `scripts/vercel-static-build.mjs` | Vercel 用静的コピー |
| `DEPLOY_FREE.md` | デプロイ手順 |

## 仕様変更時

`ゲームDB/90_決定ログ.md` に **日付・一行・理由** を追記してから実装する。

## 自律 QA・修正ループ

`.cursor/skills/harbin-autofix/SKILL.md` を参照。探索は子エージェント、完了条件は `node scripts/verify-hand-layout.mjs`。

## Cursor Cloud specific instructions

環境依存の非自明な注意点のみ。標準コマンドは `package.json` の `scripts` を正とする。

- **ランタイム依存はゼロ、テスト依存は非宣言。** `package.json` に依存パッケージは無く（Node 組み込みのみ）、`npm install` はほぼ何もしない。ただし `verify:*`（`verify:all` 含む）は `playwright` + Chromium を必要とするのに **`package.json` に無い**。update script が `npm install --no-save playwright` と `npx playwright install --with-deps chromium` を実行して用意する（`~/.cache/ms-playwright` にキャッシュ）。ローカルで単発なら同じ2コマンドで復旧できる。
- **1プロセスで静的配信＋API。** `npm start`（= `node server/online-server.mjs`）が `http://localhost:8787` で `index.html`/`harbin-mahjong.html`/画像と、オンライン API（`/api/health`, `/api/rooms...`, SSE `.../events`）の両方を提供する。別途の静的サーバは不要。`PORT` 環境変数で変更可（Render は 10000）。
- **オフライン版が製品の核。** `harbin-mahjong.html` 単体（`file://` でも可）で AI 対局が完結し、`verify:*` はこの HTML を Playwright で開いて検証する。オンライン対戦のみ Node サーバが必須。
- **オンラインの席判定。** サーバは `connected !== false` の席を人間扱いし、それ以外は AI が自動打牌する（`isHumanSeat`）。SSE で接続するまで席は AI 扱いになる点に注意（API だけで start すると全席 AI で自動進行する）。
- **lint は無い。** ESLint/Prettier の設定や `lint` スクリプトは存在しない。
- **完了条件は `npm run verify:all`**（build → assets → post-deal → layout → side-parity → rules。Playwright 使用のため数分かかる）。
