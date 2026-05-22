---
name: harbin-autofix
description: >-
  Autonomously triage and fix Harbin Mahjong bugs in harbin-mahjong.html and
  server/online-server.mjs using game DB backlog, verify-hand-layout, and ADR
  logging. Use when the user asks for autonomous QA, multi-agent fix loops,
  /loop maintenance, or harbin-autofix.
---

# Harbin Mahjong — 自律 QA・修正

## 着手前（必須）

1. `ゲームDB/00_ゲームDBインデックス.md` の **読む順** で `01`→`05` を読む。
2. `ゲームDB/04_ルール仕様_コード対応.md` でルールとコードの対応を確認。
3. `ゲームDB/05_バックログ.md` の P0/P1 を最優先。バックログに無いバグは severity で並べ、**最大3件**まで修正。

## 触ってよいファイル

- `harbin-mahjong.html`
- `server/online-server.mjs`
- `ゲームDB/90_決定ログ.md`（仕様・挙動変更時のみ）
- `ゲームDB/05_バックログ.md`（状態更新のみ、必要時）

## マルチエージェント分割

| 子タイプ | 役割 |
|----------|------|
| `explore` | バグ・仕様ズレの洗い出し（readonly） |
| `shell` | `node scripts/verify-hand-layout.mjs`、サーバ起動確認 |
| `ci-investigator` | PR の失敗チェック1件（PR作業時） |

親エージェントは探索結果を統合し、**最小 diff** で修正する。

## 禁止（ルール・デザイン不変）

- `ゲームDB/04` の和了・配牌・先出後引きルールは変更しない。
- `TILE_*_POS`・牌画像の見た目（スプライト内容）は変更しない。配布用ファイル名・URL のみ可。

## 完了条件（すべて満たすまで未完了）

```bash
npm run verify:all
```

（`build` → `verify:assets` → `verify:post-deal` → `verify:layout`）

- 失敗時はレイアウト回帰を直してから再実行。
- 仕様・挙動を変えたら `ゲームDB/90_決定ログ.md` に **日付・一行・理由**（ADR形式可）。
- **git commit / push はユーザーが明示したときのみ。**

## オンライン未対応（触らない／隠すのみ）

- 自家暗槓・加槓（ADR-042）のサーバ実装は別タスク。オンラインでボタンを出さない。
- 同一 `playerId` 再参加（BL-002）は未実装。切断時は AI 代打＋再接続バナーで継続。

## 報告フォーマット

1. 修正した issue（ID・ファイル）
2. 検証コマンド結果
3. 未着手（バックログ・探索残り）
4. コミット要否（ユーザー判断）
