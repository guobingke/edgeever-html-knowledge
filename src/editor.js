import { basicSetup, EditorView } from 'codemirror';
import { html } from '@codemirror/lang-html';

export function createEditor(container, source, onChange) {
  const view = new EditorView({
    doc: source,
    extensions: [
      basicSetup, html(), EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': 'HTML 源码', spellcheck: 'false' }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
    parent: container,
  });
  return { destroy: () => view.destroy(), focus: () => view.focus() };
}
