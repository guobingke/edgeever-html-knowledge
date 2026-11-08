import { importHtml, loadDocument, saveDocument, errorMessage, utf8Html } from './core.js';
import { createPreview } from './preview.js';
import { createEditor } from './editor.js';
import { downloadHtml } from './download.js';
import { rootElement, element, button } from './styles.js';

export function mountPanel(container, context, initialState, { drafts, onSaved }) {
  const root = rootElement(container);
  const bar = element('div', 'ht-bar');
  const title = element('strong', 'ht-title', 'HTML 预览与编辑');
  const status = element('span', 'ht-status', '正在载入…');
  status.setAttribute('role', 'status');
  const tools = element('div', 'ht-bar');
  const warning = element('div', 'ht-error');
  warning.setAttribute('role', 'alert');
  warning.hidden = true;
  const confirmation = element('div', 'ht-confirm');
  confirmation.hidden = true;
  const body = element('div', 'ht-body');
  const sourcePane = element('div', 'ht-source');
  const previewPane = element('div', 'ht-preview');
  const footer = element('div', 'ht-footer');
  const networkInput = document.createElement('input');
  networkInput.type = 'checkbox';
  const networkLabel = element('label', 'ht-network');
  networkLabel.append(networkInput, document.createTextNode('允许外部 HTTPS 资源'));
  footer.append(networkLabel, element('span', '', '脚本隔离运行 · 页面交互状态不会写回源码'), element('small', '', '作者：过冰客'));
  bar.append(title, status);
  body.append(sourcePane, previewPane);
  root.append(bar, tools, warning, confirmation, body, footer);

  let state = { ...initialState };
  let snapshot = null;
  let source = '';
  let editor = null;
  let editing = false;
  let split = false;
  let busy = true;
  let disposed = false;
  let staleDraft = false;
  let draftBaseHash = null;
  let lastDraft = null;
  const dirty = () => snapshot !== null && source !== snapshot.source;
  const showError = error => {
    if (disposed) return;
    warning.textContent = errorMessage(error);
    warning.hidden = false;
  };
  const run = action => () => {
    if (busy || disposed) return;
    try { Promise.resolve(action()).catch(showError); }
    catch (error) { showError(error); }
  };

  function persistDraft() {
    if (snapshot && dirty()) {
      lastDraft = { source, baseHash: draftBaseHash, noteId: state.noteId };
      void drafts.write(state.resourceId, lastDraft);
    } else if (snapshot) {
      void clearOwnDraft();
    }
  }

  function clearOwnDraft(expected = lastDraft) {
    if (!expected) return Promise.resolve();
    if (lastDraft === expected) lastDraft = null;
    return drafts.clear(state.resourceId, expected);
  }

  function refreshPreview() {
    if (!disposed && snapshot) previewPane.replaceChildren(createPreview(source, { network: networkInput.checked }));
  }

  function updateTools() {
    if (disposed) return;
    status.textContent = busy ? '处理中…' : dirty() ? '有未保存修改 · 本地草稿' : '已载入';
    const actions = [];
    if (snapshot) {
      if (!editing) actions.push(button('编辑源码', run(() => setEditing(true)), true));
      else {
        const saveButton = button('保存并返回', run(save), true);
        saveButton.disabled = busy || staleDraft;
        actions.push(saveButton, button('预览效果', run(() => { split = true; renderLayout(); refreshPreview(); })));
        actions.push(button(split ? '仅源码' : '分屏', run(() => { split = !split; renderLayout(); refreshPreview(); })));
        actions.push(button('返回预览', run(() => confirmDiscard('放弃修改并返回', () => {
          source = snapshot.source;
          void clearOwnDraft();
          staleDraft = false;
          draftBaseHash = snapshot.resource.contentHash;
          setEditing(false);
        }))));
      }
      actions.push(button('重新载入', run(() => confirmDiscard('放弃修改并重新载入', async () => {
        const discarded = lastDraft;
        await reload(false);
        await clearOwnDraft(discarded);
      }))));
      actions.push(button('导出 HTML', run(() => downloadHtml(utf8Html(source), snapshot.resource.filename))));
      if (state.originalResourceId) actions.push(button('导出原件', run(exportOriginal)));
    }
    for (const action of actions) action.disabled ||= busy;
    tools.replaceChildren(...actions);
    networkInput.disabled = busy || !snapshot;
    sourcePane.inert = busy;
  }

  function renderLayout() {
    sourcePane.hidden = !editing;
    previewPane.hidden = editing && !split;
    updateTools();
  }

  function setEditing(value) {
    if (editor) { editor.destroy(); editor = null; sourcePane.replaceChildren(); }
    editing = value;
    if (value) {
      editor = createEditor(sourcePane, source, value => {
        source = value;
        persistDraft();
        updateTools();
      });
      editor.focus();
    } else { split = false; refreshPreview(); }
    renderLayout();
  }

  function confirmDiscard(label, action) {
    if (!dirty()) return action();
    confirmation.hidden = false;
    confirmation.setAttribute('role', 'alertdialog');
    confirmation.replaceChildren(element('div', '', '有未保存的源码。建议先导出，再放弃修改。'));
    const cancel = button('继续编辑', () => { confirmation.hidden = true; });
    const confirm = button(label, run(async () => {
      confirmation.hidden = true;
      await action();
    }));
    confirmation.append(confirm, cancel);
  }

  async function save() {
    if (!snapshot || staleDraft) return;
    busy = true;
    warning.hidden = true;
    confirmation.hidden = true;
    updateTools();
    const sent = source;
    const sentDraft = lastDraft;
    try {
      const saved = await saveDocument(context, snapshot, sent);
      // The write may finish after the host has replaced/unmounted this panel.
      snapshot = saved;
      draftBaseHash = saved.resource.contentHash;
      onSaved(saved.resource);
      if (source === sent) {
        source = saved.source;
        await clearOwnDraft(sentDraft);
        if (!disposed) setEditing(false);
      } else persistDraft();
    } catch (error) {
      persistDraft();
      showError(error);
    } finally {
      busy = false;
      updateTools();
    }
  }

  async function reload(restoreDraft) {
    busy = true;
    updateTools();
    try {
      const next = await loadDocument(context, state.noteId, state.resourceId);
      const draft = restoreDraft ? await drafts.read(state.resourceId) : null;
      if (disposed) return;
      snapshot = next;
      source = draft?.source ?? next.source;
      staleDraft = Boolean(draft && draft.baseHash !== next.resource.contentHash);
      draftBaseHash = draft?.baseHash ?? next.resource.contentHash;
      lastDraft = draft;
      title.textContent = next.resource.filename;
      warning.hidden = true;
      if (draft) {
        warning.textContent = staleDraft
          ? '已恢复本地草稿，但附件版本已变化。为避免覆盖，暂时禁止保存；请导出草稿，再重新载入。'
          : '已恢复未保存的本地草稿。';
        warning.hidden = false;
      }
      setEditing(Boolean(draft) || Boolean(state.edit));
      refreshPreview();
    } finally {
      busy = false;
      updateTools();
    }
  }

  async function exportOriginal() {
    const resources = await context.resources.list(state.noteId);
    const original = resources.find(item => item.id === state.originalResourceId && item.noteId === state.noteId);
    if (!original) throw new Error('找不到原件附件。');
    const blob = await context.resources.read(original.id);
    if (!disposed) downloadHtml(blob, original.filename);
  }

  function showImport() {
    sourcePane.hidden = true;
    previewPane.hidden = true;
    const empty = element('div', 'ht-empty');
    const drop = element('div', 'ht-drop');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm,text/html';
    input.setAttribute('aria-label', '选择本地 HTML 文件');
    drop.append(element('h3', '', '将 HTML 放进当前笔记'), element('p', '', '选择或拖入一个本地单文件 HTML（最大 10 MiB）。默认预览，按需编辑源码。'), input);
    empty.append(drop, element('p', '', '导入原件会单独保留。不修改电脑上的源文件，也不另建知识库。'));
    body.append(empty);
    const accept = async file => {
      if (!file || busy || disposed) return;
      busy = true;
      input.disabled = true;
      warning.hidden = true;
      updateTools();
      try {
        const embed = await importHtml(context, state.noteId, file);
        state = { ...embed.data, resourceId: embed.resourceId };
        if (disposed) return;
        empty.remove();
        context.ui.showNotice('HTML 预览块已插入当前笔记；请按宿主正常流程保存笔记。');
        await reload(false);
      } catch (error) { showError(error); }
      finally { busy = false; input.disabled = false; updateTools(); }
    };
    input.addEventListener('change', () => { void accept(input.files?.[0]); });
    drop.addEventListener('dragover', event => { event.preventDefault(); drop.dataset.drag = 'true'; });
    drop.addEventListener('dragleave', () => { delete drop.dataset.drag; });
    drop.addEventListener('drop', event => {
      event.preventDefault();
      delete drop.dataset.drag;
      if (event.dataTransfer?.files.length !== 1) showError(new Error('请一次导入一个 HTML 文件。'));
      else void accept(event.dataTransfer.files[0]);
    });
    busy = false;
    updateTools();
  }

  networkInput.addEventListener('change', () => {
    if (networkInput.checked) {
      warning.textContent = '已允许页面向外部 HTTPS 地址加载资源和发送数据。仅对可信页面启用；刷新会重置页面交互状态。';
      warning.hidden = false;
    }
    refreshPreview();
  });

  const ready = (async () => {
    if (state.resourceId) await reload(true);
    else showImport();
  })().catch(error => { busy = false; showError(error); updateTools(); });

  return {
    ready,
    beforeClose() {
      if (busy) return false;
      return dirty() ? { title: '源码尚未保存', message: '关闭后会保留本地恢复草稿，但不会更新笔记附件。建议先保存或导出 HTML。', confirmLabel: '保留草稿并关闭' } : true;
    },
    dispose() {
      if (disposed) return;
      persistDraft();
      disposed = true;
      editor?.destroy();
      root.remove();
    },
  };
}
