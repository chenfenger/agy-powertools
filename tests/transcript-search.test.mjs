import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchTranscripts } from '../lib/transcript-search.mjs';

function writeTranscript(appDataDir, id, steps, mtimeSecOffset = 0) {
  const dir = join(appDataDir, 'brain', id, '.system_generated', 'logs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'transcript.jsonl');
  writeFileSync(file, steps.map(s => JSON.stringify(s)).join('\n') + '\n', 'utf8');
  const ts = new Date(Date.now() + mtimeSecOffset * 1000);
  utimesSync(file, ts, ts);
  return file;
}

test('searchTranscripts matches prompts, replies, fenced code, and run_command calls with turn jump indices and scope filtering', () => {
  const appDataDir = mkdtempSync(join(tmpdir(), 'agy-search-'));
  try {
    writeTranscript(appDataDir, 'conv-alpha', [
      {
        step_index: 0,
        type: 'USER_INPUT',
        created_at: '2026-11-20T10:00:00Z',
        content: '<USER_REQUEST>\n排查数据库连接超时问题\n</USER_REQUEST>'
      },
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-20T10:00:05Z',
        content: '先抓一下端口监听状态。',
        tool_calls: [{ name: 'run_command', args: { CommandLine: '"lsof -iTCP:5432 -sTCP:LISTEN"' } }]
      },
      {
        step_index: 4,
        type: 'USER_INPUT',
        created_at: '2026-11-20T10:02:00Z',
        content: '<USER_REQUEST>\n怎么设置连接池参数？\n</USER_REQUEST>'
      },
      {
        step_index: 5,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-20T10:02:10Z',
        content: '建议配置如下：\n```ts\nconst pool = createPool({ maxConnections: 32, idleTimeoutMs: 15000 });\n```\n这样可以避免空闲断连。'
      }
    ], 10);

    writeTranscript(appDataDir, 'sub-noise', [
      {
        step_index: 0,
        type: 'USER_INPUT',
        created_at: '2026-11-20T10:03:00Z',
        content: '<USER_REQUEST>\ncreatePool internal subagent\n</USER_REQUEST>'
      }
    ], 20);

    assert.equal(searchTranscripts('a', { appDataDir }).results.length, 0);

    const cjkHit = searchTranscripts('排查', { appDataDir });
    assert.equal(cjkHit.results.length, 1);
    assert.equal(cjkHit.results[0].conversationId, 'conv-alpha');
    assert.equal(cjkHit.results[0].turnNumber, 1);
    assert.equal(cjkHit.results[0].stepIndexStart, 0);
    assert.equal(cjkHit.results[0].kind, 'prompt');

    const cmdHit = searchTranscripts('5432', { appDataDir, scope: 'code' });
    assert.equal(cmdHit.results.length, 1);
    assert.equal(cmdHit.results[0].kind, 'command');
    assert.equal(cmdHit.results[0].turnNumber, 1);
    assert.equal(cmdHit.results[0].stepIndexStart, 0);
    assert.equal(cmdHit.results[0].copyText, 'lsof -iTCP:5432 -sTCP:LISTEN');

    assert.equal(searchTranscripts('5432', { appDataDir, scope: 'text' }).results.length, 0);

    const codeFiltered = searchTranscripts('createPool', {
      appDataDir,
      scope: 'code',
      excludeIds: ['sub-noise']
    });
    assert.equal(codeFiltered.results.length, 1);
    assert.equal(codeFiltered.results[0].conversationId, 'conv-alpha');
    assert.equal(codeFiltered.results[0].turnNumber, 2);
    assert.equal(codeFiltered.results[0].stepIndexStart, 4);
    assert.equal(codeFiltered.results[0].kind, 'code');
    assert.match(codeFiltered.results[0].copyText, /maxConnections: 32/);

    const byAllowlist = searchTranscripts('createPool', {
      appDataDir,
      conversationIds: ['conv-alpha', '../evil-traversal']
    });
    assert.equal(byAllowlist.results.length, 1);
    assert.equal(byAllowlist.results[0].conversationId, 'conv-alpha');
  } finally {
    rmSync(appDataDir, { recursive: true, force: true });
  }
});

test('searchTranscripts slices oversized files from tail and enforces per-conversation and global result caps', () => {
  const appDataDir = mkdtempSync(join(tmpdir(), 'agy-search-tail-'));
  try {
    const filler = 'x'.repeat(2048);
    const steps = [];
    for (let i = 0; i < 10; i++) {
      steps.push({ step_index: i * 2, type: 'USER_INPUT', content: `<USER_REQUEST>padding ${i} ${filler}</USER_REQUEST>` });
      steps.push({ step_index: i * 2 + 1, type: 'PLANNER_RESPONSE', content: `reply ${i} uniqueTailToken` });
    }
    writeTranscript(appDataDir, 'conv-large', steps);

    const res = searchTranscripts('uniqueTailToken', {
      appDataDir,
      maxFileBytes: 4096,
      tailBytes: 8192,
      maxPerConversation: 2
    });
    assert.equal(res.results.length, 2);
    assert.ok(res.results.every(r => r.conversationId === 'conv-large'));
  } finally {
    rmSync(appDataDir, { recursive: true, force: true });
  }
});
