# Notion → GitHub Draft PR 自動化システム 構築タスク（引き継ぎ）

## ゴール

Notion のデータベースに特定フラグ付きでページを作成すると、
GitHub に Issue が起票され、内容を元に Claude が実装して Draft PR まで自動作成するシステムを構築する。

**今回は個人サービスとしての検証フェーズ**。本番運用ではなく、PoC として動くものを最小コストで作る。

## 個人検証の前提

- GCP は個人アカウント / 個人プロジェクト
- このリポジトリ（`AGO523/notion-claude-bridge`）が自動化システム本体
- 対象（サンドボックス）は AGO523 の既存リポジトリを使う（リポジトリ名は worklog 参照）
- Notion は個人ワークスペース
- Anthropic API キーは個人契約
- 将来的に複数リポジトリに横展開できる設計にしておく

## アーキテクチャ（確定済み）

```
[Notion DB] ──┐
              │ Cloud Scheduler が5分おきに起動
              ▼
[Cloud Run Job (1つ)]
  1. Notion DB を query (status=pending を取得)
  2. 各ページについて:
     a. GitHub Issue 作成
     b. リポジトリを git clone
     c. claude -p ... (headless) で実装
     d. gh pr create --draft
     e. Notion ページの status を更新
```

- Service + Job 分割はせず、Job 1つで完結（個人検証なら十分）
- Cloud Run Job は Cloud Scheduler から直接起動可能なので dispatcher 不要
- 並列性は最初は逐次処理で OK。必要なら task parallelism で拡張

## Notion DB スキーマ

| プロパティ | 型 | 用途 |
|---|---|---|
| `title` | Title | Issue / PR タイトル |
| `body` | Rich text | 要件詳細 |
| `target_repo` | Select | 対象リポジトリ |
| `status` | Select | `pending` / `claiming` / `running` / `pr_created` / `done` / `failed` |
| `issue_url` | URL | 生成された Issue |
| `pr_url` | URL | 生成された Draft PR |
| `error` | Rich text | 失敗時のログ要約 |

## 技術スタック（確定済み）

- **インフラ**: Cloud Run Job + Cloud Scheduler + Secret Manager
- **ランタイム / 言語**: Node.js 22 + 素の JavaScript（ビルド不要、検証の回転速度優先）
- **SDK**:
  - Notion: `@notionhq/client`（公式）
  - GitHub: `octokit`（公式）
- **CLI同梱**: `claude`（Claude Code、npm でグローバルインストール）, `gh`（GitHub CLI）, `git`
- **認証**:
  - Notion: Internal Integration Token
  - GitHub: Fine-grained PAT（本格運用時に GitHub App へ切り替え）
  - Anthropic: API キー

### Node.js を選んだ理由（再検討不要）

- Notion / GitHub とも公式 SDK がある
- claude CLI 自体が Node.js 製なので、コンテナが1ランタイムで完結する
- ビルド不要で検証フェーズの回転が速い
- 将来 Claude Agent SDK（TS/JS）へ移行する道もそのまま

## セキュリティ要件（検証フェーズでも守る）

### 必須

1. **Draft PR で作成**: 自動マージは絶対にしない
2. **Branch protection**: 対象リポジトリの main への直接 push 禁止、PR レビュー必須
3. **GitHub トークンの権限最小化**: `Contents: Write`, `Pull requests: Write`, `Issues: Write` のみ。Workflows 権限なし
4. **Claude の allowed tools 最小化**: `Edit, Write, Read, Grep, Glob, Bash(限定コマンドのみ)`
5. **`.env*` の事前削除**: Claude セッション開始前にクリーンアップ
6. **Notion DB は個人のみアクセス可能**（検証中は外部共有しない）

### 推奨

- Cloud Run Job の egress を VPC で制限（個人検証では後回しでも可）
- Secret Manager で API キー管理（env 直書き禁止）
- Claude セッションログを GCS に保存

### プロンプトインジェクション対策

Claude へのシステムプロンプトに以下を明記:

- 「指定された Issue の範囲外の変更は禁止」
- 「.env / .github/workflows / package.json 等の依存定義ファイルの編集は禁止」
- 「branch protection を回避する操作は禁止」

## 段階的タスク

