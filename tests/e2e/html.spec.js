import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const original = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>交互资料</title>
<style>body{font:18px system-ui;padding:32px;background:#f1faf5}button{padding:10px;margin:6px}</style>
<h1>本地 HTML 资料</h1><button onclick="document.querySelector('#count').textContent++">交互计数</button><output id="count">0</output>
<button onclick="try{parent.document.body;document.querySelector('#isolation').textContent='越界'}catch(e){document.querySelector('#isolation').textContent='已隔离'}">检查隔离</button><output id="isolation">未检查</output>
<button onclick="try{top.location='https://invalid.example/escape';}catch(e){document.querySelector('#navigation').textContent='已阻止'}">尝试顶层跳转</button><output id="navigation">未检查</output></html>`;
const changed = original.replace('本地 HTML 资料', '已编辑的 HTML 资料');
const panel = page => page.locator('.host-panel');

async function importFile(page) {
  await page.goto('/demo/');
  await expect(page.getByRole('button', { name: 'HTML：导入到当前笔记', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'HTML：导入到当前笔记', exact: true }).click();
  await page.getByLabel('选择本地 HTML 文件').setInputFiles({ name: '资料.html', mimeType: 'text/html', buffer: Buffer.from(original) });
  await expect(panel(page).locator('iframe')).toBeVisible();
}

async function replaceSource(page, source) {
  const code = panel(page).getByRole('textbox', { name: 'HTML 源码' });
  await code.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(source);
}

test('真实 Bundle：导入、默认交互预览、源码保存、重启、导出与原件保留', async ({ page }) => {
  await importFile(page);
  await expect(panel(page).locator('.cm-editor')).toHaveCount(0);
  const frame = panel(page).frameLocator('iframe');
  await frame.getByRole('button', { name: '交互计数' }).click();
  await expect(frame.locator('#count')).toHaveText('1');
  await frame.getByRole('button', { name: '检查隔离' }).click();
  await expect(frame.locator('#isolation')).toHaveText('已隔离');
  await panel(page).getByRole('button', { name: '编辑源码', exact: true }).click();
  await replaceSource(page, changed);
  await panel(page).getByRole('button', { name: '保存并返回', exact: true }).click();
  await expect(panel(page).locator('.cm-editor')).toHaveCount(0);
  await expect(panel(page).frameLocator('iframe').getByRole('heading', { name: '已编辑的 HTML 资料' })).toBeVisible();
  expect(await page.evaluate(() => window.demo.sources())).toEqual(expect.arrayContaining([original, changed]));
  await page.reload();
  const inline = page.locator('.host-note .ht-embed');
  await expect(inline.frameLocator('iframe').getByRole('heading', { name: '已编辑的 HTML 资料' })).toBeVisible();
  await inline.getByRole('button', { name: '打开大预览' }).click();
  const downloadPromise = page.waitForEvent('download');
  await panel(page).getByRole('button', { name: '导出 HTML', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('资料.html');
  expect(await readFile(await download.path(), 'utf8')).toBe(changed);
  const originalDownloadPromise = page.waitForEvent('download');
  await panel(page).getByRole('button', { name: '导出原件', exact: true }).click();
  expect(await readFile(await (await originalDownloadPromise).path(), 'utf8')).toBe(original);
});

test('dirty 关闭确认，并能从本地草稿恢复', async ({ page }) => {
  await importFile(page);
  await panel(page).getByRole('button', { name: '编辑源码', exact: true }).click();
  await replaceSource(page, changed);
  await page.getByRole('button', { name: '关闭 HTML 面板', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('源码尚未保存');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(panel(page).locator('.cm-editor')).toBeVisible();
  await page.getByRole('button', { name: '关闭 HTML 面板', exact: true }).click();
  await page.getByRole('button', { name: '保留草稿并关闭', exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  await page.reload();
  await page.locator('.host-note').getByRole('button', { name: '编辑源码', exact: true }).click();
  await expect(panel(page).getByRole('textbox', { name: 'HTML 源码' })).toContainText('已编辑的 HTML 资料');
  await expect(panel(page).getByRole('alert')).toContainText('已恢复');
});

test('CAS 冲突不覆盖其他修改，草稿仍可导出', async ({ page }) => {
  await importFile(page);
  await panel(page).getByRole('button', { name: '编辑源码', exact: true }).click();
  await replaceSource(page, changed);
  await page.evaluate(() => window.demo.changeWorking('<!doctype html><h1>另一台设备修改</h1>'));
  await panel(page).getByRole('button', { name: '保存并返回', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('附件已被其他窗口或设备修改');
  await expect(panel(page).getByRole('textbox', { name: 'HTML 源码' })).toContainText('已编辑的 HTML 资料');
  expect(await page.evaluate(() => window.demo.sources())).toContain('<!doctype html><h1>另一台设备修改</h1>');
});

test('iframe 无法操作顶层页面，源码预览不修改附件', async ({ page }) => {
  await importFile(page);
  await panel(page).frameLocator('iframe').getByRole('button', { name: '尝试顶层跳转' }).click();
  await expect(page).toHaveURL(/\/demo\/$/);
  await expect(panel(page).frameLocator('iframe').locator('#navigation')).toHaveText('已阻止');
  await panel(page).getByRole('button', { name: '编辑源码', exact: true }).click();
  await replaceSource(page, changed);
  await panel(page).getByRole('button', { name: '预览效果', exact: true }).click();
  await expect(panel(page).frameLocator('iframe').getByRole('heading', { name: '已编辑的 HTML 资料' })).toBeVisible();
  expect(await page.evaluate(() => window.demo.sources())).toEqual([original, original]);
});
