# Notion → GitHub Draft PR 自動化システム 構築タスク（引き継ぎ）

## ゴール

Notion のデータベースに特定フラグ付きでページを作成すると、
GitHub に Issue が起票され、内容を元に Claude が実装して Draft PR まで自動作成するシステムを構築する。

**今回は個人サービスとしての検証フェーズ**。本番運用ではなく、PoC として動くものを最小コストで作る。

## 個人検証の前提

- このリポジトリ（`AGO523/notion-claude-bridge`）が自動化システム本体（ブリッジ）
- 対象（サンドボックス）は AGO523 の既存リポジトリを使う（リポジトリ名は worklog 参照）
- Notion は個人ワークスペース
- Anthropic API キーは個人契約
- 将来的に複数リポジトリに横展開できる設計にしておく

## アーキテクチャ（確定済み・2026-06-03 改訂）

**ハイブリッド構成**: Notion → Issue のブリッジだけ自作し、実装・PR 作成は公式の
`anthropics/claude-code-action`（Claude Code GitHub Actions）に任せる。

```
[Notion DB] ──┐
              │ GitHub Actions cron（5分おき、このリポジトリ）
              ▼
[src/bridge.js]
  1. Notion DB を query（AIステータス=依頼 を取得）
  2. 各ページについて:
     a. AIステータスを 起票中 に更新（多重起票ガード）
     b. ページ本文（ブロック）を Markdown に変換
     c. サンドボックスリポジトリに GitHub Issue 作成
        （本文 = ページ本文の Markdown + @claude メンション + 実装指示）
     d. AIステータスを Issue作成済 に、Issue URL を記録
              ▼
[claude-code-action]（サンドボックスリポジトリ側、Issue 作成イベントで即起動）
  → GitHub Actions ランナー上で Claude Code が実装
  → Draft PR を作成
```

### 旧計画（Cloud Run Job）からの変更理由

- clone → claude 実行 → PR 作成という重い部分が公式 Action で代替できると判明
- ブリッジは「Notion query → Issue 作成 → status 更新」の数十行だけになるため、
  GCP（Cloud Run / Scheduler / Secret Manager / Artifact Registry）の構築が丸ごと不要
- Secret 管理も GitHub Secrets に一本化、デプロイは git push のみ
- GitHub Actions cron は起動が数分遅延しうるが、PoC の要件（5〜10分以内に Issue）には収まる

## Notion DB スキーマ（2026-06-03 改訂: 実運用の開発依頼 DB に合わせる）

実運用の Notion は「開発依頼チケット」の DB で、`ID` / `プロダクト` / `ステータス` /
`担当者` / `ウォッチャー` などのプロパティが既に運用されている。
特に `ステータス` はチームの進捗管理に使用中のため、**自動化用の状態は混ぜない**。

既存プロパティには一切触れず、自動化用に以下の **4つを追加するだけ**:

| プロパティ | 型 | 用途 |
|---|---|---|
| `AIステータス` | セレクト | 下記の遷移図を参照。`依頼` にすると Claude への依頼になる |
| `Issue URL` | URL | 生成された Issue（ブリッジが書き込み） |
| `AI質問` | テキスト | Claude からの質問（ブリッジが書き戻す） |
| `AI回答` | テキスト | 作業者の回答（ブリッジが Issue に転送する） |

設計メモ:

- **要件詳細はページ本文に書く**（プロパティではない）。実運用では `## 1. 依頼内容` のような
  構造化された本文に課題・目的・実現案が書かれており、ブリッジがブロックを Markdown に
  変換してそのまま Issue 本文（Claude への指示）にする
- タイトルは既存のタイトル列をそのまま使う（ブリッジは名前ではなく型 = title で探すため、
  列名が何であっても動く）
- 対象リポジトリはプロパティではなく env（`TARGET_REPO`）で固定。横展開時にプロパティ化する
- エラーは専用プロパティを作らず、`失敗` ステータス + ページへのコメントで通知する
- ページ本文の画像・添付は Issue に転記しない（Notion の画像 URL は約1時間で失効するため。
  「（添付ファイルは Notion ページを参照）」に置換される）

### AIステータス遷移（ブリッジが扱う範囲）