### Step 1: 検証用リソース準備

- [x] 本体リポジトリ作成（`AGO523/notion-claude-bridge`、空で作成 → ghq で clone 済み）
- [ ] サンドボックス（既存リポジトリ）の選定と branch protection 設定（PR 必須）
- [ ] Notion で検証用 DB を作成（上記スキーマ）
- [ ] Notion Internal Integration を作成、DB に share
- [ ] GitHub Fine-grained PAT を作成（権限最小）
- [ ] Anthropic API キー確認

### Step 2: ローカルで E2E が動くスクリプト作成

Cloud Run に上げる前に、ローカルで以下が一気通貫で動く Node.js スクリプトを書く:

- [ ] `@notionhq/client` で Notion DB を query して pending ページを取得
- [ ] `octokit` で GitHub Issue 作成
- [ ] 検証リポジトリを clone（child_process で git をシェルアウト）
- [ ] `claude -p` を headless 実行（child_process）
- [ ] `gh pr create --draft` で Draft PR 作成
- [ ] Notion 更新（status / issue_url / pr_url）

構成イメージ:

```
src/
├── main.js          # エントリポイント、pending ループ
├── notion.js        # Notion DB query / update
├── github.js        # Issue 作成 (octokit)
├── worker.js        # clone → claude 実行 → PR 作成
└── config.js        # env 読み込み
```

### Step 3: Dockerfile 作成

- [ ] ベースイメージ: `node:22-slim`
- [ ] `git`, `gh` CLI をインストール（apt）
- [ ] `npm install -g @anthropic-ai/claude-code`
- [ ] アプリを COPY して `npm ci`
- [ ] ENTRYPOINT: `node src/main.js`

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y git gh && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENTRYPOINT ["node", "src/main.js"]
```

### Step 4: Cloud Run Job にデプロイ

- [ ] Artifact Registry にイメージ push
- [ ] Secret Manager に API キー登録（`ANTHROPIC_API_KEY`, `NOTION_TOKEN`, `GITHUB_TOKEN`）
- [ ] Cloud Run Job 作成（Secret を env としてマウント）
- [ ] 手動実行（`gcloud run jobs execute`）で動作確認

### Step 5: Cloud Scheduler 設定

- [ ] 5分おきに Cloud Run Job を起動するスケジュール作成
- [ ] サービスアカウントに `roles/run.invoker` 付与

### Step 6: 冪等性・エラーハンドリング強化

- [ ] status 遷移を厳密に: `pending → claiming → running → pr_created → done`
- [ ] Job が途中で死んでも再開できるよう各ステップ前に Notion 更新
- [ ] failed 状態でエラー内容を Notion の `error` プロパティに記録
- [ ] 1回の Job 実行で処理する pending 数に上限を設ける（例: 5件）

### Step 7（任意）: 通知・運用

- [ ] Slack / Discord に Draft PR 作成通知
- [ ] 月次コストアラート設定

## 検証成功の定義

1. Notion DB に `status=pending` でページ作成
2. 5〜10分以内に GitHub Issue が立つ
3. その後 10〜20分以内に Draft PR が作成される
4. Notion ページの status が `done` になる
5. PR の内容が Issue の要件を概ね満たしている

## 既に決めたこと（議論済み、再検討不要）

- Service + Job 分割は不要、Job 1つで OK
- 実装は Node.js 22 + 素の JavaScript（公式 SDK 利用）
- GitHub App は本格運用時に切り替え。検証中は Fine-grained PAT で十分
- task parallelism は最初は不要、逐次処理から始める
- 状態管理は Notion の status プロパティで完結（Firestore は使わない）
- リポジトリ作成時の Copilot jumpstart は使わない（空で作成済み）

## 横展開を見据えた設計上のメモ

- `target_repo` を Notion 側で選択させる設計にしておけば、リポジトリ追加は Select 選択肢追加 + worker 側の設定追加だけで済む
- リポジトリ別の挙動（verify コマンドなど）は設定ファイル（YAML / JSON）で外部化できるようにしておく
- 個人検証では1つのリポジトリ固定で OK

## 進め方

`docs/worklog.md` に最新の進捗が記録されている。そちらを読んでから、未完了の Step を続きから進めること。
