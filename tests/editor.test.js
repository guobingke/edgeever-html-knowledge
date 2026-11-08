import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

let dom;
let createEditor;
let EditorView;
let originals = new Map();
let instances = [];

beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://host.test/' });
  for (const name of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'Element', 'Node', 'Range', 'Window', 'DOMRect', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = typeof dom.window[name] === 'function' && /^(getComputedStyle|requestAnimationFrame|cancelAnimationFrame)$/.test(name)
      ? dom.window[name].bind(dom.window) : dom.window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  // JSDOM has no visual layout, but CodeMirror may measure selections after focus.
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
  ({ createEditor } = await import('../src/editor.js'));
  ({ EditorView } = await import('codemirror'));
});

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances = [];
  document.body.replaceChildren();
});

afterAll(() => {
  dom.window.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function mount(source, onChange = vi.fn()) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, source, onChange);
  instances = [...instances, editor];
  const view = EditorView.findFromDOM(parent.querySelector('.cm-editor'));
  return { parent, editor, view, onChange };
}

describe('real CodeMirror HTML source editor', () => {
  it('initializes with HTML source, accessible label, syntax support and line numbers', () => {
    const { parent, view, onChange } = mount('<!doctype html>\n<h1>中文</h1>');
    expect(view.state.doc.toString()).toBe('<!doctype html>\n<h1>中文</h1>');
    expect(parent.querySelector('.cm-content').getAttribute('aria-label')).toBe('HTML 源码');
    expect(parent.querySelector('.cm-content').getAttribute('spellcheck')).toBe('false');
    expect(parent.querySelector('.cm-lineNumbers')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports only document changes, focuses correctly, and releases editor DOM', () => {
    const { parent, view, editor, onChange } = mount('<p>before</p>');
    view.dispatch({ selection: { anchor: 0 } });
    expect(onChange).not.toHaveBeenCalled();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '<p>after</p>' } });
    expect(onChange).toHaveBeenLastCalledWith('<p>after</p>');
    editor.focus();
    expect(document.activeElement).toBe(parent.querySelector('.cm-content'));
    editor.destroy();
    expect(parent.querySelector('.cm-editor')).toBeNull();
  });
});
