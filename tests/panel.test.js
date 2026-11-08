import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../src/editor.js', () => ({
  createEditor: vi.fn((container, source, onChange) => {
    const textarea = document.createElement('textarea');
    textarea.setAttribute('aria-label', 'HTML 源码');
    textarea.value = source;
    textarea.addEventListener('input', () => onChange(textarea.value));
    container.append(textarea);
    return { destroy: vi.fn(() => textarea.remove()), focus: vi.fn(() => textarea.focus()) };
  }),
}));

import { createEditor } from '../src/editor.js';
import { mountPanel } from '../src/panel.js';

const source = '<!doctype html><html><body><h1>原始内容</h1></body></html>';
const changedSource = '<!doctype html><html><body><h1>编辑后的内容</h1></body></html>';
const state = { noteId: 'note-1', resourceId: 'html-1', originalResourceId: 'original-1' };
const originalGlobals = new Map();
let dom;
let container;
let controllers = [];

function resource(overrides = {}) {
  return {
    id: 'html-1', noteId: 'note-1', filename: 'article.html', kind: 'attachment',
    mimeType: 'text/html', contentHash: 'hash-1', byteSize: new Blob([source]).size,
    ...overrides,
  };
}

function makeContext() {
  return {
    resources: {
      list: vi.fn().mockResolvedValue([resource(), resource({ id: 'original-1', filename: 'original-article.html' })]),
      read: vi.fn().mockResolvedValue(new Blob([source], { type: 'text/html' })),
      update: vi.fn().mockResolvedValue(resource({ contentHash: 'hash-2' })),
      upload: vi.fn(),
    },
    editor: {
      getDocument: vi.fn().mockResolvedValue({ noteId: 'note-1' }),
      insertEmbed: vi.fn(),
    },
    notes: { get: vi.fn().mockResolvedValue({ id: 'note-1', kind: 'text' }) },
    ui: { showNotice: vi.fn() },
  };
}

function makeDrafts() {
  return { read: vi.fn().mockResolvedValue(null), write: vi.fn().mockResolvedValue(), clear: vi.fn().mockResolvedValue() };
}

function button(label) {
  const result = [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
  expect(result, `Expected button: ${label}`).toBeTruthy();
  return result;
}

function edit(value = changedSource) {
  const input = container.querySelector('textarea[aria-label="HTML 源码"]');
  expect(input).toBeTruthy();
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

async function mount(initialState = state, ctx = makeContext(), drafts = makeDrafts()) {
  const onSaved = vi.fn();
  const controller = mountPanel(container, ctx, initialState, { drafts, onSaved });
  controllers = [...controllers, controller];
  await controller.ready;
  return { controller, ctx, drafts, onSaved };
}

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://host.test/' });
  for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'CustomEvent']) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
  }
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  vi.clearAllMocks();
});

afterEach(() => {
  for (const controller of controllers) controller.dispose();
  controllers = [];
  document.body.replaceChildren();
});

