import { test, expect } from '@playwright/test';
import { runtimeRequire } from '../../scripts/runtime-path.mjs';
const activationHost = runtimeRequire()('@deepseek-ai/dsh/package.json').version === '0.2.1-rc.5';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
let launcher, context, page, run, ready;
test.describe.configure({ mode: 'serial' });
let failed = false;
async function launch(resume = false) {
  rmSync(join(run, 'ready.json'), { force: true });
  launcher = spawn(process.execPath, ['scripts/gui-server.mjs', run, ...(resume ? ['--resume'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = ''; launcher.stdout.on('data', c => diagnostics += String(c)); launcher.stderr.on('data', c => diagnostics += String(c));
  const deadline = Date.now() + 150000;
  while (!existsSync(join(run, 'ready.json'))) {
    if (launcher.exitCode !== null || Date.now() > deadline) throw new Error(`GUI host failed (${run}): ${diagnostics}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  ready = JSON.parse(readFileSync(join(run, 'ready.json')));
}
async function stop() {
  if (!launcher || launcher.exitCode !== null) return;
  launcher.kill('SIGTERM');
  await Promise.race([new Promise(resolve => launcher.once('exit', resolve)), new Promise((_, reject) => setTimeout(() => reject(new Error('GUI host did not stop')), 10000))]);
}
async function connect(browser) {
  context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' });
  page = await context.newPage();
  await page.goto(ready.url);
  await expect(page.getByRole('button', { name: '插件', exact: true })).toBeVisible({ timeout: 30000 });
  const notice = page.getByRole('dialog', { name: '预览版说明' });
  if (await notice.isVisible()) await notice.getByRole('button', { name: '继续', exact: true }).click();
}
test.beforeAll(async ({ browser }) => {
  test.setTimeout(180000);
  run = mkdtempSync(join(homedir(), '.subagentbook-gui-'));
  await launch(); await connect(browser);
});
test.afterEach(async ({}, info) => {
  failed ||= info.status !== info.expectedStatus;
  if (failed && run && existsSync(join(run, 'server.log'))) {
    await info.attach('DSH server log', { body: readFileSync(join(run, 'server.log')), contentType: 'text/plain' });
  }
});
test.afterAll(async () => {
  try { await context?.close(); } finally { await stop(); }
  if (!failed && !process.env.SUBAGENTBOOK_GUI_KEEP) rmSync(run, { recursive: true, force: true });
  else console.log(`GUI artifacts: ${run}`);
});
async function choose(name, value) {
  if (name === '角色预设') {
    await openMap();
    await choose('关系图模型', '角色公共配置');
    await page.getByRole('region', { name: '关系图', exact: true }).getByRole('button').filter({ has: page.getByText(value, { exact: true }) }).click();
    return;
  }
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}
async function openMap() {
  const trigger = page.getByRole('button', { name: '角色预设', exact: true });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}
async function addRole(id, name) {
  await page.getByRole('button', { name: '新增角色', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新增角色', exact: true });
  await expect(form).toBeInViewport();
  await expect(form.getByRole('textbox', { name: '角色 ID', exact: true })).toBeFocused();
  await form.getByRole('textbox', { name: '角色 ID', exact: true }).fill(id);
  await form.getByRole('textbox', { name: '名称', exact: true }).fill(name);
  await choose('新角色模型', 'fixture / Offline Pro');
  await form.getByRole('textbox', { name: 'Persona', exact: true }).fill(`Persona ${id}`);
  await form.getByRole('button', { name: '添加', exact: true }).click();
  const node = page.getByRole('region', { name: '关系图', exact: true }).getByRole('button', { name: `配置角色 · ${name} (${id})`, exact: true });
  await expect(node).toBeInViewport();
  await expect(node).toBeFocused();
}
async function settings(target = page) {
  await target.getByRole('button', { name: '插件', exact: true }).click();
  await target.getByText('@mimo-codex/dsh-subagentbook', { exact: true }).first().click();
}
async function save() { await page.getByRole('button', { name: '保存草稿', exact: true }).click(); }
test('GUI creates roles and validates tool/role tags before saving and reloading', async () => {
  await settings();
  await addRole('worker', 'CI 执行者');
  await page.getByRole('button', { name: /^可用工具/ }).click();
  const input = page.getByPlaceholder('工具名 · Enter');
  await input.fill('not_a_tool'); await input.press('Enter');
  await expect(page.getByText(/无效工具/)).toBeVisible();
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
  await input.fill('bash, read'); await input.press('Enter');
  await save();
  await expect(page.getByText('草稿', { exact: true })).toHaveCount(0);
  await page.reload();
  await settings();
  await expect(page.getByRole('button', { name: '角色预设', exact: true })).toContainText('CI 执行者');
  await page.getByRole('button', { name: /^可委派角色/ }).click();
  const roles = page.getByPlaceholder('角色 ID · Enter');
  await roles.fill('missing'); await roles.press('Enter');
  await expect(page.getByText(/无效角色/)).toBeVisible();
  await roles.fill('worker'); await roles.press('Enter');
  await choose('文件权限', '只读');
  await save();
});
test('server-only rejection exposes the native reason and keeps the unsaved role', async () => {
  await addRole('blocked', '被拒角色');
  await save();
  await expect(page.getByRole('alert')).toContainText('Provider subagentbook:blocked is already owned by another plugin');
  await expect(page.getByRole('button', { name: '角色预设', exact: true })).toContainText('被拒角色');
  await expect(page.getByText('草稿', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
  await expect(page.getByRole('button', { name: '角色预设', exact: true })).toContainText('CI 执行者');
});
test('two GUI drafts report a real revision conflict without discarding user input', async () => {
  await page.getByRole('button', { name: /^Persona/ }).click();
  await page.getByRole('textbox', { name: 'Persona', exact: true }).fill('stale unsaved Persona');
  const other = await context.newPage(); await other.goto(new URL(ready.url).origin);
  await settings(other);
  await other.getByText('角色信息', { exact: true }).click();
  await other.getByRole('textbox', { name: '名称', exact: true }).fill('CI 执行者 v2');
  await other.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(other.getByText('草稿', { exact: true })).toHaveCount(0);
  await save();
  await expect(page.getByRole('alert')).toContainText('配置已被更新');
  await expect(page.getByRole('textbox', { name: 'Persona', exact: true })).toHaveValue('stale unsaved Persona');
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Persona', exact: true })).toHaveValue('Persona worker');
  await expect(page.getByRole('button', { name: '角色预设', exact: true })).toContainText('CI 执行者 v2');
  await other.close();
});
async function openWorker() {
  await page.getByRole('button', { name: '1 个子智能体', exact: true }).click();
  await page.getByText('GUI CI Worker', { exact: true }).click();
  await expect(page.getByText('GUI_CHILD_COMPLETE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '实例配置', exact: true }).click();
  await expect(page.getByRole('region', { name: '实例配置', exact: true })).toBeVisible();
}
test('GUI delegation exposes the frozen instance and preserves it after settings change', async ({ browser }) => {
  await page.getByRole('button', { name: '添加工作区', exact: true }).click();
  await page.getByRole('button', { name: '编辑路径', exact: true }).click();
  await page.getByRole('textbox', { name: '编辑路径', exact: true }).fill(ready.workspace);
  await page.getByRole('textbox', { name: '编辑路径', exact: true }).press('Enter');
  await page.getByRole('button', { name: '打开', exact: true }).click();
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click();
  const input = page.getByRole('textbox', { name: /描述你想要构建的内容|发消息或创建任务/ });
  await input.fill('GUI_DELEGATE');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('GUI_ROOT_COMPLETE', { exact: true }).filter({ visible: true }).last()).toBeVisible();
  await openWorker();
  const panel = page.getByRole('region', { name: '实例配置', exact: true });
  await expect(panel).toContainText('fixture / pro');
  await expect(panel).toContainText('执行结束（不代表验收通过）');
  await expect(panel.getByRole('button', { name: '导出完整报告', exact: true })).toHaveCount(0);

  const bounds = await panel.boundingBox();
  const sidebar = await page.getByRole('navigation', { name: '全局面板' }).boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);
  await expect(panel).toContainText('只读');
  await expect(panel).toContainText('1 / 3');
  await panel.getByText('Persona', { exact: true }).click();
  await expect(panel.getByText('Persona worker', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭实例配置', exact: true }).click();
  await settings();
  await page.getByRole('button', { name: /^Persona/ }).click();
  await page.getByRole('textbox', { name: 'Persona', exact: true }).fill('Future Persona');
  await save();
  await expect(page.getByText('草稿', { exact: true })).toHaveCount(0);
  await page.getByRole('treeitem').filter({ hasText: 'GUI_DELEGATE' }).click();
  await openWorker();
  await expect(panel).toContainText('设置已更新，此实例沿用创建时的配置');
  await panel.getByText('Persona', { exact: true }).click();
  await expect(panel.getByText('Persona worker', { exact: true })).toBeVisible();
  await expect(panel).not.toContainText('Future Persona');
  const originalId = await panel.getAttribute('data-instance-id');
  await context.close(); await stop(); await launch(true); await connect(browser);
  await page.getByRole('treeitem').filter({ hasText: 'GUI_DELEGATE' }).click();
  await openWorker();
  const restored = page.getByRole('region', { name: '实例配置', exact: true });
  await expect(restored).toHaveAttribute('data-instance-id', originalId);
  await expect(restored).toContainText('执行结束（不代表验收通过）');
  await expect(restored.getByRole('button', { name: '导出完整报告', exact: true })).toHaveCount(0);
  await expect(restored).toContainText('设置已更新，此实例沿用创建时的配置');
  await page.getByRole('button', { name: '关闭实例配置', exact: true }).click();
  const followup = page.getByRole('textbox', { name: /发消息或创建任务/ });
  await followup.fill('GUI_CHILD');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('GUI_CHILD_COMPLETE', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: '实例配置', exact: true }).click();
  await expect(restored).toHaveAttribute('data-instance-id', originalId);
  await expect(restored).toContainText('执行结束（不代表验收通过）');
  await restored.getByText('Persona', { exact: true }).click();
  await expect(restored.getByText('Persona worker', { exact: true })).toBeVisible();
});

const fieldRow = name => page.locator('.sb-rowwrap').filter({ has: page.locator('.sb-field').getByText(name, { exact: true }) });
test('GUI isolates model tool and budget overrides and restores saved inheritance', async () => {
  await settings(); await addRole('variants', 'CI 多模型');
  await page.getByRole('button', { name: /^可用工具/ }).click();
  await page.getByPlaceholder('工具名 · Enter').fill('bash, read');
  await page.getByPlaceholder('工具名 · Enter').press('Enter');
  await save();
  await page.getByText('角色信息', { exact: true }).click();
  await page.getByRole('button', { name: '新增模型变体', exact: true }).click();
  await choose('新增变体模型', 'fixture / Offline Flash');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: /^可用工具/ }).click();
  await page.getByRole('button', { name: '移除工具 read', exact: true }).click();
  await page.getByRole('button', { name: /^预算与思考/ }).click();
  const budget = page.getByRole('textbox', { name: '单次输出上限', exact: true });
  await expect(budget).toHaveAttribute('placeholder', '1024');
  await expect(page.getByRole('slider', { name: '输出上限滑块', exact: true })).toHaveAttribute('max', '2048');
  await budget.fill('3000');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
  await choose('供应商 / 模型', 'fixture / Offline Pro');
  await page.getByRole('button', { name: /^Persona/ }).click();
  await page.getByRole('textbox', { name: 'Persona', exact: true }).fill('Pro-only Persona');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
  await choose('供应商 / 模型', 'fixture / Offline Flash');
  await page.getByRole('button', { name: /^预算与思考/ }).click();
  await budget.fill('2048'); await choose('思考档位名称', 'Quick'); await save();
  await choose('供应商 / 模型', '角色公共配置');
  await page.getByRole('button', { name: /^可用工具/ }).click();
  await page.getByPlaceholder('工具名 · Enter').fill('write');
  await page.getByPlaceholder('工具名 · Enter').press('Enter');
  await page.getByRole('button', { name: /^预算与思考/ }).click();
  await budget.fill('512'); await choose('思考档位名称', 'Standard'); await save();
  await page.reload(); await settings(); await choose('角色预设', 'CI 多模型');
  await choose('供应商 / 模型', 'fixture / Offline Pro');
  await page.getByRole('button', { name: /^可用工具/ }).click();
  await expect(page.getByRole('button', { name: '移除工具 write', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^预算与思考/ }).click();
  await expect(budget).toHaveValue('512');
  await expect(page.getByRole('button', { name: '思考档位名称', exact: true })).toContainText('Standard');
  await expect(fieldRow('预算与思考').getByRole('img')).toHaveAccessibleName('已保存 · 继承公共配置 · 预算与思考 · 角色公共配置');
  await choose('供应商 / 模型', 'fixture / Offline Flash');
  await page.getByRole('button', { name: /^可用工具/ }).click();
  await expect(page.getByRole('button', { name: '移除工具 bash', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '移除工具 read', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '移除工具 write', exact: true })).toHaveCount(0);
  await fieldRow('可用工具').getByRole('button', { name: '使用公共配置', exact: true }).click();
  await save();
  await expect(page.getByRole('button', { name: '移除工具 write', exact: true })).toBeVisible();
  await expect(fieldRow('可用工具').getByRole('img')).toHaveAccessibleName('已保存 · 继承公共配置 · 可用工具 · 角色公共配置');
  await page.getByRole('button', { name: /^预算与思考/ }).click();
  await expect(budget).toHaveValue('2048');
  await expect(page.getByRole('button', { name: '思考档位名称', exact: true })).toContainText('Quick');
  await expect(fieldRow('预算与思考').getByRole('img')).toHaveAccessibleName('已保存 · 预算与思考 · 模型覆盖');
});

test('GUI request fields reject collisions and format drift and preserve typed slider values', async () => {
  // Install before loading the page so every menu timer uses the same clock.
  await page.clock.install({ time: new Date('2026-10-16T00:00:00Z') });
  await page.reload();
  await settings(); await addRole('parameters', 'CI 请求参数');
  await page.getByRole('button', { name: /^预算与思考/ }).click();
  await page.getByRole('button', { name: '添加请求字段', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '请求字段路径 1', exact: true }).fill('thinking.budget_tokens');
  await page.getByRole('textbox', { name: '显示名（可选） 1', exact: true }).fill('推理预算示例');
  await page.getByRole('textbox', { name: '字段值 1', exact: true }).fill('2048');
  await page.getByRole('textbox', { name: '滑块最小值 1', exact: true }).fill('1024');
  await page.getByRole('textbox', { name: '滑块最大值 1', exact: true }).fill('4096');
  await page.getByRole('textbox', { name: '滑块步长 1', exact: true }).fill('1024');
  await page.getByRole('slider', { name: '字段滑块 1', exact: true }).press('ArrowRight');
  await expect(page.getByRole('textbox', { name: '字段值 1', exact: true })).toHaveValue('3072');
  await page.getByRole('button', { name: '添加请求字段', exact: true }).click();
  await page.getByRole('textbox', { name: '请求字段路径 2', exact: true }).fill('thinking.budget_tokens');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '请求字段路径 2', exact: true }).fill('debug.include_usage');
  await choose('字段类型 2', '布尔值'); await choose('字段值 2', 'true');
  // Hold the 200 ms close timer so a quick reopen is deterministic even on
  // slow runners. Keyboard activation exercises real controls without waiting
  // for CSS animation stability or bypassing handlers with forced clicks.
  await page.clock.pauseAt(new Date('2026-10-16T00:01:00Z'));
  try {
    const format = page.getByRole('button', { name: 'API 格式 2', exact: true });
    await format.press('Enter');
    await page.getByRole('option', { name: 'responses', exact: true }).press('Enter');
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
    await expect(page.getByRole('listbox', { name: 'API 格式 2', exact: true })).toHaveClass(/closing/);
    await format.press('Enter');
    await expect(page.getByRole('listbox', { name: 'API 格式 2', exact: true })).not.toHaveClass(/closing/);
    await page.getByRole('option', { name: 'chat', exact: true }).press('Enter');
  } finally { await page.clock.resume(); }
  await save();
  await page.reload(); await settings(); await choose('角色预设', 'CI 请求参数');
  await page.getByRole('button', { name: /^预算与思考/ }).click();
  await expect(page.getByRole('textbox', { name: '字段值 1', exact: true })).toHaveValue('3072');
  await expect(page.getByRole('button', { name: '字段值 2', exact: true })).toContainText('true');
  await page.getByRole('button', { name: '编辑字段 1', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '滑块最小值 1', exact: true })).toHaveValue('1024');
  await expect(page.getByRole('textbox', { name: '滑块最大值 1', exact: true })).toHaveValue('4096');
  await expect(page.getByRole('textbox', { name: '滑块步长 1', exact: true })).toHaveValue('1024');
  await page.getByText('生效配置预览', { exact: true }).click();
  const preview = JSON.parse(await page.locator('.sb-details').filter({ hasText: '生效配置预览' }).locator('pre').innerText());
  expect(preview.agentOptions.requestFields).toEqual([
    expect.objectContaining({ path: 'thinking.budget_tokens', type: 'number', value: 3072, min: 1024, max: 4096, step: 1024, apiFormat: 'chat' }),
    expect.objectContaining({ path: 'debug.include_usage', type: 'boolean', value: true, apiFormat: 'chat' }),
  ]);
});

test('native role menu and model picker start and cold-resume the same book root', async ({ browser }) => {
  await page.close(); page = await context.newPage(); await page.goto(new URL(ready.url).origin);
  await settings(); await addRole('root-role', 'CI 根角色');
  await page.getByRole('button', { name: /^可用工具/ }).click();
  await page.getByPlaceholder('工具名 · Enter').fill('read'); await page.getByPlaceholder('工具名 · Enter').press('Enter');
  await page.getByRole('button', { name: /^可委派角色/ }).click();
  await page.getByPlaceholder('角色 ID · Enter').fill('worker'); await page.getByPlaceholder('角色 ID · Enter').press('Enter');
  await save();
  await page.getByText('角色信息', { exact: true }).click();
  await page.getByRole('button', { name: '新增模型变体', exact: true }).click();
  await choose('新增变体模型', 'fixture / Offline Flash');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: /^Persona/ }).click();
  await page.getByRole('textbox', { name: 'Persona', exact: true }).fill('GUI Flash root Persona');
  await page.getByRole('button', { name: /^可用工具/ }).click();
  await page.getByRole('button', { name: '移除工具 read', exact: true }).click();
  await page.getByPlaceholder('工具名 · Enter').fill('bash'); await page.getByPlaceholder('工具名 · Enter').press('Enter');
  await choose('文件权限', '只读');
  await page.getByRole('button', { name: /^预算与思考/ }).click();
  await page.getByRole('textbox', { name: '单次输出上限', exact: true }).fill('1024'); await save();
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click();
  await page.getByRole('button', { name: '标准模式', exact: true }).click();
  await page.getByText('CI 根角色', { exact: true }).click();
  await page.getByRole('button', { name: /^选择模型/ }).click();
  await page.getByRole('menuitem', { name: '模型 Offline Pro', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Offline Flash', exact: true }).click();
  const input = page.getByRole('textbox', { name: /描述你想要构建的内容|发消息或创建任务/ });
  await input.fill('GUI_BOOK_ROOT'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const response = page.getByText(/^GUI_BOOK_ROOT_COMPLETE /);
  await expect(response).toBeVisible();
  const wire = JSON.parse((await response.innerText()).replace('GUI_BOOK_ROOT_COMPLETE ', ''));
  expect(wire).toEqual({ model: 'flash', maxTokens: 1024, tools: ['bash', 'subagentbook', 'subagentbook_result'], persona: 'GUI Flash root Persona' });
  await page.getByRole('button', { name: '实例配置', exact: true }).click();
  const panel = page.getByRole('region', { name: '实例配置', exact: true });
  await expect(panel).toContainText('根会话'); await expect(panel).toContainText('0 / 3');
  await expect(panel).toContainText('fixture / flash'); await expect(panel).toContainText('只读');
  const rootId = await panel.getAttribute('data-instance-id');
  await page.getByRole('button', { name: '关闭实例配置', exact: true }).click();
  await input.fill('GUI_DELEGATE'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('GUI_ROOT_COMPLETE', { exact: true }).last()).toBeVisible();
  await openWorker();
  await expect(panel).toContainText('1 / 3'); await expect(panel).toContainText('fixture / pro');
  await page.getByRole('button', { name: '关闭实例配置', exact: true }).click();
  await context.close(); await stop(); await launch(true); await connect(browser);
  await page.getByRole('treeitem').filter({ hasText: 'GUI_BOOK_ROOT' }).click();
  await page.getByRole('textbox', { name: /发消息或创建任务/ }).fill('GUI_BOOK_ROOT');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText(/^GUI_BOOK_ROOT_COMPLETE /)).toHaveCount(2);
  await page.getByRole('button', { name: '实例配置', exact: true }).click();
  const restored = page.getByRole('region', { name: '实例配置', exact: true });
  await expect(restored).toHaveAttribute('data-instance-id', rootId); await expect(restored).toContainText('0 / 3');
  await restored.getByText('Persona', { exact: true }).click();
  await expect(restored.getByText('GUI Flash root Persona', { exact: true })).toBeVisible();
});

test('GUI configures an independent verifier and exposes its actual test copy provenance', async () => {
  await settings(); await addRole('verify', 'CI 独立验证者');
  await page.getByRole('button', { name: /^可用工具/ }).click();
  await page.getByPlaceholder('工具名 · Enter').fill('bash'); await page.getByPlaceholder('工具名 · Enter').press('Enter');
  await choose('文件权限', '独立验证副本'); await save();
  await page.reload(); await settings();
  await choose('角色预设', 'CI 独立验证者');
  await expect(page.getByRole('button', { name: '文件权限', exact: true })).toContainText('独立验证副本');
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click();
  await expect(page.getByRole('button', { name: '标准模式', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '选择工作区', exact: true }).click();
  await page.getByRole('menu').getByText('workspace', { exact: true }).click();
  await expect(page.getByRole('button', { name: '选择工作区', exact: true })).toContainText('workspace');
  await page.getByRole('textbox', { name: /描述你想要构建的内容/ }).fill('GUI_VERIFY');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('GUI_VERIFY_ROOT_COMPLETE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /查看 \.subagentbook-verification/ })).toHaveCount(0);
  await page.getByRole('button', { name: '1 个子智能体', exact: true }).click();
  await page.getByText('GUI Independent Verifier', { exact: true }).click();
  await expect(page.getByText('GUI_VERIFY_CHILD_COMPLETE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '实例配置', exact: true }).click();
  const panel = page.getByRole('region', { name: '实例配置', exact: true });
  await panel.getByText('验证来源', { exact: true }).click();
  await expect(panel).toContainText('来源一致'); await expect(panel).toContainText('副本输入未改');
  await expect(panel).toContainText(ready.workspace);
  const id = await panel.getAttribute('data-instance-id');
  await expect(panel.locator('.sb-instance-row').filter({ has: page.getByText('工作区', { exact: true }) })).toContainText(join(ready.workspace, '.subagentbook-verification', id, 'workspace'));
  expect(readFileSync(join(ready.workspace, '.subagentbook-verification', id, 'workspace/build/result.txt'), 'utf8')).toContain('TEST_PASS');
  expect(existsSync(join(ready.workspace, 'build/result.txt'))).toBe(false);
  expect(execFileSync('git', ['-C', ready.workspace, 'status', '--porcelain'], { encoding: 'utf8' })).not.toContain('.subagentbook-verification');
});


test('GUI runs a long one-shot report through paged delivery without exposing reasoning or host spill paths', async ({ browser }) => {
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click();
  await page.getByRole('button', { name: '选择工作区', exact: true }).click();
  await page.getByRole('menu').getByText('workspace', { exact: true }).click();
  await page.getByRole('textbox', { name: /描述你想要构建的内容/ }).fill('GUI_LONG_REPORT');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const result = page.getByText(/^GUI_LONG_REPORT_COMPLETE pages=/);
  await expect(result).toBeVisible();
  await expect(result).toContainText('HASH_OK REASONING_PRIVATE');
  const pages = Number((await result.innerText()).match(/pages=(\d+)/)[1]);
  expect(pages).toBeGreaterThan(10);
  const openReport = async () => {
    await page.getByRole('button', { name: '1 个子智能体', exact: true }).click();
    if (activationHost)
      await expect(page.getByRole('treeitem', { name: /^GUI Long Report/ })).toHaveAttribute('aria-label', /一次性/);
    await page.getByText('GUI Long Report', { exact: true }).click();
    await expect(page.getByText('一次性子智能体记录', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '实例配置', exact: true }).click();
    return page.getByRole('region', { name: '实例配置', exact: true });
  };
  const download = async panel => {
    const ready = page.waitForEvent('download');
    await panel.getByRole('button', { name: '导出完整报告', exact: true }).click();
    return JSON.parse(readFileSync(await (await ready).path(), 'utf8'));
  };
  const panel = await openReport();
  await expect(panel).toContainText('已完整保存');
  await expect(panel).toContainText('已保存，非最终结论');
  const stageDownload = page.waitForEvent('download');
  await panel.getByRole('button', {name:'导出阶段存档',exact:true}).click();
  const stageBundle = JSON.parse(readFileSync(await (await stageDownload).path(), 'utf8'));
  expect(stageBundle.format).toBe('subagentbook-checkpoint-v1');
  expect(stageBundle.final).toBe(false);
  expect(stageBundle.sha256).toBe(createHash('sha256').update(stageBundle.text).digest('hex'));
  const stageData = JSON.parse(stageBundle.text);
  expect(stageData.task.text).toBe('GUI_LONG_REPORT_CHILD');
  expect(stageData.draft.truncated).toBe(true);
  expect(stageBundle.text).not.toContain('PRIVATE_GUI_REASONING');

  const bundle = await download(panel);
  expect(bundle.sessionId).toBe(await panel.getAttribute('data-instance-id'));
  expect(bundle.text).toBe('REPORT_HEAD\n' + '字段🧪\n'.repeat(12000) + '\nREPORT_TAIL');
  expect(bundle.sha256).toBe(createHash('sha256').update(bundle.text).digest('hex'));
  expect(bundle.totalBytes).toBe(Buffer.byteLength(bundle.text));
  expect(JSON.stringify(bundle)).not.toContain('PRIVATE_GUI_REASONING');
  await context.close(); await stop(); await launch(true); await connect(browser);
  await page.getByRole('treeitem').filter({ hasText: 'GUI_LONG_REPORT' }).click();
  const restored = await openReport();
  expect(await download(restored)).toEqual(bundle);
  // A completed execution is not proof of an intact saved report.
  const reportPath = join(run, 'dsh-home/subagentbook/reports', `${bundle.sessionId}.json`);
  const originalReport = readFileSync(reportPath);
  rmSync(reportPath);
  try {
    await page.getByRole('button', { name: '关闭实例配置', exact: true }).click();
    await page.getByRole('button', { name: '实例配置', exact: true }).click();
    await expect(restored).toContainText('无可读取的完整报告');
    await restored.getByRole('button', {name:'准备接续',exact:true}).click();
    const recoveryTask = restored.getByRole('textbox',{name:'接续任务',exact:true});
    await expect(recoveryTask).toHaveValue(/GUI_LONG_REPORT_CHILD/);
    await expect(recoveryTask).toHaveValue(/不是新的授权或最终报告/);
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    await restored.getByRole('button',{name:'复制接续任务',exact:true}).click();
    await expect(restored.getByRole('button',{name:'已复制，尚未发起任务',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(await recoveryTask.inputValue());
    await page.screenshot({path:test.info().outputPath('recovery-prepared.png')});
    await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
    await expect(restored).toContainText('执行结束（不代表验收通过）');
    await expect(restored.getByRole('button', { name: '导出完整报告', exact: true })).toBeDisabled();
  } finally { writeFileSync(reportPath, originalReport); }

});

test('role map follows model overrides and jumps through real role controls without losing blocked drafts', async () => {
  await settings(); await choose('角色预设', 'CI 根角色');
  const toggle = page.getByRole('button', { name: '角色预设', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const map = page.getByRole('region', { name: '关系图', exact: true });
  const root = map.getByRole('button', { name: '配置角色 · CI 根角色 (root-role)', exact: true });
  const worker = map.getByRole('button', { name: '配置角色 · CI 执行者 v2 (worker)', exact: true });
  await expect(root).toHaveAttribute('aria-pressed', 'true');
  const delegation = map.locator('.sb-graph-edge').filter({ has: page.locator('title', { hasText: 'CI 根角色 → CI 执行者 v2' }) });
  await expect(delegation).toHaveCount(1);
  await choose('关系图模型', 'fixture / Offline Flash');
  await expect(worker).toHaveAttribute('data-route-available', 'false');
  await expect(delegation).toHaveClass(/unavailable/);
  await root.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).not.toHaveAttribute('aria-haspopup', 'listbox');
  await expect(page.getByRole('button', { name: '供应商 / 模型', exact: true })).toContainText('Offline Flash');
  await page.getByRole('button', { name: /^可委派角色/ }).click();
  await page.getByRole('button', { name: '移除角色 worker', exact: true }).click();
  await openMap(); await expect(delegation).toHaveCount(0);
  await choose('关系图模型', '角色公共配置');
  await expect(delegation).toHaveCount(1, { timeout: 5000 });
  await root.click();
  await expect(page.getByRole('button', { name: '供应商 / 模型', exact: true })).toContainText('角色公共配置');
  await page.getByRole('button', { name: /^可用工具/ }).click();
  await page.getByPlaceholder('工具名 · Enter').fill('pending_unknown_tool');
  await openMap();
  await worker.press('Enter');
  await expect(page.getByRole('button', { name: '角色预设', exact: true })).toContainText('CI 执行者 v2');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
  await openMap(); await root.click();
  await page.getByRole('button', { name: /^可用工具/ }).click();
  await expect(page.getByPlaceholder('工具名 · Enter')).toHaveValue('pending_unknown_tool');
  await page.getByPlaceholder('工具名 · Enter').fill('');
  await save();
  await openMap();
  await choose('关系图模型', 'fixture / Offline Flash');
  await expect(delegation).toHaveCount(0);
  await page.reload(); await settings(); await toggle.click();
  await choose('关系图模型', 'fixture / Offline Flash');
  await expect(delegation).toHaveCount(0);
  await toggle.click(); await expect(map).toHaveCount(0);
});

test('title expansion rounds each separated card and cycles warn without blocking GUI save or repair', async () => {
  await choose('角色预设', 'CI 执行者 v2');
  const toggle = page.getByRole('button', { name: '角色预设', exact: true });
  await expect(page.getByRole('button', { name: '关系图', exact: true })).toHaveCount(0);
  await expect(page.locator('.sb-titlecard .sb-rowwrap')).toHaveCount(0);
  await toggle.press('Enter');
  const map = page.getByRole('region', { name: '关系图', exact: true });
  await expect(map).toBeVisible();
  const first = page.locator('.sb-rowwrap').first().locator('.sb-card');
  await expect(first).toHaveCSS('border-top-left-radius', '12px');
  await expect(first).toHaveCSS('border-top-right-radius', '12px');
  await expect(page.locator('.sb-titlecard')).toHaveCSS('border-bottom-left-radius', '12px');
  await toggle.click();
  await expect(first).toHaveCSS('border-top-left-radius', '0px');
  await expect(page.locator('.sb-titlecard')).toHaveCSS('border-bottom-left-radius', '0px');
  // worker already delegates to itself; add root-role -> worker -> root-role.
  await page.getByRole('button', { name: /^可委派角色/ }).click();
  await page.getByPlaceholder('角色 ID · Enter').fill('root-role');
  await page.getByPlaceholder('角色 ID · Enter').press('Enter');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '查看循环派遣', exact: true })).toBeVisible();
  await save();
  await page.reload(); await settings();
  await page.getByRole('button', { name: '查看循环派遣', exact: true }).click();
  await expect(page.getByRole('button', { name: '关系图模型', exact: true })).toContainText('全部配置');
  await expect(page.getByText('公共与各模型的关系并集；可能包含跨模型循环。', { exact: true })).toBeVisible();
  await expect(map.locator('.sb-graph-node.cycle')).toHaveCount(2);
  await expect(map.locator('.sb-graph-edge.cycle')).toHaveCount(3);
  await page.getByText('循环派遣 · 1 组', { exact: true }).click();
  await page.getByRole('button', { name: '检查委派配置 · CI 执行者 v2 (worker)', exact: true }).click();
  await expect(toggle).toContainText('CI 执行者 v2');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: '移除角色 root-role', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '移除角色 root-role', exact: true }).click();
  await page.getByRole('button', { name: '移除角色 worker', exact: true }).click();
  await save();
  await expect(page.getByRole('button', { name: '查看循环派遣', exact: true })).toHaveCount(0);
  // Revisiting the already open delegate field of the same role must still
  // reveal it after the title map collapses, even without a selection change.
  await page.getByPlaceholder('角色 ID · Enter').fill('worker');
  await page.getByPlaceholder('角色 ID · Enter').press('Enter');
  await page.getByRole('button', { name: '查看循环派遣', exact: true }).click();
  await page.getByText('循环派遣 · 1 组', { exact: true }).click();
  await page.getByRole('button', { name: '检查委派配置 · CI 执行者 v2 (worker)', exact: true }).click();
  await expect(page.getByRole('button', { name: '移除角色 worker', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '移除角色 worker', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看循环派遣', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
  await page.reload(); await settings(); await openMap();
  await expect(map.locator('.sb-graph-node.cycle')).toHaveCount(0);
});

test('mixed-model cycle warning jumps to the contributing model override for repair', async () => {
  await choose('角色预设', 'CI 执行者 v2');
  await page.getByText('角色信息', { exact: true }).click();
  await page.getByRole('button', { name: '新增模型变体', exact: true }).click();
  await choose('新增变体模型', 'fixture / Offline Flash');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: /^可委派角色/ }).click();
  await page.getByPlaceholder('角色 ID · Enter').fill('root-role');
  await page.getByPlaceholder('角色 ID · Enter').press('Enter');
  await save();
  await page.getByRole('button', { name: '查看循环派遣', exact: true }).click();
  const map = page.getByRole('region', { name: '关系图', exact: true });
  await expect(map.locator('.sb-graph-node.cycle')).toHaveCount(2);
  await choose('关系图模型', 'fixture / Offline Flash');
  await expect(map.locator('.sb-graph-node.cycle')).toHaveCount(0, { timeout: 5000 });
  await choose('关系图模型', '角色公共配置');
  await expect(map.locator('.sb-graph-node.cycle')).toHaveCount(0);
  await choose('关系图模型', '全部配置 · 可能关系');
  await page.getByText('循环派遣 · 1 组', { exact: true }).click();
  await page.getByRole('button', { name: '检查委派配置 · CI 执行者 v2 (worker)', exact: true }).click();
  await expect(page.getByRole('button', { name: '供应商 / 模型', exact: true })).toContainText('Offline Flash');
  await page.getByRole('button', { name: '移除角色 root-role', exact: true }).click();
  await save();
  await expect(page.getByRole('button', { name: '查看循环派遣', exact: true })).toHaveCount(0);
});

test('creation forms stay beside their trigger and failures/cancel/success remain visible', async () => {
  await page.reload(); await settings();
  await page.getByText('角色信息', { exact: true }).click();
  await page.getByRole('button', { name: /^Persona/ }).click();
  const count = await page.locator('.sb-graph-node').count();
  const plus = page.getByRole('button', { name: '新增角色', exact: true });
  await plus.click();
  const form = page.getByRole('dialog', { name: '新增角色', exact: true });
  const id = form.getByRole('textbox', { name: '角色 ID', exact: true });
  await expect(form).toBeInViewport(); await expect(id).toBeFocused();
  const near = async (trigger, dialog) => {
    const a = await trigger.boundingBox(), b = await dialog.boundingBox();
    expect(Math.min(Math.abs(b.y - a.y - a.height), Math.abs(a.y - b.y - b.height))).toBeLessThan(16);
    expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(1280);
    expect(b.y).toBeGreaterThanOrEqual(0); expect(b.y + b.height).toBeLessThanOrEqual(720);
  };
  await near(plus, form);
  await expect(plus).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.sb-graph-node')).toHaveCount(count);
  await id.fill('worker');
  await form.getByRole('textbox', { name: '名称', exact: true }).fill('CI 就地新增');
  await choose('新角色模型', 'fixture / Offline Pro');
  await form.getByRole('textbox', { name: 'Persona', exact: true }).fill('Anchored fixture Persona');
  await form.getByRole('button', { name: '添加', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('角色 ID 已存在');
  await expect(id).toHaveValue('worker'); await expect(page.locator('.sb-graph-node')).toHaveCount(count);
  // Escape closes the model menu first, then the creation panel, preserving input.
  await form.getByRole('button', { name: '新角色模型', exact: true }).press('Enter');
  await form.getByRole('button', { name: '新角色模型', exact: true }).press('Escape');
  await expect(page.getByRole('listbox', { name: '新角色模型', exact: true })).toHaveCount(0);
  await expect(form).toBeVisible(); await id.press('Escape');
  await expect(form).toHaveCount(0); await expect(plus).toBeFocused();
  await plus.click(); await expect(id).toHaveValue('worker');
  await id.fill('anchored'); await form.getByRole('button', { name: '添加', exact: true }).click();
  const map = page.getByRole('region', { name: '关系图', exact: true });
  const node = map.getByRole('button', { name: '配置角色 · CI 就地新增 (anchored)', exact: true });
  await expect(form).toHaveCount(0); await expect(node).toBeFocused(); await expect(node).toBeInViewport();
  await expect(node).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('已添加 · CI 就地新增', { exact: true })).toBeVisible();
  await expect(map.locator('.sb-graph-edge').filter({ has: page.locator('title', { hasText: '→ CI 就地新增' }) })).toHaveCount(0);
  await save(); await page.reload(); await settings(); await choose('角色预设', 'CI 就地新增');
  await page.getByText('角色信息', { exact: true }).click();
  const addRoute = page.getByRole('button', { name: '新增模型变体', exact: true });
  await addRoute.click();
  const routeForm = page.getByRole('dialog', { name: '新增模型变体', exact: true });
  await expect(routeForm).toBeInViewport(); await near(addRoute, routeForm);
  await expect(routeForm.getByRole('button', { name: '新增变体模型', exact: true })).toBeFocused();
  await choose('新增变体模型', 'fixture / Offline Pro');
  await routeForm.getByRole('button', { name: '添加', exact: true }).click();
  await expect(routeForm.getByRole('alert')).toContainText('此模型变体已存在');
  await choose('新增变体模型', 'fixture / Offline Flash');
  await routeForm.getByRole('button', { name: '添加', exact: true }).click();
  await expect(routeForm).toHaveCount(0);
  await expect(page.getByRole('button', { name: '供应商 / 模型', exact: true })).toContainText('Offline Flash');
  await save();
});

test('built-in team adds a namespaced editable graph without replacing roles and survives reload', async () => {
  await settings();
  await page.getByRole('button', { name: '专家团模板', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '专家团模板', exact: true });
  await expect(panel).toBeInViewport();
  await expect(panel.getByRole('button', { name: '添加整团', exact: true })).toBeDisabled();
  await choose('团队初始模型', 'fixture / Offline Pro');
  await panel.getByRole('button', { name: '取消', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: '专家团模板', exact: true }).click();
  await expect(panel.getByRole('button', { name: '团队初始模型', exact: true })).toContainText('Offline Pro');
  await panel.getByRole('button', { name: '添加整团', exact: true }).click();
  const entry = page.getByRole('button', { name: '配置角色 · 开发者 (ur.developer)', exact: true });
  await expect(entry).toBeFocused();
  await expect(page.getByRole('button', { name: '配置角色 · 独立核验 (ur.verifier)', exact: true })).toBeVisible();
  await save(); await page.reload(); await settings(); await openMap();
  await expect(entry).toBeVisible();
  await page.getByRole('button', { name: '专家团模板', exact: true }).click();
  await choose('团队初始模型', 'fixture / Offline Flash');
  await panel.getByRole('button', { name: '添加整团', exact: true }).click();
  await expect(page.getByRole('button', { name: '配置角色 · 开发者 (ur-2.developer)', exact: true })).toBeFocused();
  await expect(entry).toHaveCount(1);
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
  await expect(page.getByRole('button', { name: '配置角色 · 开发者 (ur-2.developer)', exact: true })).toHaveCount(0);
  await expect(entry).toHaveCount(1);
});
