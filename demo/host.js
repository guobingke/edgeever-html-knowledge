import plugin from '../dist/main.js';

const KEY = 'html-tools-demo:v1';
const pluginId = 'com.guobingke.html-tools';
const empty = () => ({ resources: [], embeds: [], storage: {} });
let state;
try { state = JSON.parse(localStorage.getItem(KEY) || 'null') || empty(); } catch { state = empty(); }
const commands = new Map();
const panels = new Map();
const renderers = new Map();
const events = new Map();
let embedDisposers = [];
let panelDispose;
let panelNode;
let activePanel;
let noticeTimer;

const persist = () => localStorage.setItem(KEY, JSON.stringify(state));
const copy = value => structuredClone(value);
const encode = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
const decode = encoded => Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
const metadata = item => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'bytes'));
async function hash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function emit(name, payload) { for (const handler of events.get(name) || []) handler(payload); }
function notice(message) {
  document.querySelector('.host-notice').textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { document.querySelector('.host-notice').textContent = ''; }, 8000);
}
function renderEmbeds() {
  for (const dispose of embedDisposers) dispose?.();
  embedDisposers = [];
  const root = document.querySelector('#host-embeds');
  root.replaceChildren();
  for (const embed of state.embeds) {
    const node = document.createElement('div');
    root.append(node);
    const renderer = renderers.get(embed.type);
    if (renderer) embedDisposers.push(renderer.mount(node, copy(embed)));
    else node.textContent = embed.title;
  }
}
function forceClose() {
  panelDispose?.();
  panelDispose = null;
  panelNode?.remove();
  panelNode = null;
  activePanel = null;
  document.querySelector('.host-confirm')?.remove();
}
async function requestClose() {
  const decision = await activePanel?.beforeClose?.() ?? true;
  if (decision === false) { notice('处理中，请稍候再关闭。'); return; }
  if (decision === true) { forceClose(); return; }
  const overlay = document.createElement('div');
  overlay.className = 'host-confirm';
  overlay.setAttribute('role', 'alertdialog');
  const box = document.createElement('div');
  const title = document.createElement('h3'); title.textContent = decision.title;
  const message = document.createElement('p'); message.textContent = decision.message;
  const cancel = document.createElement('button'); cancel.textContent = '继续编辑';
  cancel.onclick = () => overlay.remove();
  const confirm = document.createElement('button'); confirm.textContent = decision.confirmLabel || '关闭';
  confirm.onclick = forceClose;
  box.append(title, message, cancel, confirm); overlay.append(box); document.body.append(overlay);
}
async function openPanel(id, options) {
  forceClose();
  activePanel = panels.get(id);
  if (!activePanel) throw new Error('Panel not registered');
  panelNode = document.createElement('section'); panelNode.className = 'host-panel';
  const bar = document.createElement('header'); bar.className = 'host-panel-header';
  const title = document.createElement('strong'); title.textContent = activePanel.title;
  const close = document.createElement('button'); close.className = 'host-close'; close.textContent = '关闭 HTML 面板';
  close.onclick = () => { void requestClose(); };
  const content = document.createElement('div'); content.className = 'host-panel-content';
  bar.append(title, close); panelNode.append(bar, content); document.body.append(panelNode);
  panelDispose = await activePanel.mount(content, {
    state: options?.state ?? null, requestClose,
    shell: { set(chrome) { if (chrome.header?.title) title.textContent = chrome.header.title; } },
  });
}

const context = {
  pluginId,
  notes: { async get(id) { if (id !== 'note-1') throw new Error('Missing note'); return { id, kind: 'text', title: '我的普通笔记' }; } },
  editor: {
    async getDocument() { return { noteId: 'note-1', contentMarkdown: '原有笔记内容', hasUnsavedChanges: false }; },
    async insertEmbed(input) {
      const embed = { ...input, id: `embed_${crypto.randomUUID()}`, pluginId, previewResourceId: '' };
      state = { ...state, embeds: [...state.embeds, embed] }; persist(); renderEmbeds(); return copy(embed);
    },
    embeds: {
      register(renderer) { renderers.set(renderer.type, renderer); return () => { renderers.delete(renderer.type); }; },
    },
  },
  resources: {
    async list(noteId) { return state.resources.filter(item => !noteId || item.noteId === noteId).map(metadata); },
    async read(id) {
      const item = state.resources.find(resource => resource.id === id);
      if (!item) throw new Error('Missing resource');
      return new Blob([decode(item.bytes)], { type: item.mimeType });
    },
    async upload(noteId, file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const item = {
        id: `resource_${crypto.randomUUID()}`, noteId, kind: 'attachment', filename: file.name,
        mimeType: file.type, byteSize: bytes.length, contentHash: await hash(bytes), bytes: encode(bytes),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), url: '', width: null, height: null,
      };
      state = { ...state, resources: [...state.resources, item] }; persist();
      emit('resource.created', { resource: metadata(item) }); return metadata(item);
    },
    async update(id, input) {
      const current = state.resources.find(item => item.id === id);
      if (!current || current.contentHash !== input.expectedContentHash) throw Object.assign(new Error('Resource conflict'), { code: 'RESOURCE_CONFLICT' });
      const bytes = new Uint8Array(await input.file.arrayBuffer());
      const replacement = { ...current, filename: input.file.name, mimeType: input.file.type, byteSize: bytes.length, contentHash: await hash(bytes), bytes: encode(bytes), updatedAt: new Date().toISOString() };
      // Recheck after async conversion, as the real host's compare-and-swap does.
      if (state.resources.find(item => item.id === id)?.contentHash !== input.expectedContentHash) throw Object.assign(new Error('Resource conflict'), { code: 'RESOURCE_CONFLICT' });
      state = { ...state, resources: state.resources.map(item => item.id === id ? replacement : item) }; persist();
      emit('resource.updated', { resource: metadata(replacement) }); return metadata(replacement);
    },
  },
  storage: {
    async get(key) { return copy(state.storage[key] ?? null); },
    async set(key, value) { state = { ...state, storage: { ...state.storage, [key]: copy(value) } }; persist(); },
    async remove(key) { const storage = { ...state.storage }; delete storage[key]; state = { ...state, storage }; persist(); },
  },
  commands: {
    register(command) {
      commands.set(command.id, command);
      const button = document.createElement('button'); button.textContent = command.title;
      button.onclick = () => { void command.run(); }; document.querySelector('#host-commands').append(button);
      return () => { commands.delete(command.id); button.remove(); };
    },
  },
  events: {
    on(name, callback) {
      const set = new Set(events.get(name) ?? []); set.add(callback); events.set(name, set);
      return () => { events.get(name)?.delete(callback); };
    },
  },
  ui: { showNotice: notice, panels: { register(panel) { panels.set(panel.id, panel); return () => panels.delete(panel.id); }, open: openPanel } },
};
const deactivate = plugin.activate(context);
renderEmbeds();
window.demo = {
  context, commands, forceClose, deactivate,
  snapshot: () => copy(state),
  sources: () => state.resources.map(item => new TextDecoder().decode(decode(item.bytes))),
  async changeWorking(source) {
    const embed = state.embeds[0];
    const current = state.resources.find(item => item.id === embed.resourceId);
    await context.resources.update(current.id, { file: new File([source], current.filename, { type: 'text/html;charset=utf-8' }), expectedContentHash: current.contentHash });
  },
};
document.addEventListener('keydown', event => { if (event.key === 'Escape' && activePanel) void requestClose(); });
