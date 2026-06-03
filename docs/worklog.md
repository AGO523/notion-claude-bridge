# 作業記録

新しい作業をしたら日付ごとに追記する。最新が上。

## 2026-06-03

### 決定事項

- システム全体の設計を確定（詳細は `docs/handoff.md`）
  - Cloud Run Job 1つ + Cloud Scheduler 構成（dispatcher Service は作らない）
  - Node.js 22 + 素の JavaScript、公式 SDK（`@notionhq/client` / `octokit`）
  - 状態管理は Notion の status プロパティのみで完結
- 本体リポジトリ名は `notion-claude-bridge` に決定、空で作成（Copilot jumpstart は不使用）
- サンドボックスは新規作成せず AGO523 の既存リポジトリを使う（選定は未完）
- セキュリティ方針を整理（Draft PR 必須 / branch protection / トークン最小権限 / allowed tools 最小化）

### 完了

- [x] 本体リポジトリ `AGO523/notion-claude-bridge` を作成、ghq で clone
- [x] `docs/handoff.md`（設計・タスクの引き継ぎドキュメント）作成
- [x] `docs/worklog.md`（このファイル）作成

### 次にやること

- [ ] サンドボックスにする既存リポジトリを決めて branch protection を設定
- [ ] Notion DB 作成 + Internal Integration 発行
- [ ] GitHub Fine-grained PAT 発行（Contents / Pull requests / Issues の Write のみ）
- [ ] Anthropic API キー確認
- [ ] Step 2: ローカル E2E スクリプトの実装開始
