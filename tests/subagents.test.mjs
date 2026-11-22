import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { aggregateSubagentTotals, estimateRequestsCost, shortSubagentModel, summarizeSubagentSession } from '../lib/subagents.mjs';
import { parseSessionData } from '../sidecars/inspector/main.mjs';

test('shortSubagentModel, summarizeSubagentSession, and aggregateSubagentTotals compute accurate subagent metrics', () => {
  assert.equal(shortSubagentModel('Gemini 4 Hydrogen (High)'), 'Hydrogen');
  assert.equal(shortSubagentModel('Gemini 4 Neon (XHigh)'), 'Neon');
  assert.equal(shortSubagentModel('Gemini 4 Krypton (High)'), 'Krypton');
  assert.equal(shortSubagentModel('Gemini 5 Nova'), 'Nova');
  assert.equal(shortSubagentModel('Gemini 3.8 Flash (High)'), '3.8 Flash');
  assert.equal(shortSubagentModel('gemini-3.8-flash'), '3.8 Flash');
  assert.equal(shortSubagentModel('Gemini 4.5 Flash Lite'), '4.5 Flash Lite');
  assert.equal(shortSubagentModel('Gemini 3.1 Pro (Medium)'), '3.1 Pro');
  assert.equal(shortSubagentModel('Claude Sonnet 4.5 (Thinking)'), 'Sonnet 4.5');
  assert.equal(shortSubagentModel('Orchestrator (Argon)'), 'Orchestrator');
  assert.equal(shortSubagentModel('DeepSeek R2 (High)'), 'DeepSeek R2');
  assert.equal(shortSubagentModel('未知模型'), '');

  const rates = [
    { model: 'gemini-4-hydrogen', input: 0.5, output: 3, cache: 0.05 },
    { model: 'gemini-4-neon', input: 3, output: 15, cache: 0.15 }
  ];
  assert.ok(estimateRequestsCost([{ model: 'Gemini 4 Neon (High)', inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }], rates) === 3);
  assert.equal(estimateRequestsCost([], rates), 0);
  assert.equal(estimateRequestsCost([{ model: 'unknown-model', inputTokens: 1000, outputTokens: 100 }], rates), null);
  const s1 = summarizeSubagentSession({
    conversationId: 'sub-1',
    modelName: 'Gemini 4 Hydrogen (High)',
    contextWindow: { usedTokens: 25600, maxTokens: 512000, usedPercent: 5, categories: [] },
    telemetry: { totalTokens: 78500, inputTokens: 25600, cacheReadTokens: 49150, outputTokens: 3750, cacheHitPercent: 65.7, requestCount: 4, errorCount: 0, toolCount: 3, tps: 54.8 },
    requests: [{ model: 'Gemini 4 Hydrogen (High)', inputTokens: 25600, cacheReadTokens: 49150, outputTokens: 3750 }]
  }, rates);
  assert.equal(s1.shortModel, 'Hydrogen');
  assert.ok(s1.costUsd > 0.02 && s1.costUsd < 0.03);

  const s2 = summarizeSubagentSession({
    conversationId: 'sub-2',
    modelName: 'Gemini 4 Neon (High)',
    contextWindow: { usedTokens: 12000, maxTokens: 1000000, usedPercent: 1.2, categories: [] },
    telemetry: { totalTokens: 21000, inputTokens: 10000, cacheReadTokens: 10000, outputTokens: 1000, cacheHitPercent: 50, requestCount: 2, errorCount: 1, toolCount: 2, tps: 42 },
    requests: [{ model: 'Gemini 4 Neon (High)', inputTokens: 10000, cacheReadTokens: 10000, outputTokens: 1000 }]
  }, rates);

  const totals = aggregateSubagentTotals([s1, s2]);
  assert.equal(totals.count, 2);
  assert.equal(totals.totalTokens, 99500);
  assert.equal(totals.requestCount, 6);
  assert.equal(totals.errorCount, 1);
  assert.equal(totals.toolCount, 5);
  assert.equal(totals.cacheHitPercent, 62.4);
  assert.ok(totals.costUsd > s1.costUsd);
});

