import { activeKnowledgeItems, getSetting, listPendingTasks, openDb } from './db.js';
import { pollOnce } from './poll.js';
import { applyDecisionObject } from './tasks.js';
import { formatLocalTime } from './wecom.js';

const requirementTerms = [
  '需要',
  '希望',
  '建议',
  '优化',
  '增加',
  '新增',
  '修改',
  '调整',
  '支持',
  '自动',
  '不再依靠人工',
  '能不能',
  '可不可以'
];

const questionTerms = ['吗', '怎么', '如何', '是否', '能否', '可不可以', '可以', '规则', '流程', '在哪', '哪里', '怎么办', '?', '？'];

const ignorePatterns = [
  /^当前知识库未找到.+请人工确认/,
  /^可以，在.+设置.+置顶/,
  /^参考图片[:：]/,
  /!\[[^\]]*]\([^)]+\)/,
  /^(好|好的|嗯|收到|谢谢|ok|OK|哈哈|嘿嘿|测试|猜猜看)[。！!,.，\s]*$/
];

export function autoOnce({ hours = null, limit = null } = {}) {
  const pollResult = pollOnce({ hours });
  const processResult = processPendingTasks({ limit });
  return {
    ok: Boolean(pollResult.ok),
    poll: pollResult,
    processing: processResult
  };
}

