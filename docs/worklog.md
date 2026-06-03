# 作業記録

新しい作業をしたら日付ごとに追記する。最新が上。

## 2026-06-03（2回目）

### 決定事項

- **アーキテクチャを大幅に変更**: Cloud Run Job 全自作案を破棄し、ハイブリッド構成に
  - Notion → Issue のブリッジだけ自作（`src/bridge.js`）
  - 実装・Draft PR 作成は公式 `anthropics/claude-code-action@v1` に任せる
    （Issue 本文に @claude メンションを入れると Actions 上で Claude が実装して PR を作る）
  - ブリッジの実行基盤は GitHub Actions cron（5分おき）。GCP は使わない
  - 変更理由: 重い部分（clone / claude 実行 / PR 作成）が公式 Action で代替でき、
    インフラ構築・Dockerfile・Secret Manager が丸ごと不要になるため
- status 遷移を簡素化: `pending → claiming → issue_created / failed`
  （PR URL の Notion 書き戻しはフェーズ2）
- `develop` ブランチを作成し、以降の作業はそこで行う

### 完了

- [x] `docs/handoff.md` をハイブリッド構成に全面改訂
- [x] ブリッジ実装（Step 1）: `src/` 一式、`bridge.yml`、`templates/claude.yml`

### 次にやること

- [ ] Step 2: Notion DB 作成 + Internal Integration 発行、PAT 発行、Secrets 登録
- [ ] Step 3: サンドボックスリポジトリの選定と claude-code-action セットアップ
- [ ] Step 4: E2E 検証（ローカル実行 → cron 一気通貫）

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
