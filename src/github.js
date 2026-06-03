import { Octokit } from 'octokit';
import { config } from './config.js';

const octokit = new Octokit({ auth: config.githubToken });

// Claude が質問コメントに付けるマーカー。ブリッジはこれを目印に検出する
export const QUESTION_MARKER = '❓QUESTIONS';
const CLARIFICATION_LABEL = 'needs-clarification';

// Issue 本文。@claude メンションで claude-code-action が起動する。
// セキュリティ上の制約（範囲外変更の禁止など）もここで明示する。
function buildIssueBody(task) {
  return [
    task.body,
    '',
    '---',
    '',
    '@claude この Issue の要件を実装して **Draft PR** を作成してください。',
    '',
    '制約:',
    '- この Issue に書かれた範囲外の変更は禁止',
    '- `.env*` / `.github/workflows/` / `package.json` などの依存・CI 定義ファイルの編集は禁止',
    '- branch protection を回避する操作は禁止',
    '- PR は必ず Draft で作成し、マージはしないこと',
    '',
    '不明点がある場合:',
    `- 要件に不明点や複数の解釈がある場合は、実装を進める前に「${QUESTION_MARKER}」で始まるコメントを1つ投稿し、質問を番号付きリストで列挙すること`,
    `- 質問を投稿した場合は \`${CLARIFICATION_LABEL}\` ラベルを付け、回答コメントが来るまで実装を中断すること`,
    '- 軽微な判断（命名・実装の細部など）は質問せず、PR の説明に仮定として明記すること',
  ].join('\n');
}

function parseRepo(targetRepo) {
  const [owner, repo] = (targetRepo ?? '').split('/');
  if (!owner || !repo) {
    throw new Error(`target_repo が owner/repo 形式ではありません: "${targetRepo}"`);
  }
  return { owner, repo };
}

// Notion に記録した issue_url から owner / repo / issue 番号を復元する
function parseIssueUrl(issueUrl) {
  const m = (issueUrl ?? '').match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!m) {
    throw new Error(`issue_url を解釈できません: "${issueUrl}"`);
  }
  return { owner: m[1], repo: m[2], issueNumber: Number(m[3]) };
}

// サンドボックスリポジトリに Issue を作成して URL を返す
export async function createIssue(task) {
  const { owner, repo } = parseRepo(task.targetRepo);

  const { data } = await octokit.rest.issues.create({
    owner,
    repo,
    title: task.title,
    body: buildIssueBody(task),
  });

  return { url: data.html_url, number: data.number };
}

// Issue 上の質問コメント（QUESTION_MARKER 始まり）を集計する
export async function getQuestionState(issueUrl) {
  const { owner, repo, issueNumber } = parseIssueUrl(issueUrl);

  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });

  const questions = comments.filter((c) => c.body?.startsWith(QUESTION_MARKER));
  return {
    latestQuestion: questions.at(-1)?.body ?? '',
    questionCount: questions.length,
  };
}

// 回答コメントを投稿する。@claude メンションで claude-code-action が再起動する
export async function postAnswerComment(issueUrl, answer) {
  const { owner, repo, issueNumber } = parseIssueUrl(issueUrl);

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: [
      '@claude 質問への回答です:',
      '',
      answer,
      '',
      'この回答を踏まえて実装を続行し、Draft PR を作成してください。',
    ].join('\n'),
  });

  // 回答済みの目印としてラベルを外す（無くてもエラーにしない）
  try {
    await octokit.rest.issues.removeLabel({
      owner,
      repo,
      issue_number: issueNumber,
      name: CLARIFICATION_LABEL,
    });
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}
