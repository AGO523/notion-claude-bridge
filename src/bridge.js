// エントリポイント: Notion ⇔ GitHub を双方向に同期する。
// 5分おきの GitHub Actions cron（.github/workflows/bridge.yml）から実行される。
//
// ① 依頼            → ページ本文を Markdown 化して Issue 起票 → Issue作成済
// ② Issue作成済 / 実装中 → Claude の質問を検出 → 質問あり（AI質問に書き戻し + コメント通知）
// ③ 回答済          → AI回答を Issue にコメント転送 → 実装中
import { config } from './config.js';
import {
  STATUS,
  fetchTasksByStatus,
  fetchPageMarkdown,
  updatePage,
  notifyPage,
} from './notion.js';
import { createIssue, getQuestionState, postAnswerComment } from './github.js';

let failed = 0;

function logError(task, phase, err) {
  failed += 1;
  console.error(`  [${phase}] 失敗 "${task.title}": ${err.message}`);
}

// 失敗時の共通処理: AIステータスを 失敗 にしてページにコメントで理由を残す
async function markFailed(task, message) {
  try {
    await updatePage(task.pageId, { status: STATUS.failed });
    await notifyPage(task.pageId, `処理に失敗しました: ${message}`);
  } catch (updateErr) {
    console.error(`  Notion 更新も失敗: ${updateErr.message}`);
  }
}

// ① 依頼 → Issue 起票
const requestedTasks = await fetchTasksByStatus(STATUS.requested);
console.log(`依頼: ${requestedTasks.length} 件`);

for (const task of requestedTasks) {
  console.log(`起票: "${task.title}" → ${config.targetRepo}`);
  try {
    // 多重起票ガード: 先に 起票中 へ遷移させる
    await updatePage(task.pageId, { status: STATUS.claiming });

    // 要件はページ本文に書かれている（実運用の形式に合わせる）
    const requirements = await fetchPageMarkdown(task.pageId);
    if (!requirements) {
      throw new Error('ページ本文が空です。要件をページ本文に記載してください');
    }

    const issue = await createIssue(task.title, requirements);
    await updatePage(task.pageId, {
      status: STATUS.issueCreated,
      issueUrl: issue.url,
    });
    console.log(`  Issue 作成: ${issue.url}`);
  } catch (err) {
    logError(task, '起票', err);
    await markFailed(task, err.message);
  }
}

// ② Claude の質問を検出して Notion に書き戻す
for (const status of [STATUS.issueCreated, STATUS.inProgress]) {
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
        logError(task, '質問検出', new Error(`質問ラウンドが上限（${config.maxQuestionRounds}回）を超えました`));
        await markFailed(task, `質問ラウンドが上限（${config.maxQuestionRounds}回）を超えました。Issue を直接確認してください。`);
        continue;
      }

      await updatePage(task.pageId, {
        status: STATUS.needsInfo,
        questions: state.latestQuestion,
      });
      await notifyPage(
        task.pageId,
        'Claude から実装前の質問があります。AI質問 を確認し、AI回答 に回答を記入して AIステータス を 回答済 に変更してください。',
      );
      console.log(`質問検出: "${task.title}"（${state.questionCount} ラウンド目）`);
    } catch (err) {
      logError(task, '質問検出', err);
    }
  }
}

// ③ 回答を Issue に転送して実装を再開させる
const answeredTasks = await fetchTasksByStatus(STATUS.answered);
for (const task of answeredTasks) {
  if (!task.issueUrl) continue;
  if (!task.answer) {
    // AI回答 未記入のまま 回答済 に変更されたケース。次回実行まで待つ
    console.log(`回答待ち（AI回答 が空）: "${task.title}"`);
    continue;
  }
  try {
    await postAnswerComment(task.issueUrl, task.answer);
    await updatePage(task.pageId, { status: STATUS.inProgress });
    console.log(`回答転送: "${task.title}"`);
  } catch (err) {
    logError(task, '回答転送', err);
  }
}

if (failed > 0) {
  process.exitCode = 1;
}
