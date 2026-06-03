// エントリポイント: Notion の pending ページを GitHub Issue に起票する。
// 5分おきの GitHub Actions cron（.github/workflows/bridge.yml）から実行される。
import { fetchPendingTasks, updatePage } from './notion.js';
import { createIssue } from './github.js';

const tasks = await fetchPendingTasks();
console.log(`pending: ${tasks.length} 件`);

let failed = 0;

for (const task of tasks) {
  console.log(`処理中: "${task.title}" → ${task.targetRepo}`);
  try {
    // 多重起票ガード: 先に claiming へ遷移させる
    await updatePage(task.pageId, { status: 'claiming' });

    const issue = await createIssue(task);
    await updatePage(task.pageId, {
      status: 'issue_created',
      issueUrl: issue.url,
    });
    console.log(`  Issue 作成: ${issue.url}`);
  } catch (err) {
    failed += 1;
    console.error(`  失敗: ${err.message}`);
    try {
      await updatePage(task.pageId, { status: 'failed', error: err.message });
    } catch (updateErr) {
      // Notion 更新自体の失敗はログに残すだけ（claiming のまま残る）
      console.error(`  Notion 更新も失敗: ${updateErr.message}`);
    }
  }
}

if (failed > 0) {
  process.exitCode = 1;
}
