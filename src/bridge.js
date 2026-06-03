// エントリポイント: Notion ⇔ GitHub を双方向に同期する。
// 5分おきの GitHub Actions cron（.github/workflows/bridge.yml）から実行される。
//
// ① pending      → Issue 起票 → issue_created
// ② issue_created / in_progress → Claude の質問を検出 → needs_info（questions に書き戻し）
// ③ answered     → 回答を Issue にコメント転送 → in_progress
import { config } from './config.js';
import { fetchTasksByStatus, updatePage, notifyPage } from './notion.js';
import { createIssue, getQuestionState, postAnswerComment } from './github.js';

let failed = 0;

function logError(task, phase, err) {
  failed += 1;
  console.error(`  [${phase}] 失敗 "${task.title}": ${err.message}`);
}

// ① pending → Issue 起票
const pendingTasks = await fetchTasksByStatus('pending');
console.log(`pending: ${pendingTasks.length} 件`);

for (const task of pendingTasks) {
  console.log(`起票: "${task.title}" → ${task.targetRepo}`);
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
    logError(task, '起票', err);
    try {
      await updatePage(task.pageId, { status: 'failed', error: err.message });
    } catch (updateErr) {
      console.error(`  Notion 更新も失敗: ${updateErr.message}`);
    }
  }
}

// ② Claude の質問を検出して Notion に書き戻す
for (const status of ['issue_created', 'in_progress']) {
  const tasks = await fetchTasksByStatus(status);
  for (const task of tasks) {
    if (!task.issueUrl) continue;
    try {
      const state = await getQuestionState(task.issueUrl);
      if (!state.latestQuestion) continue;

      // Notion に書き戻し済みの質問と同じなら何もしない（冪等性）。
      // Notion 側は 2000 文字で切り詰めて保存しているため、比較も同じ条件で行う
      if (state.latestQuestion.slice(0, 2000) === task.questions) continue;

      if (state.questionCount > config.maxQuestionRounds) {
        await updatePage(task.pageId, {
          status: 'failed',
          error: `質問ラウンドが上限（${config.maxQuestionRounds}回）を超えました。Issue を直接確認してください。`,
        });
        await notifyPage(task.pageId, '質問ラウンドが上限を超えたため failed にしました。Issue を直接確認してください。');
        continue;
      }

      await updatePage(task.pageId, {
        status: 'needs_info',
        questions: state.latestQuestion,
      });
      await notifyPage(
        task.pageId,
        'Claude から実装前の質問があります。questions を確認し、answer に回答を記入して status を answered に変更してください。',
      );
      console.log(`質問検出: "${task.title}"（${state.questionCount} ラウンド目）`);
    } catch (err) {
      logError(task, '質問検出', err);
    }
  }
}

// ③ 回答を Issue に転送して実装を再開させる
const answeredTasks = await fetchTasksByStatus('answered');
for (const task of answeredTasks) {
  if (!task.issueUrl) continue;
  if (!task.answer) {
    // answer 未記入のまま status だけ変更されたケース。次回実行まで待つ
    console.log(`回答待ち（answer が空）: "${task.title}"`);
    continue;
  }
  try {
    await postAnswerComment(task.issueUrl, task.answer);
    await updatePage(task.pageId, { status: 'in_progress' });
    console.log(`回答転送: "${task.title}"`);
  } catch (err) {
    logError(task, '回答転送', err);
  }
}

if (failed > 0) {
  process.exitCode = 1;
}
