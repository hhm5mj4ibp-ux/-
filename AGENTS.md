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