export async function autoWatch() {
  for (;;) {
    const db = openDb();
    const interval = Number(getSetting(db, 'poll_interval_seconds', '30'));
    db.close();

    const result = autoOnce();
    console.log(JSON.stringify({ time: formatLocalTime(new Date()), ...result }));
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}

export function processPendingTasks({ limit = null } = {}) {
  const db = openDb();
  let tasks = [];
  let knowledge = [];
  try {
    if (getSetting(db, 'auto_process_enabled', 'true') !== 'true') {
      return {
        checked: 0,
        processed: 0,
        failed: 0,
        disabled: true,
        results: []
      };
    }
    const configuredLimit = Number(getSetting(db, 'auto_process_limit', '20'));
    const taskLimit = Number(limit || configuredLimit || 20);
    tasks = listPendingTasks(db, Math.max(1, Math.min(taskLimit, 100)));
    knowledge = activeKnowledgeItems(db, 200);
  } finally {
    db.close();
  }

  const results = [];
  for (const task of tasks) {
    const decision = classifyTask(task, knowledge);
    try {
      const applied = applyDecisionObject(decision);
      results.push({
        task_id: task.task_id,
        message_id: task.message_id,
        type: applied.type,
        confidence: applied.confidence
      });
    } catch (error) {
      results.push({
        task_id: task.task_id,
        message_id: task.message_id,
        type: decision.type,
        error: error.message
      });
    }
  }

  return {
    checked: tasks.length,
    processed: results.filter((item) => !item.error).length,
    failed: results.filter((item) => item.error).length,
    results
  };
}

function classifyTask(task, knowledge) {
  const content = String(task.content || '').trim();
  const ignored = shouldIgnore(content);
  if (ignored) {
    return {
      task_id: task.task_id,
      type: 'ignore',
      confidence: ignored.confidence,
      reason: ignored.reason
    };
  }

  const knowledgeMatch = findKnowledgeMatch(content, knowledge);
  if (knowledgeMatch) {
    return {
      task_id: task.task_id,
      type: 'question',
      confidence: knowledgeMatch.confidence,
      reason: `自动处理：命中知识库 #${knowledgeMatch.item.id}`,
      qa: {
        matched_knowledge_ids: [knowledgeMatch.item.id],
        answer: formatAnswer(knowledgeMatch.item.content)
      }
    };
  }

  if (isRequirement(content)) {
    return {
      task_id: task.task_id,
      type: 'requirement',
      confidence: 0.82,
      reason: '自动处理：消息表达了系统使用人员的业务诉求，按需求收集表先入库。',
      requirement: buildRequirement(content)
    };
  }

  return {
    task_id: task.task_id,
    type: 'manual_review',
    confidence: 0.45,
    reason: '自动处理：无法判断消息是否属于业务诉求、已有规则咨询或无关内容。'
  };
}

function shouldIgnore(content) {
  if (!content) {
    return { confidence: 0.95, reason: '空消息' };
  }
  for (const pattern of ignorePatterns) {
    if (pattern.test(content)) {
      return { confidence: 0.9, reason: '自动处理：系统回复、图片Markdown或无意义短句，避免重复处理。' };
    }
  }
  return null;
}

function findKnowledgeMatch(content, knowledge) {
  if (!looksLikeQuestion(content)) {
    return null;
  }

  let best = null;
  for (const item of knowledge) {
    const score = scoreKnowledge(content, item);
    if (!best || score > best.score) {
      best = { item, score };
    }
  }

  if (!best || best.score < 3) {
    return null;
  }

  return {
    item: best.item,
    confidence: Math.min(0.98, 0.72 + best.score * 0.06)
  };
}

function scoreKnowledge(content, item) {
  const normalizedContent = normalize(content);
  let score = 0;

  for (const phrase of [item.title, extractQuestion(item.content)]) {
    const normalizedPhrase = normalize(phrase);
    if (!normalizedPhrase || normalizedPhrase.length < 4) {
      continue;
    }
    if (normalizedContent.includes(normalizedPhrase) || normalizedPhrase.includes(normalizedContent)) {
      score += 4;
    }
  }

  for (const keyword of splitKeywords(item.keywords)) {
    const normalizedKeyword = normalize(keyword);
    if (normalizedKeyword.length >= 2 && normalizedContent.includes(normalizedKeyword)) {
      score += 1;
    }
  }

  return score;
}

function extractQuestion(content) {
  const match = String(content || '').match(/^问题[:：]\s*(.+)$/m);
  return match ? match[1].trim() : '';
}

function splitKeywords(keywords) {
  return String(keywords || '')
    .split(/[,\uFF0C;；、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[?？。；;，,！!：:]/g, '');
}

function looksLikeQuestion(content) {
  return questionTerms.some((term) => content.includes(term));
}

function isRequirement(content) {
  return requirementTerms.some((term) => content.includes(term));
}

function buildRequirement(content) {
  return {
    title: buildRequirementTitle(content),
    module: inferModule(content),
    description: `用户提出：${content}`,
    scenario: '系统使用人员在实际业务使用中提出该诉求，先作为需求收集记录入库。',
    expected_result: '由产品人员后续整理适用角色、业务规则、边界条件和验收口径。',
    priority: 'P2'
  };
}

function buildRequirementTitle(content) {
  const cleaned = content.replace(/[；;。.!！?？]+$/g, '').trim();
  return cleaned.length > 28 ? `${cleaned.slice(0, 28)}...` : cleaned || '未命名需求';
}

function inferModule(content) {
  const rules = [
    [['资金', '结算', '提现', '充值', '余额'], '资金账户管理'],
    [['账户', '权限', '离职'], '账户与权限管理'],
    [['回收商', '零售门店', '订单排序', '置顶'], '回收订单、排序'],
    [['报价', '估价'], '报价管理'],
    [['质检', '验机'], '质检管理'],
    [['上门', '预约'], '上门服务'],
    [['订单'], '订单管理']
  ];

  for (const [terms, module] of rules) {
    if (terms.some((term) => content.includes(term))) {
      return module;
    }
  }
  return '待产品整理';
}

function formatAnswer(content) {
  const answer = extractAnswer(content) || content;
  const formatted = answer.replace(/!\[([^\]]*)]\(([^)]+)\)/g, (_, alt, url) => {
    const label = alt && alt !== '图片说明' ? `参考图片（${alt}）` : '参考图片';
    return `${label}：${url}`;
  });
  return limitUtf8Bytes(formatted.trim(), 1900);
}

function extractAnswer(content) {
  const match = String(content || '').match(/^答案[:：]\s*([\s\S]+)$/m);
  return match ? match[1].trim() : '';
}

function limitUtf8Bytes(value, maxBytes) {
  let output = '';
  for (const char of String(value || '')) {
    if (Buffer.byteLength(output + char, 'utf8') > maxBytes) {
      return `${output}...`;
    }
    output += char;
  }
  return output;
}
