import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { decodeHtml, utf8Html, importHtml, loadDocument } from '../src/core.js';
import { createDrafts } from '../src/drafts.js';

vi.mock('../src/editor.js', () => ({
  createEditor(container, source, onChange) {
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', 'HTML 源码');
    input.value = source;
    input.addEventListener('input', () => onChange(input.value));
    container.append(input);
    return { destroy: () => input.remove(), focus: () => input.focus() };
  },
}));

import { mountPanel } from '../src/panel.js';

describe('HTML encoding declarations are attributes, not arbitrary meta text', () => {
  it.each([
    '<meta name="description" content="charset=gbk">',
    '<meta data-charset="gbk">',
    '<meta name="example" content="<meta charset=gbk>">',
  ])('does not interpret %s as an encoding declaration', async meta => {
    const source = `${meta}<p>中文</p>`;
    expect(await decodeHtml(new Blob([source]))).toBe(source);
    expect(utf8Html(source)).toBe(source);
  });
});

describe('synced host resource and note identity requirements', () => {
  const source = '<meta charset="utf-8"><p>中文</p>';
  function environment() {
    const resource = { id: 'editable-1', noteId: 'note-1', filename: 'test.html', contentHash: 'h1', byteSize: 100 };
    const original = { ...resource, id: 'original-1', filename: 'original-test.html' };
    const context = {
      editor: {
        getDocument: vi.fn(async () => ({ noteId: 'note-1' })),
        insertEmbed: vi.fn(),
      },
      notes: { get: vi.fn(async () => ({ id: 'note-1', kind: 'text' })) },
      resources: {
        upload: vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(resource),
        delete: vi.fn(),
        list: vi.fn(async () => [resource]),
        read: vi.fn(async () => new Blob([source])),
      },
    };
    return { context, resource, original };
  }

  it.each([
    ['local original', { id: 'local_resource_original', contentHash: 'h1' }, 1],
    ['hashless original', { id: 'pending-original', contentHash: null }, 1],
    ['local editable', { id: 'local_resource_editable', contentHash: 'h1' }, 2],
    ['hashless editable', { id: 'pending-editable', contentHash: null }, 2],
  ])('does not insert a permanently stale embed for %s', async (_label, overrides, failingUpload) => {
    const { context, resource, original } = environment();
    context.resources.upload.mockReset();
    if (failingUpload === 1) context.resources.upload.mockResolvedValueOnce({ ...original, ...overrides });
    else context.resources.upload.mockResolvedValueOnce(original).mockResolvedValueOnce({ ...resource, ...overrides });
    await expect(importHtml(context, 'note-1', new File([source], 'test.html')))
      .rejects.toThrow(overrides.id);
    expect(context.resources.upload).toHaveBeenCalledTimes(failingUpload);
    expect(context.editor.insertEmbed).not.toHaveBeenCalled();
    expect(context.resources.delete).not.toHaveBeenCalled();
  });

  it('requires reopening a temporary note whose canonical id already changed', async () => {
    const { context } = environment();
    context.notes.get.mockResolvedValue({ id: 'note-canonical', kind: 'text' });
    await expect(importHtml(context, 'note-1', new File([source], 'test.html'))).rejects.toThrow();
    expect(context.resources.upload).not.toHaveBeenCalled();
    expect(context.editor.insertEmbed).not.toHaveBeenCalled();
  });

  it('loads an old note alias using the canonical id returned by notes.get', async () => {
    const { context, resource } = environment();
    context.notes.get.mockResolvedValue({ id: 'note-canonical', kind: 'text' });
    context.resources.list.mockImplementation(async id => id === 'note-canonical'
      ? [{ ...resource, noteId: 'note-canonical' }]
      : []);
    const loaded = await loadDocument(context, 'note-1', 'editable-1');
    expect(loaded.source).toBe(source);
    expect(loaded.resource.noteId).toBe('note-canonical');
    expect(context.resources.list).toHaveBeenCalledWith('note-canonical');
  });
});

describe('draft baseline and intentional undo regressions', () => {
  const originals = new Map();
  const state = { noteId: 'n1', resourceId: 'r1', edit: true };
  const savedSource = '<p>当前附件内容</p>';
  const draftSource = '<p>未保存草稿</p>';
  let dom;
  let container;
  let controllers = [];

  beforeAll(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://host.test/' });
    for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'CustomEvent']) {
      originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
    }
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    for (const controller of controllers) controller.dispose();
    controllers = [];
    document.body.replaceChildren();
  });

  afterAll(() => {
    dom.window.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  function environment() {
    const records = new Map();
    const storage = {
      get: async key => records.get(key) ?? null,
      set: async (key, value) => { records.set(key, structuredClone(value)); },
      remove: async key => { records.delete(key); },
    };
    const drafts = createDrafts(storage, vi.fn());
    const resource = { id: 'r1', noteId: 'n1', filename: 'test.html', contentHash: 'h2', byteSize: 100 };
    const context = {
      notes: { get: vi.fn(async () => ({ id: 'n1', kind: 'text' })) },
      resources: {
        list: vi.fn(async () => [resource]),
        read: vi.fn(async () => new Blob([savedSource])),
        update: vi.fn(),
      },
      ui: { showNotice: vi.fn() },
    };
    return { drafts, context };
  }

  async function mount(context, drafts, onSaved = vi.fn()) {
    const controller = mountPanel(container, context, state, { drafts, onSaved });
    controllers = [...controllers, controller];
    await controller.ready;
    return controller;
  }

  function type(source) {
    const input = container.querySelector('textarea');
    expect(input).not.toBeNull();
    input.value = source;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  it('keeps the old baseline when a stale recovered draft is closed and reopened', async () => {
    const { context, drafts } = environment();
    await drafts.write('r1', { source: draftSource, baseHash: 'h1', noteId: 'n1' });
    const first = await mount(context, drafts);
    const save = () => [...container.querySelectorAll('button')].find(node => node.textContent === '保存并返回');
    expect(save().disabled).toBe(true);
    first.dispose();
    expect((await drafts.read('r1')).baseHash).toBe('h1');
    await mount(context, drafts);
    expect(save().disabled).toBe(true);
    expect(context.resources.update).not.toHaveBeenCalled();
  });

  it('clears a previous draft when the user undoes all changes before clean close', async () => {
    const { context, drafts } = environment();
    const controller = await mount(context, drafts);
    type(draftSource);
    expect((await drafts.read('r1')).source).toBe(draftSource);
    type(savedSource);
    expect(controller.beforeClose()).toBe(true);
    controller.dispose();
    expect(await drafts.read('r1')).toBeNull();
    await mount(context, drafts);
    expect(container.querySelector('textarea').value).toBe(savedSource);
  });

  it('does not let a disposed panels late save delete a newer panels draft', async () => {
    const { context, drafts } = environment();
    let finishSave;
    context.resources.update.mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
    const onSaved = vi.fn();
    const first = await mount(context, drafts, onSaved);
    type(draftSource);
    [...container.querySelectorAll('button')].find(node => node.textContent === '保存并返回').click();
    await vi.waitFor(() => expect(context.resources.update).toHaveBeenCalledTimes(1));
    // Another plugin can replace a panel without consulting beforeClose().
    first.dispose();
    await mount(context, drafts);
    const newerDraft = '<p>第二个面板的新草稿</p>';
    type(newerDraft);
    expect((await drafts.read('r1')).source).toBe(newerDraft);
    finishSave({ id: 'r1', noteId: 'n1', filename: 'test.html', contentHash: 'h3', byteSize: 100 });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect((await drafts.read('r1'))?.source).toBe(newerDraft);
  });
});
