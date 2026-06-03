import { Client } from '@notionhq/client';
import { config } from './config.js';

const notion = new Client({ auth: config.notionToken });

// Notion の Rich text は 2000 文字制限があるため、書き込み前に切り詰める
const RICH_TEXT_LIMIT = 2000;

function plainText(richText) {
  return (richText ?? []).map((t) => t.plain_text).join('');
}

// 指定 status のページを取得してタスクの形に変換する
export async function fetchTasksByStatus(status) {
  const { results } = await notion.databases.query({
    database_id: config.notionDatabaseId,
    filter: { property: 'status', select: { equals: status } },
    page_size: config.maxTasksPerRun,
  });

  return results.map((page) => ({
    pageId: page.id,
    title: plainText(page.properties.title?.title),
    body: plainText(page.properties.body?.rich_text),
    targetRepo: page.properties.target_repo?.select?.name ?? '',
    issueUrl: page.properties.issue_url?.url ?? '',
    questions: plainText(page.properties.questions?.rich_text),
    answer: plainText(page.properties.answer?.rich_text),
  }));
}

// status / issue_url / questions / error をまとめて更新する
export async function updatePage(pageId, { status, issueUrl, questions, error }) {
  const properties = {};
  if (status) {
    properties.status = { select: { name: status } };
  }
  if (issueUrl) {
    properties.issue_url = { url: issueUrl };
  }
  if (questions) {
    properties.questions = {
      rich_text: [{ text: { content: questions.slice(0, RICH_TEXT_LIMIT) } }],
    };
  }
  if (error) {
    properties.error = {
      rich_text: [{ text: { content: error.slice(0, RICH_TEXT_LIMIT) } }],
    };
  }
  await notion.pages.update({ page_id: pageId, properties });
}

// ページにコメントを追加して作業者に知らせる
export async function notifyPage(pageId, message) {
  await notion.comments.create({
    parent: { page_id: pageId },
    rich_text: [{ text: { content: message.slice(0, RICH_TEXT_LIMIT) } }],
  });
}