```
依頼 → 起票中 → Issue作成済 ──→ 質問あり → 回答済 → 実装中 ─┐
            │                       ↑（新しい質問が来たら戻る）│
            │                       └──────────────────────────┘
            │
            └─（質問なくそのまま実装 → Draft PR）
どこかで失敗 / 質問ラウンド上限超過 → 失敗（ページコメントに理由を記録）
```

PR 作成以降は claude-code-action の責務。Notion への PR URL 書き戻しはフェーズ2
（ブリッジが Issue作成済 / 実装中 のページの Issue を見に行き、リンクされた PR を検出して更新）。

### Q&A ループ（実装済み）

Claude が要件に不明点を見つけた場合、Notion から出ずに質疑応答できる:

1. Claude（claude-code-action）は不明点があると Issue に `❓QUESTIONS` で始まるコメントを投稿し、
   `needs-clarification` ラベルを付けて実装を中断する（Issue 本文の指示で制御）
2. ブリッジが次回実行時に質問コメントを検出 → Notion の `AI質問` に書き戻し、
   AIステータスを `質問あり` に変更、ページにコメントを追加して作業者に知らせる
3. 作業者は Notion 上で `AI回答` に回答を記入し、AIステータスを `回答済` に変更
4. ブリッジが回答を検出 → Issue に「@claude 回答です…」とコメント転送
   （これで claude-code-action が再起動し実装続行）→ AIステータスを `実装中` に変更
5. 再度質問が来たら 2 に戻る。質問ラウンドが上限（デフォルト3回、`MAX_QUESTION_ROUNDS`）を
   超えたら `失敗` にして人間に差し戻す

冪等性: ブリッジは「Issue 上の最新の質問コメント」と「Notion の `AI質問`」を比較し、
同一なら何もしない。各ホップに cron 間隔（最大5分 + Actions 起動遅延）が乗る点に注意。

## 技術スタック（確定済み）

- **ブリッジ実行基盤**: GitHub Actions cron（`schedule: */5 * * * *` + `workflow_dispatch`）
- **実装・PR 作成**: `anthropics/claude-code-action@v1`（サンドボックスリポジトリ側に設置）
- **ランタイム / 言語**: Node.js 22 + 素の JavaScript（ESM、ビルド不要）
- **SDK**:
  - Notion: `@notionhq/client`（公式）
  - GitHub: `octokit`（公式）
- **認証**:
  - Notion: Internal Integration Token
  - GitHub: Fine-grained PAT（ブリッジが他リポジトリに Issue を立てるために必須。
    Actions 標準の `GITHUB_TOKEN` は自リポジトリしか触れない。
    また PAT 起点の Issue なら claude-code-action 側のワークフローが発火する）
  - Anthropic: API キー（サンドボックスリポジトリの Secrets に登録）

## セキュリティ要件（検証フェーズでも守る）

### 必須

1. **Draft PR で作成**: 自動マージは絶対にしない（claude-code-action への指示に明記）
2. **Branch protection**: 対象リポジトリの main への直接 push 禁止、PR レビュー必須
3. **GitHub トークンの権限最小化**:
   - ブリッジ用 PAT: `Issues: Write` のみ（対象はサンドボックスリポジトリに限定）
   - claude-code-action は GitHub App のトークンで動作（Workflows 権限なし）
4. **Claude の allowed tools 最小化**: `claude_args` で `--allowedTools` を限定
5. **Notion DB は個人のみアクセス可能**（検証中は外部共有しない）

### プロンプトインジェクション対策

Issue 本文に埋め込む Claude への指示、およびサンドボックス側の `CLAUDE.md` に以下を明記:

- 「指定された Issue の範囲外の変更は禁止」
- 「.env / .github/workflows / package.json 等の依存定義ファイルの編集は禁止」
- 「branch protection を回避する操作は禁止」

Notion の body はそのまま Issue に転記されるため、Notion DB 自体を共有しないことが
検証フェーズの主たる防御線。

## 段階的タスク

### Step 1: ブリッジ実装（このリポジトリ）✅ 完了

