// env 読み込み・検証
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません`);
  }
  return value;
}

export const config = {
  notionToken: required('NOTION_TOKEN'),
  notionDatabaseId: required('NOTION_DATABASE_ID'),
  githubToken: required('BRIDGE_GITHUB_TOKEN'),
  // Issue を立てる対象リポジトリ（owner/repo 形式）。横展開時に Notion プロパティ化する
  targetRepo: required('TARGET_REPO'),
  // 1回の実行で処理する依頼数の上限
  maxTasksPerRun: Number(process.env.MAX_TASKS_PER_RUN ?? 5),
  // 質問ラウンド数の上限（超えたら 失敗 にして人間に差し戻す）
  maxQuestionRounds: Number(process.env.MAX_QUESTION_ROUNDS ?? 3),
};
