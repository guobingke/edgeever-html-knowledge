import { loadDocument, errorMessage, utf8Html } from './core.js';
import { createPreview } from './preview.js';
import { downloadHtml } from './download.js';
import { rootElement, element, button } from './styles.js';

export function mountEmbed(container, context, embed, { open, subscribe }) {
  const root = rootElement(container, true);
  const bar = element('div', 'ht-bar');
  const title = element('strong', 'ht-title', embed.title || 'HTML');
  const warning = element('div', 'ht-error');
  warning.setAttribute('role', 'alert');
  warning.hidden = true;
  const preview = element('div', 'ht-preview');
  const footer = element('div', 'ht-footer');
  const network = document.createElement('input');
  network.type = 'checkbox';
  const label = element('label', 'ht-network');
  label.append(network, document.createTextNode('允许外部 HTTPS 资源'));
  footer.append(label, element('small', '', 'HTML 预览与编辑 · 过冰客'));
  root.append(bar, warning, preview, footer);

  const data = embed.data;
  const valid = data && typeof data === 'object' && data.version === 1 && typeof data.noteId === 'string' && typeof embed.resourceId === 'string';
  let snapshot = null;
  let disposed = false;
  let generation = 0;
  let timer;
  const error = value => {
    if (disposed) return;
    warning.textContent = errorMessage(value);
    warning.hidden = false;
  };
  const redraw = () => {
    if (snapshot && !disposed) preview.replaceChildren(createPreview(snapshot.source, { network: network.checked }));
  };
  const invoke = action => () => {
    try { Promise.resolve(action()).catch(error); } catch (cause) { error(cause); }
  };
  function openState(editing) {
    if (!snapshot) throw new Error('请先等待 HTML 载入成功，再打开预览或编辑。');
    return open({
      noteId: snapshot.resource.noteId, resourceId: embed.resourceId,
      originalResourceId: typeof data.originalResourceId === 'string' ? data.originalResourceId : undefined,
      edit: editing,
    });
  }

  async function load(force = false) {
    const ticket = ++generation;
    try {
      if (!valid) throw new Error('HTML 预览块数据无效或版本不支持，请重新导入。');
      // The host remaps attachment IDs on note duplication, but not data.noteId.
      // Resolve the exact resource's authoritative owner rather than the stale hint.
      const resources = await context.resources.list();
      const owner = resources.find(resource => resource.id === embed.resourceId)?.noteId;
      if (!owner) throw new Error('找不到 HTML 附件，请完成同步后刷新，或重新导入。');
      const next = await loadDocument(context, owner, embed.resourceId);
      if (disposed || ticket !== generation) return;
      const changed = next.resource.contentHash !== snapshot?.resource.contentHash;
      snapshot = next;
      title.textContent = next.resource.filename;
      warning.hidden = true;
      if (changed || force) redraw();
    } catch (cause) { if (ticket === generation) error(cause); }
  }

  bar.append(title,
    button('打开大预览', invoke(() => { if (valid) return openState(false); })),
    button('编辑源码', invoke(() => { if (valid) return openState(true); })),
    button('刷新预览', invoke(() => load(true))),
    button('导出 HTML', invoke(() => {
      if (!snapshot) throw new Error('请先载入 HTML。');
      downloadHtml(utf8Html(snapshot.source), snapshot.resource.filename);
    })),
  );
  network.addEventListener('change', () => {
    redraw();
    if (network.checked) {
      warning.textContent = '已允许页面加载外部 HTTPS 资源和发送数据，仅对可信 HTML 启用。';
      warning.hidden = false;
    }
  });
  const unsubscribe = subscribe(embed.resourceId, () => {
    clearTimeout(timer);
    timer = setTimeout(() => { void load(); }, 40);
  });
  void load();
  return () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    clearTimeout(timer);
    unsubscribe();
    root.remove();
  };
}
