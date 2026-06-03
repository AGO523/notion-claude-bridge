import { Octokit } from 'octokit';
import { config } from './config.js';

const octokit = new Octokit({ auth: config.githubToken });

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
  ].join('\n');
}

// サンドボックスリポジトリに Issue を作成して URL を返す
export async function createIssue(task) {
  const [owner, repo] = task.targetRepo.split('/');
  if (!owner || !repo) {
    throw new Error(`target_repo が owner/repo 形式ではありません: "${task.targetRepo}"`);
  }

  const { data } = await octokit.rest.issues.create({
    owner,
    repo,
    title: task.title,
    body: buildIssueBody(task),
  });

  return { url: data.html_url, number: data.number };
}