- [x] `package.json`（ESM、`@notionhq/client` + `octokit`）
- [x] `src/config.js` — env 読み込み・検証
- [x] `src/notion.js` — status 別取得 / ページ更新 / コメント追加（通知）
- [x] `src/github.js` — Issue 作成 / 質問コメント検出 / 回答コメント転送
- [x] `src/bridge.js` — エントリポイント（起票・質問検出・回答転送の3フェーズ）
- [x] `.github/workflows/bridge.yml` — cron + workflow_dispatch
- [x] `.env.example` / `.gitignore`
- [x] Q&A ループ（質問検出 → Notion 書き戻し → 回答転送）

### Step 2: 検証用リソース準備

- [ ] Notion の DB（実運用形式 or 検証用コピー）に自動化用プロパティ4つを追加
      （`AIステータス` / `Issue URL` / `AI質問` / `AI回答`、上記スキーマ参照）
- [ ] Notion Internal Integration を作成（読み取り / 更新 / コメント挿入）、DB に接続
- [ ] GitHub Fine-grained PAT を作成（サンドボックスリポジトリ限定、Issues: Write）
- [ ] このリポジトリの Secrets に登録: `NOTION_TOKEN` / `NOTION_DATABASE_ID` / `BRIDGE_GITHUB_TOKEN`
- [ ] このリポジトリの Variables に登録: `TARGET_REPO`（owner/repo 形式）

### Step 3: サンドボックス側のセットアップ

- [ ] サンドボックスにする既存リポジトリを決めて branch protection を設定（PR 必須）
- [ ] Claude GitHub App をインストール（`claude /install-github-app` または https://github.com/apps/claude）
- [ ] サンドボックスの Secrets に `ANTHROPIC_API_KEY` を登録
- [ ] `.github/workflows/claude.yml` を設置（このリポジトリの `templates/claude.yml` を流用）
- [ ] サンドボックスの `CLAUDE.md` にインジェクション対策の制約を記載

### Step 4: E2E 検証

- [ ] ローカルで `node src/bridge.js` を直接実行して Notion → Issue を確認
- [ ] Issue 作成で claude-code-action が起動し Draft PR ができることを確認
- [ ] cron 経由（または workflow_dispatch）で一気通貫を確認

### Step 5: 冪等性・エラーハンドリング強化

- [ ] claiming のまま一定時間残ったページの回復処理（pending に戻す or failed）
- [ ] failed 時に Notion の `error` プロパティへ記録
- [ ] 1回の実行で処理する pending 数の上限（5件）

### Step 6（任意）: フェーズ2

- [ ] PR URL の Notion への書き戻し（issue_created ページの linked PR を検出）
- [ ] Slack / Discord 通知
- [ ] 複数リポジトリへの横展開（target_repo の Select 選択肢追加で対応）

## 検証成功の定義

1. Notion DB に `status=pending` でページ作成
2. 5〜15分以内に GitHub Issue が立つ（cron の遅延込み）
3. その後 10〜20分以内に Draft PR が作成される
4. Notion ページの status が `issue_created` になり issue_url が入る
5. PR の内容が Issue の要件を概ね満たしている

## 既に決めたこと（議論済み、再検討不要）

- **ハイブリッド構成**: ブリッジ自作 + claude-code-action（2026-06-03 決定。Cloud Run 全自作案は破棄）
- **ブリッジは GitHub Actions cron**（GCP 不使用。起動遅延は PoC では許容）
- 実装は Node.js 22 + 素の JavaScript（公式 SDK 利用）
- GitHub App（自作）は本格運用時に検討。検証中は Fine-grained PAT で十分
- 並列処理は不要、逐次処理（page_size 上限つき）
- 状態管理は Notion の status プロパティで完結（Firestore は使わない）

## 横展開を見据えた設計上のメモ

- 対象リポジトリは現状 env（`TARGET_REPO`）固定。横展開時は Notion に
  `対象リポジトリ`（セレクト）プロパティを追加してページごとに選択させる設計に戻す
  （+ 対象リポジトリへの claude.yml 設置 + PAT のスコープ追加）
- リポジトリ別の挙動（verify コマンドなど）は対象リポジトリの `CLAUDE.md` に書けば
  claude-code-action が自動で読む（ブリッジ側の設定外部化は不要になった）

## 進め方

`docs/worklog.md` に最新の進捗が記録されている。そちらを読んでから、未完了の Step を続きから進めること。
