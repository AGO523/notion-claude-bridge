import { Client, collectPaginatedAPI } from '@notionhq/client';
import { config } from './config.js';

const notion = new Client({ auth: config.notionToken });

// 自動化用プロパティ（既存の運用 DB に追加する4つ。既存プロパティには一切触れない）
export const PROPS = {
  status: 'AIステータス',
  issueUrl: 'Issue URL',
  questions: 'AI質問',
  answer: 'AI回答',
};

// AIステータスの選択肢
export const STATUS = {
  requested: '依頼',
  claiming: '起票中',
  issueCreated: 'Issue作成済',
  needsInfo: '質問あり',
  answered: '回答済',
  inProgress: '実装中',
  failed: '失敗',
};

// Notion の Rich text は 2000 文字制限があるため、書き込み前に切り詰める
const RICH_TEXT_LIMIT = 2000;
// ページ本文のネスト読み取り深さの上限
const MAX_DEPTH = 3;

function plainText(richText) {
  return (richText ?? []).map((t) => t.plain_text).join('');
}

// 指定の AIステータスのページを取得してタスクの形に変換する
export async function fetchTasksByStatus(status) {
  const { results } = await notion.databases.query({
    database_id: config.notionDatabaseId,
    filter: { property: PROPS.status, select: { equals: status } },
    page_size: config.maxTasksPerRun,
  });

  return results.map((page) => {
    // タイトル列の名前は DB ごとに異なるため、型（title）で探す
    const titleProp = Object.values(page.properties).find((p) => p.type === 'title');
    return {
      pageId: page.id,
      title: plainText(titleProp?.title),
      issueUrl: page.properties[PROPS.issueUrl]?.url ?? '',
      questions: plainText(page.properties[PROPS.questions]?.rich_text),
      answer: plainText(page.properties[PROPS.answer]?.rich_text),
    };
  });
}

// AIステータス / Issue URL / AI質問 をまとめて更新する
export async function updatePage(pageId, { status, issueUrl, questions }) {
  const properties = {};
  if (status) {
    properties[PROPS.status] = { select: { name: status } };
  }
  if (issueUrl) {
    properties[PROPS.issueUrl] = { url: issueUrl };
  }
  if (questions) {
    properties[PROPS.questions] = {
      rich_text: [{ text: { content: questions.slice(0, RICH_TEXT_LIMIT) } }],
    };
  }
  await notion.pages.update({ page_id: pageId, properties });
}

// ページにコメントを追加して作業者に知らせる（エラー通知もこれを使う）
export async function notifyPage(pageId, message) {
  await notion.comments.create({
    parent: { page_id: pageId },
    rich_text: [{ text: { content: message.slice(0, RICH_TEXT_LIMIT) } }],
  });
}

// ページ本文（ブロック）を Markdown に変換して返す。
// 実運用では要件詳細はプロパティではなくページ本文に書かれているため、
// これがそのまま Issue 本文（Claude への指示）になる。
export async function fetchPageMarkdown(pageId) {
  const markdown = await blocksToMarkdown(pageId, 0, '');
  // 過剰な空行を詰める
  return markdown.replace(/\n{3,}/g, '\n\n').trim();
}

// リスト系ブロック（子はインデントして続ける）
const LIST_TYPES = new Set(['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle']);
// 子を辿らないブロック（サブページや表の中身までは送らない）
const NO_RECURSE_TYPES = new Set(['child_page', 'child_database', 'table']);

async function blocksToMarkdown(blockId, depth, indent) {
  const blocks = await collectPaginatedAPI(notion.blocks.children.list, {
    block_id: blockId,
  });

  const lines = [];
  for (const block of blocks) {
    const md = blockToMarkdown(block, indent);
    if (md) {
      // リスト以外は後ろに空行を入れて Markdown の段落として区切る
      lines.push(LIST_TYPES.has(block.type) ? md : `${md}\n`);
    }
    if (block.has_children && depth < MAX_DEPTH && !NO_RECURSE_TYPES.has(block.type)) {
      const childIndent = LIST_TYPES.has(block.type) ? `${indent}  ` : indent;
      lines.push(await blocksToMarkdown(block.id, depth + 1, childIndent));
    }
  }
  return lines.filter(Boolean).join('\n');
}

function richToMd(richText) {
  return (richText ?? [])
    .map((t) => (t.href ? `[${t.plain_text}](${t.href})` : t.plain_text))
    .join('');
}

function blockToMarkdown(block, indent) {
  const type = block.type;
  const data = block[type];
  const text = richToMd(data?.rich_text);

  switch (type) {
    case 'paragraph':
      return text ? indent + text : '';
    case 'heading_1':
      return `${indent}# ${text}`;
    case 'heading_2':
      return `${indent}## ${text}`;
    case 'heading_3':
      return `${indent}### ${text}`;
    case 'bulleted_list_item':
    case 'toggle':
      return `${indent}- ${text}`;
    case 'numbered_list_item':
      return `${indent}1. ${text}`;
    case 'to_do':
      return `${indent}- [${data.checked ? 'x' : ' '}] ${text}`;
    case 'quote':
    case 'callout':
      return `${indent}> ${text}`;
    case 'code':
      return `${indent}\`\`\`${data.language ?? ''}\n${text}\n${indent}\`\`\``;
    case 'divider':
      return `${indent}---`;
    case 'bookmark':
    case 'embed':
    case 'link_preview':
      return data.url ? `${indent}${data.url}` : '';
    // Notion の画像 URL は約1時間で失効するため、Issue には転記しない
    case 'image':
    case 'video':
    case 'file':
    case 'pdf':
      return `${indent}（添付ファイルは Notion ページを参照）`;
    case 'table':
      return `${indent}（表は Notion ページを参照）`;
    case 'child_page':
      return `${indent}（サブページ「${data.title ?? ''}」は Notion ページを参照）`;
    default:
      return text ? indent + text : '';
  }
}
