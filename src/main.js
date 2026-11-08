import { mountPanel } from './panel.js';
import { mountEmbed } from './embed.js';
import { createDrafts } from './drafts.js';
import { errorMessage } from './core.js';

export default {
  activate(context) {
    const listeners = new Map();
    const drafts = createDrafts(context.storage, message => context.ui.showNotice(message));
    let current = null;
    let opening = false;
    let active = true;
    const notify = resource => {
      if (!active) return;
      for (const listener of listeners.get(resource.id) ?? []) listener();
    };
    const subscribe = (id, listener) => {
      const next = new Set(listeners.get(id) ?? []);
      next.add(listener);
      listeners.set(id, next);
      return () => {
        const remaining = new Set(listeners.get(id) ?? []);
        remaining.delete(listener);
        if (remaining.size) listeners.set(id, remaining);
        else listeners.delete(id);
      };
    };
    async function open(state) {
      if (!active || opening) return;
      if (current && current.beforeClose() !== true) {
        context.ui.showNotice('请先保存或关闭当前 HTML 编辑面板，再打开另一个 HTML。');
        return;
      }
      opening = true;
      try { await context.ui.panels.open('html-document', { state }); }
      finally { opening = false; }
    }
    const disposers = [
      context.ui.panels.register({
        id: 'html-document', title: 'HTML 预览与编辑', purpose: 'preview', presentation: 'fullscreen',
        mount(container, { state, shell }) {
          shell.set({ header: { title: 'HTML 预览与编辑', description: '为现有笔记补充 HTML 能力 · 作者：过冰客' } });
          const controller = mountPanel(container, context, state ?? {}, { drafts, onSaved: notify });
          current = controller;
          return () => {
            controller.dispose();
            if (current === controller) current = null;
          };
        },
        beforeClose: () => current?.beforeClose() ?? true,
      }),
      context.editor.embeds.register({
        type: 'html-document',
        mount: (container, embed) => mountEmbed(container, context, embed, { open, subscribe }),
      }),
      context.commands.register({
        id: 'import-html', title: 'HTML：导入到当前笔记',
        async run() {
          try {
            const doc = await context.editor.getDocument();
            if (!doc) throw new Error('请先打开一篇普通笔记并进入编辑状态。');
            await open({ noteId: doc.noteId });
          } catch (error) { context.ui.showNotice(errorMessage(error)); }
        },
      }),
      context.events.on('resource.updated', ({ resource }) => notify(resource)),
      context.events.on('resource.deleted', ({ resourceId }) => notify({ id: resourceId })),
    ];
    return () => {
      active = false;
      current?.dispose();
      for (const dispose of [...disposers].reverse()) dispose();
      listeners.clear();
    };
  },
};
