import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

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

import plugin from '../src/main.js';
import { mountEmbed } from '../src/embed.js';
import { downloadHtml } from '../src/download.js';

const source = '<!doctype html><h1>HTML 测试</h1>';
const embed = { id: 'e1', title: 'article.html', resourceId: 'r1', data: { version: 1, noteId: 'n1', originalResourceId: 'original-1' } };
let dom;
let originalGlobals = new Map();
let cleanups = [];
let createUrl;
let revokeUrl;
let anchorClick;

function resource(overrides = {}) {
  return { id: 'r1', noteId: 'n1', filename: 'article.html', kind: 'attachment', mimeType: 'text/html', contentHash: 'h1', byteSize: new Blob([source]).size, ...overrides };
}

function container() {
  const node = document.createElement('div');
  document.body.append(node);
  return node;
}

function button(scope, label) {
  const result = [...scope.querySelectorAll('button')].find(item => item.textContent.trim() === label);
  expect(result, `Expected button ${label}`).toBeTruthy();
  return result;
}

function host() {
  const commands = new Map();
  const panels = new Map();
  const renderers = new Map();
  const events = new Map();
  const storage = new Map();
  const disposers = [];
  let panelCleanup;
  let panelContainer;
  let currentResource = resource();
  let currentSource = source;
  const register = map => vi.fn(value => {
    const key = value.id ?? value.type;
    map.set(key, value);
    const dispose = vi.fn(() => map.delete(key));
    disposers.push(dispose);
    return dispose;
  });
  const ctx = {
    storage: {
      get: vi.fn(async key => storage.get(key) ?? null),
      set: vi.fn(async (key, value) => storage.set(key, value)),
      remove: vi.fn(async key => storage.delete(key)),
    },
    commands: { register: register(commands) },
    editor: {
      getDocument: vi.fn().mockResolvedValue({ noteId: 'n1' }),
      insertEmbed: vi.fn(),
      embeds: { register: register(renderers) },
    },
    notes: { get: vi.fn().mockResolvedValue({ id: 'n1', kind: 'text' }) },
    resources: {
      list: vi.fn(async () => currentResource ? [{ ...currentResource }] : []),
      read: vi.fn(async () => new Blob([currentSource], { type: 'text/html' })),
      update: vi.fn(async (_id, { file }) => {
        currentSource = await file.text();
        currentResource = { ...currentResource, contentHash: 'h2' };
        return { ...currentResource };
      }),
      upload: vi.fn(),
    },
    ui: {
      showNotice: vi.fn(),
      panels: {
        register: register(panels),
        open: vi.fn(async (id, { state }) => {
          panelCleanup?.();
          panelContainer = container();
          panelCleanup = panels.get(id).mount(panelContainer, { state, shell: { set: vi.fn() } });
        }),
      },
    },
    events: { on: vi.fn((name, handler) => {
      events.set(name, handler);
      const dispose = vi.fn(() => events.delete(name));
      disposers.push(dispose);
      return dispose;
    }) },
  };
  return {
    ctx, commands, panels, renderers, events, disposers,
    panel: () => panelContainer,
    cleanupPanel: () => panelCleanup?.(),
    change(nextResource, nextSource) { currentResource = nextResource; currentSource = nextSource; },
  };
}

function activate() {
  const fixture = host();
  const deactivate = plugin.activate(fixture.ctx);
  cleanups = [...cleanups, deactivate, fixture.cleanupPanel];
  return { ...fixture, deactivate };
}

function mountRegistered(fixture, value = embed) {
  const node = container();
  const dispose = fixture.renderers.get('html-document').mount(node, value);
  cleanups = [...cleanups, dispose];
  return { node, dispose };
}

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://host.test/' });
  for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'CustomEvent']) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
  }
});