afterAll(() => {
  dom.window.close();
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('HTML preview-first panel', () => {
  it('starts with the isolated preview and no source editor', async () => {
    const { controller } = await mount();
    expect(container.querySelector('iframe')).toBeTruthy();
    expect(container.querySelector('iframe').getAttribute('sandbox')).toBe('allow-scripts');
    expect(container.querySelector('textarea')).toBeNull();
    expect(createEditor).not.toHaveBeenCalled();
    expect(button('编辑源码')).toBeTruthy();
    expect(await controller.beforeClose()).toBe(true);
  });

  it('creates the editor only after pressing 编辑源码', async () => {
    await mount();
    button('编辑源码').click();
    await vi.waitFor(() => expect(createEditor).toHaveBeenCalledTimes(1));
    expect(container.querySelector('textarea').value).toBe(source);
    expect(button('保存并返回')).toBeTruthy();
    expect(button('返回预览')).toBeTruthy();
  });

  it('can enter source mode directly from an embed edit action', async () => {
    await mount({ ...state, edit: true });
    expect(container.querySelector('textarea').value).toBe(source);
    expect(createEditor).toHaveBeenCalledTimes(1);
  });

  it('allows clean source mode to close without prompting', async () => {
    const { controller } = await mount({ ...state, edit: true });
    expect(await controller.beforeClose()).toBe(true);
  });

  it('asks for confirmation before closing a dirty source document', async () => {
    const { controller, drafts } = await mount({ ...state, edit: true });
    edit();
    expect(await controller.beforeClose()).toEqual(expect.objectContaining({
      title: expect.any(String), message: expect.any(String),
    }));
    await vi.waitFor(() => expect(drafts.write).toHaveBeenCalled());
    expect(container.querySelector('textarea').value).toBe(changedSource);
  });

  it('does not mark the document dirty when the source is unchanged', async () => {
    const { controller } = await mount({ ...state, edit: true });
    edit(source);
    expect(await controller.beforeClose()).toBe(true);
  });

  it('saves with the loaded hash, refreshes local embeds, and returns to preview', async () => {
    const { ctx, controller, onSaved, drafts } = await mount({ ...state, edit: true });
    edit();
    button('保存并返回').click();
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      id: 'html-1', contentHash: 'hash-2',
    })));
    const [id, input] = ctx.resources.update.mock.calls[0];
    expect(id).toBe('html-1');
    expect(input.expectedContentHash).toBe('hash-1');
    expect(await input.file.text()).toBe(changedSource);
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('iframe')).toBeTruthy();
    expect(container.querySelector('iframe').srcdoc).toContain('编辑后的内容');
    expect(drafts.clear).toHaveBeenCalled();
    expect(await controller.beforeClose()).toBe(true);
  });

  it('blocks close while saving, then permits close after success', async () => {
    const ctx = makeContext();
    let resolveUpdate;
    ctx.resources.update.mockImplementation(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    const { controller, onSaved } = await mount({ ...state, edit: true }, ctx);
    edit();
    button('保存并返回').click();
    await vi.waitFor(() => expect(ctx.resources.update).toHaveBeenCalledTimes(1));
    expect(await controller.beforeClose()).toBe(false);
    resolveUpdate(resource({ contentHash: 'hash-2' }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await controller.beforeClose()).toBe(true);
  });

  it('keeps unsaved source and its draft after a failed save', async () => {
    const ctx = makeContext();
    ctx.resources.update.mockRejectedValue(Object.assign(new Error('资源已变化'), { code: 'RESOURCE_CONFLICT' }));
    const { controller, onSaved, drafts } = await mount({ ...state, edit: true }, ctx);
    edit();
    button('保存并返回').click();
    await vi.waitFor(() => expect(ctx.resources.update).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.querySelector('textarea').value).toBe(changedSource);
    expect(onSaved).not.toHaveBeenCalled();
    expect(drafts.clear).not.toHaveBeenCalled();
    expect(await controller.beforeClose()).toEqual(expect.objectContaining({ message: expect.any(String) }));
  });

  it('can preview a draft without saving or losing its dirty state', async () => {
    const { controller, ctx } = await mount({ ...state, edit: true });
    edit();
    button('预览效果').click();
    await vi.waitFor(() => expect(container.querySelector('iframe').srcdoc).toContain('编辑后的内容'));
    expect(ctx.resources.update).not.toHaveBeenCalled();
    expect(await controller.beforeClose()).toEqual(expect.objectContaining({ message: expect.any(String) }));
  });

  it('never silently drops dirty source when reloading', async () => {
    const { ctx } = await mount({ ...state, edit: true });
    edit();
    const readsBefore = ctx.resources.read.mock.calls.length;
    button('重新载入').click();
    expect(ctx.resources.read).toHaveBeenCalledTimes(readsBefore);
    expect(button('放弃修改并重新载入')).toBeTruthy();
    button('继续编辑').click();
    expect(container.querySelector('textarea').value).toBe(changedSource);
    expect(ctx.resources.read).toHaveBeenCalledTimes(readsBefore);
  });

  it('reloads only after explicit discard confirmation', async () => {
    const { ctx, controller } = await mount({ ...state, edit: true });
    edit();
    button('重新载入').click();
    button('放弃修改并重新载入').click();
    await vi.waitFor(() => expect(ctx.resources.read.mock.calls.length).toBeGreaterThan(1));
    await vi.waitFor(async () => expect(await controller.beforeClose()).toBe(true));
    const textarea = container.querySelector('textarea');
    if (textarea) expect(textarea.value).toBe(source);
  });

  it('disposes the editor and mounted DOM', async () => {
    const { controller } = await mount({ ...state, edit: true });
    const editor = createEditor.mock.results[0].value;
    controller.dispose();
    expect(editor.destroy).toHaveBeenCalled();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('renders a file input rather than an editor when no resource has been imported', async () => {
    await mount({ noteId: 'note-1' });
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    expect(input.accept).toMatch(/\.html/);
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('shows load errors without rejecting readiness or presenting an editable stale snapshot', async () => {
    const ctx = makeContext();
    ctx.resources.read.mockRejectedValue(new Error('附件读取失败'));
    const { controller } = await mount(state, ctx);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain('附件读取失败');
    expect(container.querySelector('textarea')).toBeNull();
    expect(await controller.beforeClose()).toBe(true);
  });

  it('does not revive DOM after disposal while a resource load is pending', async () => {
    const ctx = makeContext();
    let resolveRead;
    ctx.resources.read.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    const controller = mountPanel(container, ctx, state, { drafts: makeDrafts(), onSaved: vi.fn() });
    controllers = [...controllers, controller];
    await vi.waitFor(() => expect(ctx.resources.read).toHaveBeenCalledTimes(1));
    controller.dispose();
    resolveRead(new Blob([source], { type: 'text/html' }));
    await controller.ready;
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('recovers a draft based on the current hash and lets it be saved', async () => {
    const drafts = makeDrafts();
    drafts.read.mockResolvedValue({ source: changedSource, baseHash: 'hash-1', noteId: 'note-1' });
    const { ctx, onSaved, controller } = await mount(state, makeContext(), drafts);
    expect(container.querySelector('textarea').value).toBe(changedSource);
    expect(button('保存并返回').disabled).toBe(false);
    expect(container.textContent).toContain('已恢复');
    expect(await controller.beforeClose()).toEqual(expect.objectContaining({ message: expect.any(String) }));
    button('保存并返回').click();
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(ctx.resources.update.mock.calls[0][1].expectedContentHash).toBe('hash-1');
  });

  it('recovers a stale draft for export but locks saving against a different attachment version', async () => {
    const drafts = makeDrafts();
    drafts.read.mockResolvedValue({ source: changedSource, baseHash: 'hash-before-sync', noteId: 'note-1' });
    const { ctx, controller } = await mount(state, makeContext(), drafts);
    expect(container.querySelector('textarea').value).toBe(changedSource);
    expect(button('保存并返回').disabled).toBe(true);
    expect(button('导出 HTML').disabled).toBe(false);
    expect(container.textContent).toContain('附件版本已变化');
    expect(await controller.beforeClose()).toEqual(expect.objectContaining({ message: expect.any(String) }));
    button('保存并返回').click();
    expect(ctx.resources.update).not.toHaveBeenCalled();
  });

  it('does not relabel a stale draft with the latest base hash when edited or disposed', async () => {
    const drafts = makeDrafts();
    drafts.read.mockResolvedValue({ source: changedSource, baseHash: 'hash-before-sync', noteId: 'note-1' });
    const { controller } = await mount(state, makeContext(), drafts);
    edit(`${changedSource}\n<!-- more changes -->`);
    controller.dispose();
    expect(drafts.write).toHaveBeenCalled();
    for (const [, draft] of drafts.write.mock.calls) {
      expect(draft.baseHash).toBe('hash-before-sync');
    }
  });

  it('keeps the old dirty source and recovery draft when an explicit reload fails', async () => {
    const { ctx, drafts, controller } = await mount({ ...state, edit: true });
    edit();
    ctx.resources.read.mockRejectedValue(new Error('重新载入失败'));
    button('重新载入').click();
    button('放弃修改并重新载入').click();
    await vi.waitFor(() => expect(container.textContent).toContain('重新载入失败'));
    expect(container.querySelector('textarea').value).toBe(changedSource);
    expect(drafts.clear).not.toHaveBeenCalled();
    expect(await controller.beforeClose()).toEqual(expect.objectContaining({ message: expect.any(String) }));
  });

  it('imports a chosen local HTML into the current note and switches directly to preview', async () => {
    const ctx = makeContext();
    ctx.resources.upload.mockResolvedValueOnce(resource({ id: 'original-1', filename: 'original-article.html' }))
      .mockResolvedValueOnce(resource());
    const { controller } = await mount({ noteId: 'note-1' }, ctx);
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new File([source], 'article.html')], configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(container.querySelector('iframe')).toBeTruthy());
    expect(ctx.resources.upload).toHaveBeenCalledTimes(2);
    expect(ctx.editor.insertEmbed).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'html-1' }));
    expect(ctx.ui.showNotice).toHaveBeenCalledWith(expect.stringContaining('已插入当前笔记'));
    expect(container.querySelector('textarea')).toBeNull();
    expect(await controller.beforeClose()).toBe(true);
  });

  it('shows import validation errors and leaves file selection available for retry', async () => {
    const { ctx } = await mount({ noteId: 'note-1' });
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new File(['not HTML'], 'bad.txt')], configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]').hidden).toBe(false));
    expect(ctx.resources.upload).not.toHaveBeenCalled();
    expect(input.disabled).toBe(false);
  });

  it('ignores a canceled file selection without uploading or entering busy mode', async () => {
    const { ctx, controller } = await mount({ noteId: 'note-1' });
    container.querySelector('input[type="file"]').dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(ctx.resources.upload).not.toHaveBeenCalled();
    expect(await controller.beforeClose()).toBe(true);
  });

  it('supports drag highlighting and rejects multi-file drops explicitly', async () => {
    await mount({ noteId: 'note-1' });
    const drop = container.querySelector('.ht-drop');
    drop.dispatchEvent(new window.Event('dragover', { bubbles: true, cancelable: true }));
    expect(drop.dataset.drag).toBe('true');
    drop.dispatchEvent(new window.Event('dragleave', { bubbles: true }));
    expect(drop.dataset.drag).toBeUndefined();
    const event = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [new File([source], 'one.html'), new File([source], 'two.html')] } });
    drop.dispatchEvent(event);
    expect(container.textContent).toContain('请一次导入一个 HTML 文件');
  });

  it('accepts a single dropped HTML file', async () => {
    const ctx = makeContext();
    ctx.resources.upload.mockResolvedValueOnce(resource({ id: 'original-1', filename: 'original-article.html' }))
      .mockResolvedValueOnce(resource());
    await mount({ noteId: 'note-1' }, ctx);
    const event = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [new File([source], 'one.html')] } });
    container.querySelector('.ht-drop').dispatchEvent(event);
    await vi.waitFor(() => expect(container.querySelector('iframe')).toBeTruthy());
    expect(ctx.editor.insertEmbed).toHaveBeenCalled();
  });

  it('requires explicit opt-in before loading external HTTPS resources', async () => {
    await mount();
    expect(container.querySelector('iframe').srcdoc).toContain("connect-src 'none'");
    const checkbox = container.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(container.querySelector('iframe').srcdoc).toContain('connect-src https:');
    expect(container.textContent).toContain('已允许页面向外部 HTTPS');
  });

  it('keeps source while toggling split mode, then explicitly discards it before returning', async () => {
    const { drafts, controller } = await mount({ ...state, edit: true });
    edit();
    button('分屏').click();
    expect(container.querySelector('.ht-preview').hidden).toBe(false);
    button('仅源码').click();
    expect(container.querySelector('.ht-preview').hidden).toBe(true);
    button('返回预览').click();
    button('放弃修改并返回').click();
    await vi.waitFor(() => expect(container.querySelector('textarea')).toBeNull());
    expect(container.querySelector('iframe').srcdoc).toContain('原始内容');
    expect(drafts.clear).toHaveBeenCalled();
    expect(await controller.beforeClose()).toBe(true);
  });

  it('returns directly from clean source to preview without discard confirmation', async () => {
    await mount({ ...state, edit: true });
    button('返回预览').click();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('.ht-confirm').hidden).toBe(true);
  });

  it('exports current HTML and the untouched original through separate actions', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:panel-export');
    const anchorClick = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      const { ctx } = await mount();
      button('导出 HTML').click();
      expect(createUrl).toHaveBeenCalledTimes(1);
      expect(await createUrl.mock.calls[0][0].text()).toBe(source);
      const original = new Blob([new Uint8Array([0xff, 0xfe, 0x41, 0x00])]);
      ctx.resources.read.mockResolvedValue(original);
      button('导出原件').click();
      await vi.waitFor(() => expect(createUrl).toHaveBeenCalledTimes(2));
      expect(createUrl.mock.calls[1][0]).toBe(original);
      expect(anchorClick).toHaveBeenCalledTimes(2);
      expect(ctx.resources.read).toHaveBeenLastCalledWith('original-1');
    } finally {
      createUrl.mockRestore();
      anchorClick.mockRestore();
    }
  });

  it('reports an unavailable original without exporting a different attachment', async () => {
    const { ctx } = await mount();
    ctx.resources.list.mockResolvedValue([resource()]);
    button('导出原件').click();
    await vi.waitFor(() => expect(container.textContent).toContain('找不到原件附件'));
    expect(ctx.resources.read).not.toHaveBeenCalledWith('original-1');
  });
});
