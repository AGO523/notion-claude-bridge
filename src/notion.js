import { Client } from '@notionhq/client';
import { config } from './config.js';

const notion = new Client({ auth: config.notionToken });

function plainText(richText) {
  return (richText ?? []).map((t) => t.plain_text).join('');
}

// status=pending のページを取得してタスクの形に変換する
export async function fetchPendingTasks() {
  const { results } = await notion.databases.query({
    database_id: config.notionDatabaseId,
    filter: { property: 'status', select: { equals: 'pending' } },
    page_size: config.maxTasksPerRun,
  });

  return results.map((page) => ({
    pageId: page.id,
    title: plainText(page.properties.title?.title),
    body: plainText(page.properties.body?.rich_text),
    targetRepo: page.properties.target_repo?.select?.name ?? '',
  }));
}

// status / issue_url / error をまとめて更新する
export async function updatePage(pageId, { status, issueUrl, error }) {
  const properties = {};
  if (status) {
    properties.status = { select: { name: status } };
  }
  if (issueUrl) {
    properties.issue_url = { url: issueUrl };
  }
  if (error) {
    // Rich text は 2000 文字制限があるため切り詰める
    properties.error = {
      rich_text: [{ text: { content: error.slice(0, 2000) } }],
    };
  }
  await notion.pages.update({ page_id: pageId, properties });
}
