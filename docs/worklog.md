# 作業記録

新しい作業をしたら日付ごとに追記する。最新が上。

## 2026-06-04

### 決定事項

- **サンドボックスは `AGO523/iwashi` に決定**（プライベートリポジトリ）

### 完了

- [x] Notion にテスト DB「開発依頼（テスト）」を作成（実運用と同構成 + 自動化用4プロパティ）
- [x] Notion Internal Integration（コネクト）`notion-claude-bridge` を発行、DB に接続
- [x] ローカルで事前チェック実行（DB 接続 / プロパティ型 / 本文 Markdown 変換、すべて OK）
  - つまずき: DB ID の控え間違いで object_not_found → API の search で正しい ID を特定して解決

### 次にやること

- [ ] GitHub Fine-grained PAT 発行（iwashi 限定、Issues: Read and write）
- [ ] iwashi 側: branch protection / Claude GitHub App / ANTHROPIC_API_KEY / claude.yml 設置
- [ ] ローカルで `npm run bridge` → Issue 起票 → Draft PR の E2E 確認
- [ ] 本体リポジトリの Secrets / Variables 登録、cron 稼働開始

## 2026-06-03（4回目）

### 決定事項

- **実運用の Notion サンプル（開発依頼チケット「ファンド告知メールの自動化」）を確認し、スキーマを全面見直し**
  - 要件詳細はプロパティではなく**ページ本文**に書かれている
    → ブリッジがブロックを Markdown に変換して Issue 本文にする方式へ変更
  - 既存 DB の `ステータス` はチームの進捗管理に使用中
    → 自動化用の状態は混ぜず、**`AIステータス` プロパティを別途追加**
  - 既存 DB への追加は4つだけ: `AIステータス` / `Issue URL` / `AI質問` / `AI回答`（すべて日本語名）
  - AIステータスの値も日本語: `依頼` → `起票中` → `Issue作成済` → `質問あり` → `回答済` → `実装中` / `失敗`
  - タイトル列は名前ではなく型（title）で探す（DB ごとの列名差異に対応）
  - 対象リポジトリはプロパティをやめて env `TARGET_REPO` に固定（横展開時にプロパティ化）
  - `error` プロパティを廃止し、`失敗` ステータス + ページコメントでの通知に統合
  - ページ本文の画像・添付は Issue に転記しない（Notion の URL は約1時間で失効するため）

### 完了

- [x] `src/notion.js` — ページ本文の Markdown 変換（見出し/リスト/コード等、ネスト3階層）、
      日本語プロパティ定数（PROPS / STATUS）への一元化
- [x] `src/github.js` — TARGET_REPO 対応、Issue 本文 = ページ本文 Markdown
- [x] `src/bridge.js` — 日本語ステータスでの3フェーズ処理、失敗時のコメント通知
- [x] `.github/workflows/bridge.yml` — `vars.TARGET_REPO` を追加
- [x] `docs/handoff.md` — スキーマ・遷移図・準備手順を改訂

### 次にやること

- [ ] Step 2: Notion DB に自動化用プロパティ4つを追加 + Integration 発行、PAT 発行、
      Secrets / Variables 登録
- [ ] Step 3: サンドボックスリポジトリの選定と claude-code-action セットアップ
- [ ] Step 4: E2E 検証

## 2026-06-03（3回目）

### 決定事項

- **Q&A ループを実装**: Claude が要件に不明点を見つけた場合、Notion 上で質疑応答できる仕組み
  - Claude は Issue に `❓QUESTIONS` コメント + `needs-clarification` ラベルで質問（Issue 本文の指示で制御）
  - ブリッジが質問を検出して Notion の `questions` に書き戻し、status を `needs_info` に
  - 作業者が `answer` に回答して status を `answered` にすると、ブリッジが Issue にコメント転送
    （@claude メンション付きなので claude-code-action が再起動）→ `in_progress`
  - 質問ラウンド上限は3回（超過で failed）
- Notion への通知は**ページへのコメント追加のみ**（メンションは使わない方針）
- Notion スキーマに `questions` / `answer`（Rich text）と
  status 選択肢 `needs_info` / `answered` / `in_progress` を追加

### 完了

- [x] `src/notion.js` — status 別取得の汎用化、questions 書き込み、コメント追加（notifyPage）
- [x] `src/github.js` — 質問コメント検出（getQuestionState）、回答転送（postAnswerComment）
- [x] `src/bridge.js` — 起票・質問検出・回答転送の3フェーズ構成に拡張
- [x] `docs/handoff.md` — スキーマ・status 遷移・Q&A ループを反映

### 次にやること

- [ ] Step 2: Notion DB 作成（questions / answer 含む）+ Integration 発行、PAT 発行、Secrets 登録
- [ ] Step 3: サンドボックスリポジトリの選定と claude-code-action セットアップ
- [ ] Step 4: E2E 検証（質問が出るケース・出ないケースの両方）

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