test('parseSessionData aggregates tokens, cache hit rate, and tool count for SYSTEM_MESSAGE-rooted subagents', () => {
  const appData = mkdtempSync(join(tmpdir(), 'agy-subagent-parse-'));
  const prevDir = process.env.ANTIGRAVITY_APP_DATA_DIR;
  process.env.ANTIGRAVITY_APP_DATA_DIR = appData;
  try {
    const subId = 'subagent-001';
    const logsDir = join(appData, 'brain', subId, '.system_generated', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const lines = [
      { step_index: 0, type: 'SYSTEM_MESSAGE', content: 'You are a browser subagent', created_at: '2026-11-21T00:00:00Z' },
      { step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 10000, cache_read_tokens: 0, output_tokens: 500, tool_calls: [{ name: 'webview_browser', args: {} }], created_at: '2026-11-21T00:00:01Z' },
      { step_index: 2, type: 'GENERIC', content: 'Created At: 2026-11-21T00:00:02Z\nCompleted At: 2026-11-21T00:00:05Z\npage loaded', created_at: '2026-11-21T00:00:02Z' },
      { step_index: 3, type: 'PLANNER_RESPONSE', input_tokens: 5000, cache_read_tokens: 10000, output_tokens: 300, tool_calls: [{ name: 'send_message', args: {} }], created_at: '2026-11-21T00:00:06Z' },
      { step_index: 4, type: 'GENERIC', content: 'Created At: 2026-11-21T00:00:07Z\nCompleted At: 2026-11-21T00:00:08Z\nsent', created_at: '2026-11-21T00:00:07Z' }
    ];
    writeFileSync(join(logsDir, 'transcript.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const parsed = parseSessionData(subId, { includeSessions: false, strict: true });
    assert.equal(parsed.conversationId, subId);
    assert.equal(parsed.turns.length, 0);
    assert.equal(parsed.telemetry.stepCount, 5);
    assert.equal(parsed.telemetry.inputTokens, 15000);
    assert.equal(parsed.telemetry.cacheReadTokens, 10000);
    assert.equal(parsed.telemetry.outputTokens, 800);
    assert.equal(parsed.telemetry.totalTokens, 25800);
    assert.equal(parsed.telemetry.cacheHitPercent, 40);
    assert.equal(parsed.telemetry.toolCount, 2);
    assert.equal(parsed.telemetry.toolTimeMs, 4000);
  } finally {
    if (prevDir === undefined) delete process.env.ANTIGRAVITY_APP_DATA_DIR;
    else process.env.ANTIGRAVITY_APP_DATA_DIR = prevDir;
    rmSync(appData, { recursive: true, force: true });
  }
});

test('native-client subagents helper collects direct and nested subagents and clicks native subagent-node on openSubagent', () => {
  let clickedId = '';
  const summaries = {
    'main-1': { status: 1, stepCount: 10, trajectoryMetadata: { parentConversationId: '', rootConversationId: 'main-1', nestingDepth: 0 } },
    'sub-a': { status: 2, killed: false, stepCount: 6, summary: 'Browse page', trajectoryMetadata: { parentConversationId: 'main-1', rootConversationId: 'main-1', nestingDepth: 1, createdAt: { seconds: '200' }, subagentSpec: { typeName: 'browser', role: 'X Post Reader' } } },
    'sub-b': { status: 1, killed: true, stepCount: 4, summary: 'Child worker', trajectoryMetadata: { parentConversationId: 'sub-a', rootConversationId: '', nestingDepth: 2, createdAt: { seconds: '250' }, subagentSpec: { typeName: 'research', role: 'Doc Scanner' } } },
    'other-sub': { status: 1, stepCount: 2, trajectoryMetadata: { parentConversationId: 'main-2', rootConversationId: 'main-2', nestingDepth: 1 } }
  };
  const nodeA = { dataset: { cascadeId: 'sub-a' }, click() { clickedId = 'sub-a'; } };
  const store = { getState: () => ({ trajectorySummaries: { summaries } }), dispatch() {} };
  const rootEl = { '__reactFiber$fixture': { tag: 10, type: {}, memoizedProps: { value: { store } }, return: null } };
  const ctx = vm.createContext({
    document: {
      querySelector: () => rootEl,
      querySelectorAll: sel => sel.includes('subagent-node') ? [nodeA] : []
    }
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), ctx);
  const adapter = ctx.__agyNativeAdapter;

  const list = adapter.subagents('main-1');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'sub-a');
  assert.equal(list[0].title, 'X Post Reader');
  assert.equal(list[0].status, 'running');
  assert.equal(list[1].id, 'sub-b');
  assert.equal(list[1].depth, 2);
  assert.equal(list[1].status, 'killed');

  assert.equal(adapter.openSubagent('sub-a'), true);
  assert.equal(clickedId, 'sub-a');
});