beforeEach(() => {
  createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:html-test');
  revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  anchorClick = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  for (const cleanup of [...cleanups].reverse()) cleanup();
  cleanups = [];
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  dom.window.close();
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('plugin lifecycle and current-note integration', () => {
  it('registers a preview panel, a native embed renderer, one command and resource listeners', () => {
    const fixture = activate();
    expect([...fixture.commands.keys()]).toEqual(['import-html']);
    expect(fixture.panels.get('html-document')).toEqual(expect.objectContaining({ purpose: 'preview', presentation: 'fullscreen' }));
    expect(fixture.renderers.has('html-document')).toBe(true);
    expect(fixture.events.has('resource.updated')).toBe(true);
    expect(fixture.events.has('resource.deleted')).toBe(true);
    expect(fixture.panels.get('html-document').beforeClose()).toBe(true);
  });

  it('opens import UI for the currently active note, not a separate library', async () => {
    const fixture = activate();
    await fixture.commands.get('import-html').run();
    expect(fixture.ctx.ui.panels.open).toHaveBeenCalledWith('html-document', { state: { noteId: 'n1' } });
    expect(fixture.panel().querySelector('input[type="file"]')).toBeTruthy();
  });

  it('reports missing active note without opening a panel', async () => {
    const fixture = activate();
    fixture.ctx.editor.getDocument.mockResolvedValue(null);
    await fixture.commands.get('import-html').run();
    expect(fixture.ctx.ui.showNotice).toHaveBeenCalledWith(expect.stringContaining('普通笔记'));
    expect(fixture.ctx.ui.panels.open).not.toHaveBeenCalled();
  });

  it('reports host panel-opening failures', async () => {
    const fixture = activate();
    fixture.ctx.ui.panels.open.mockRejectedValue(new Error('panel unavailable'));
    await fixture.commands.get('import-html').run();
    expect(fixture.ctx.ui.showNotice).toHaveBeenCalledWith(expect.stringContaining('panel unavailable'));
  });

  it('does not open another HTML panel while the current source is dirty', async () => {
    const fixture = activate();
    const { node } = mountRegistered(fixture);
    await vi.waitFor(() => expect(node.querySelector('iframe')).toBeTruthy());
    button(node, '编辑源码').click();
    await vi.waitFor(() => expect(fixture.panel().querySelector('textarea')).toBeTruthy());
    const editor = fixture.panel().querySelector('textarea');
    editor.value = '<p>dirty</p>';
    editor.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(fixture.panels.get('html-document').beforeClose()).toEqual(expect.objectContaining({ title: expect.any(String) }));
    await fixture.commands.get('import-html').run();
    expect(fixture.ctx.ui.panels.open).toHaveBeenCalledTimes(1);
    expect(fixture.ctx.ui.showNotice).toHaveBeenCalledWith(expect.stringContaining('请先保存或关闭'));
  });

  it('suppresses duplicate opens while the first open is still pending', async () => {
    const fixture = activate();
    let finish;
    fixture.ctx.ui.panels.open.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = fixture.commands.get('import-html').run();
    await vi.waitFor(() => expect(fixture.ctx.ui.panels.open).toHaveBeenCalledTimes(1));
    await fixture.commands.get('import-html').run();
    expect(fixture.ctx.ui.panels.open).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });

  it('removes registrations on deactivate and refuses later open actions', async () => {
    const fixture = activate();
    const command = fixture.commands.get('import-html');
    await command.run();
    fixture.deactivate();
    expect(fixture.panel().querySelector('.html-tools')).toBeNull();
    for (const dispose of fixture.disposers) expect(dispose).toHaveBeenCalled();
    const calls = fixture.ctx.ui.panels.open.mock.calls.length;
    await command.run();
    expect(fixture.ctx.ui.panels.open).toHaveBeenCalledTimes(calls);
  });
});

describe('native HTML embed', () => {
  it('loads an isolated preview by default and forwards the edit action as state', async () => {
    const fixture = activate();
    const { node } = mountRegistered(fixture);
    await vi.waitFor(() => expect(node.querySelector('iframe')).toBeTruthy());
    expect(node.querySelector('textarea')).toBeNull();
    expect(node.querySelector('iframe').getAttribute('sandbox')).toBe('allow-scripts');
    button(node, '编辑源码').click();
    await vi.waitFor(() => expect(fixture.ctx.ui.panels.open).toHaveBeenCalledWith('html-document', {
      state: { noteId: 'n1', resourceId: 'r1', originalResourceId: 'original-1', edit: true },
    }));
    await vi.waitFor(() => expect(fixture.panel().querySelector('textarea')).toBeTruthy());
  });

  it('opens the large preview without entering source mode', async () => {
    const fixture = activate();
    const { node } = mountRegistered(fixture, { ...embed, data: { version: 1, noteId: 'n1' } });
    await vi.waitFor(() => expect(node.querySelector('iframe')).toBeTruthy());
    button(node, '打开大预览').click();
    await vi.waitFor(() => expect(fixture.ctx.ui.panels.open).toHaveBeenCalledWith('html-document', {
      state: { noteId: 'n1', resourceId: 'r1', originalResourceId: undefined, edit: false },
    }));
    await vi.waitFor(() => expect(fixture.panel().querySelector('iframe')).toBeTruthy());
    expect(fixture.panel().querySelector('textarea')).toBeNull();
  });

  it('exports the loaded HTML through a sanitized download link', async () => {
    const fixture = activate();
    const { node } = mountRegistered(fixture);
    await vi.waitFor(() => expect(node.querySelector('iframe')).toBeTruthy());
    button(node, '导出 HTML').click();
    expect(createUrl).toHaveBeenCalled();
    expect(await createUrl.mock.calls[0][0].text()).toBe(source);
    expect(anchorClick).toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('enables external HTTPS resources only after an explicit checkbox action', async () => {
    const fixture = activate();
    const { node } = mountRegistered(fixture);
    await vi.waitFor(() => expect(node.querySelector('iframe')).toBeTruthy());
    expect(node.querySelector('iframe').srcdoc).toContain("connect-src 'none'");
    const checkbox = node.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(node.querySelector('iframe').srcdoc).toContain('connect-src https:');
    expect(node.querySelector('[role="alert"]').hidden).toBe(false);
    checkbox.checked = false;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(node.querySelector('iframe').srcdoc).toContain("connect-src 'none'");
  });

  it('refreshes changed attachments on resource updates and reports deletion', async () => {
    const fixture = activate();
    const { node } = mountRegistered(fixture);
    await vi.waitFor(() => expect(node.querySelector('iframe')).toBeTruthy());
    fixture.change(resource({ contentHash: 'h2' }), '<p>updated</p>');
    fixture.events.get('resource.updated')({ resource: resource({ contentHash: 'h2' }) });
    await vi.waitFor(() => expect(node.querySelector('iframe').srcdoc).toContain('updated'));
    fixture.change(null, '');
    fixture.events.get('resource.deleted')({ resourceId: 'r1' });
    await vi.waitFor(() => expect(node.querySelector('[role="alert"]').hidden).toBe(false));
    expect(node.textContent).toContain('找不到');
  });

  it('preserves the running frame when a notification has the same hash, but manual refresh resets it', async () => {
    const fixture = activate();
    const { node } = mountRegistered(fixture);
    await vi.waitFor(() => expect(node.querySelector('iframe')).toBeTruthy());
    const before = node.querySelector('iframe');
    const reads = fixture.ctx.resources.read.mock.calls.length;
    fixture.events.get('resource.updated')({ resource: resource() });
    await vi.waitFor(() => expect(fixture.ctx.resources.read.mock.calls.length).toBeGreaterThan(reads));
    expect(node.querySelector('iframe')).toBe(before);
    button(node, '刷新预览').click();
    await vi.waitFor(() => expect(node.querySelector('iframe')).not.toBe(before));
  });

  it('keeps remaining subscribers after one instance is disposed', async () => {
    const fixture = activate();
    const first = mountRegistered(fixture);
    const second = mountRegistered(fixture);
    await vi.waitFor(() => expect(second.node.querySelector('iframe')).toBeTruthy());
    first.dispose();
    fixture.change(resource({ contentHash: 'h2' }), '<p>second instance</p>');
    fixture.events.get('resource.updated')({ resource: resource({ contentHash: 'h2' }) });
    await vi.waitFor(() => expect(second.node.querySelector('iframe').srcdoc).toContain('second instance'));
    expect(first.node.querySelector('iframe')).toBeNull();
  });

  it.each([null, {}, { version: 2, noteId: 'n1' }])('rejects invalid embed data %j without reading attachments', async data => {
    const fixture = activate();
    const { node } = mountRegistered(fixture, { ...embed, title: '', data });
    await vi.waitFor(() => expect(node.querySelector('[role="alert"]').hidden).toBe(false));
    expect(fixture.ctx.resources.read).not.toHaveBeenCalled();
    button(node, '编辑源码').click();
    button(node, '打开大预览').click();
    expect(fixture.ctx.ui.panels.open).not.toHaveBeenCalled();
  });

  it('shows read failures and refuses exporting before a snapshot exists', async () => {
    const fixture = activate();
    fixture.ctx.resources.read.mockRejectedValue(new Error('read failed'));
    const { node } = mountRegistered(fixture);
    await vi.waitFor(() => expect(node.textContent).toContain('read failed'));
    button(node, '导出 HTML').click();
    expect(node.textContent).toContain('请先载入');
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('does not revive a disposed embed after a pending read completes', async () => {
    const fixture = activate();
    let finish;
    fixture.ctx.resources.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { node, dispose } = mountRegistered(fixture);
    await vi.waitFor(() => expect(fixture.ctx.resources.read).toHaveBeenCalled());
    dispose();
    finish(new Blob([source]));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(node.children.length).toBe(0);
  });

  it('shows both synchronous and asynchronous open failures', async () => {
    const fixture = host();
    const open = vi.fn().mockImplementationOnce(() => { throw new Error('sync open failed'); })
      .mockRejectedValueOnce(new Error('async open failed'));
    const node = container();
    cleanups = [...cleanups, mountEmbed(node, fixture.ctx, embed, { open, subscribe: () => () => {} })];
    await vi.waitFor(() => expect(node.querySelector('iframe')).toBeTruthy());
    button(node, '编辑源码').click();
    expect(node.textContent).toContain('sync open failed');
    button(node, '打开大预览').click();
    await vi.waitFor(() => expect(node.textContent).toContain('async open failed'));
  });

  it('ignores obsolete reads that finish after a newer manual refresh', async () => {
    const fixture = activate();
    let first;
    fixture.ctx.resources.read.mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
      .mockResolvedValueOnce(new Blob(['<p>latest read</p>']));
    const { node } = mountRegistered(fixture);
    await vi.waitFor(() => expect(fixture.ctx.resources.read).toHaveBeenCalledTimes(1));
    button(node, '刷新预览').click();
    await vi.waitFor(() => expect(node.querySelector('iframe').srcdoc).toContain('latest read'));
    first(new Blob(['<p>obsolete read</p>']));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(node.querySelector('iframe').srcdoc).toContain('latest read');
  });

  it('uses the authoritative resource owner after a note was copied with stale embed metadata', async () => {
    const fixture = activate();
    fixture.change(resource({ noteId: 'copied-note' }), source);
    fixture.ctx.notes.get.mockImplementation(async noteId => ({ id: noteId, kind: 'text' }));
    const { node } = mountRegistered(fixture, { ...embed, data: { ...embed.data, noteId: 'old-note' } });
    await vi.waitFor(() => expect(node.querySelector('iframe')).toBeTruthy());
    expect(fixture.ctx.resources.list).toHaveBeenCalledWith('copied-note');
    button(node, '编辑源码').click();
    await vi.waitFor(() => expect(fixture.ctx.ui.panels.open).toHaveBeenCalledWith('html-document', {
      state: expect.objectContaining({ noteId: 'copied-note', resourceId: 'r1', edit: true }),
    }));
  });

  it('asks users to wait instead of opening an editor before attachment ownership is loaded', async () => {
    const fixture = activate();
    let finish;
    fixture.ctx.resources.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { node } = mountRegistered(fixture);
    await vi.waitFor(() => expect(fixture.ctx.resources.read).toHaveBeenCalled());
    button(node, '编辑源码').click();
    expect(node.textContent).toContain('请先等待 HTML 载入成功');
    expect(fixture.ctx.ui.panels.open).not.toHaveBeenCalled();
    finish(new Blob([source]));
    await vi.waitFor(() => expect(node.querySelector('iframe')).toBeTruthy());
  });
});

describe('HTML download resource lifecycle', () => {
  it('sanitizes filenames, removes the anchor, and revokes its URL after download starts', () => {
    vi.useFakeTimers();
    downloadHtml('<p>export</p>', 'bad:/\\*?"<>|name.html');
    const anchor = anchorClick.mock.instances[0];
    expect(anchor.download).toBe('bad_________name.html');
    expect(anchor.isConnected).toBe(false);
    expect(revokeUrl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(revokeUrl).toHaveBeenCalledWith('blob:html-test');
  });

  it('passes original Blob bytes through without transcoding and provides a default filename', () => {
    vi.useFakeTimers();
    const original = new Blob([new Uint8Array([0xff, 0xfe, 0x41, 0x00])]);
    downloadHtml(original);
    expect(createUrl).toHaveBeenCalledWith(original);
    expect(anchorClick.mock.instances[0].download).toBe('document.html');
    vi.advanceTimersByTime(30_000);
  });
});
