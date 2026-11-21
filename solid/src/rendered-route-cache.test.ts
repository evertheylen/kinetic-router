import { afterEach, describe, expect, it, vi } from 'vitest';
import { route } from '@kinetic-router/definition';
import { onCleanup, runWithOwner } from 'solid-js';
import type { Page } from './page.js';
import { createParamStorage } from './params.js';
import { createPageLifecycle, type RenderedRoute } from './rendered-route.js';
import { RenderedRouteCache } from './rendered-route-cache.js';

const created: RenderedRoute[] = [];

function page(parent?: RenderedRoute) {
  const definition = parent?.route.nestedRoute({}) ?? route({});
  const html = document.createElement('section');
  const implementation: Page<{}> = {
    untrackedKeys: [],
    async render() { return () => ({ html, title: '' }); },
  };
  const params = createParamStorage({
    route: definition, implementation, paramMap: new Map(),
    parent: parent?.renderArgs.params,
  });
  const lifecycle = runWithOwner(params.owner, createPageLifecycle);
  const cleanup = vi.fn();
  runWithOwner(params.owner, () => onCleanup(cleanup));
  const rendered: RenderedRoute = {
    route: definition, implementation, lifecycle,
    renderArgs: { params, pageStatus: lifecycle.status }, renderOutput: { html, title: '' },
    subOutlet: undefined,
  };
  created.push(rendered);
  return { rendered, html, cleanup };
}

afterEach(() => {
  for (const rendered of created.splice(0).reverse()) rendered.renderArgs.params.dispose();
});

describe('RenderedRouteCache', () => {
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid limit %s', limit => {
    expect(() => new RenderedRouteCache(limit)).toThrow(RangeError);
  });

  it('defaults to ten pages', () => {
    const cache = new RenderedRouteCache();
    const pages = Array.from({ length: 11 }, () => page());
    pages.forEach(({ rendered }, i) => cache.markUsedFor(String(i), [rendered]));
    expect(cache.cache.size).toBe(10);
    expect(cache.get('0')).toBeUndefined();
    expect(pages[0].cleanup).toHaveBeenCalledOnce();
    expect(pages[10].cleanup).not.toHaveBeenCalled();
  });

  it('evicts the least recently visited stack, not the oldest created page', () => {
    const cache = new RenderedRouteCache(2);
    const a = page(), b = page(), c = page();
    cache.markUsedFor('a', [a.rendered]);
    cache.markUsedFor('b', [b.rendered]);
    cache.markUsedFor('a', cache.get('a')!);
    cache.markUsedFor('c', [c.rendered]);
    expect([...cache.cache.keys()]).toEqual(['a', 'c']);
    expect(b.cleanup).toHaveBeenCalledOnce();
    expect(a.cleanup).not.toHaveBeenCalled();
    expect(c.cleanup).not.toHaveBeenCalled();
  });

  it('counts shared ancestors once and evicts whole stacks', () => {
    const cache = new RenderedRouteCache(3);
    const parent = page();
    const a = page(parent.rendered), b = page(parent.rendered), outside = page();
    cache.markUsedFor('a', [parent.rendered, a.rendered]);
    cache.markUsedFor('b', [parent.rendered, b.rendered]);
    expect([...cache.cache.keys()]).toEqual(['a', 'b']);

    // The inactive parent still holds a's DOM; eviction must detach it too.
    parent.html.append(a.html);
    cache.markUsedFor('outside', [outside.rendered]);
    expect([...cache.cache.keys()]).toEqual(['b', 'outside']);
    expect(parent.html.contains(a.html)).toBe(false);
    expect(a.cleanup).toHaveBeenCalledOnce();
    expect(parent.cleanup).not.toHaveBeenCalled();
    expect(b.cleanup).not.toHaveBeenCalled();
  });

  it('keeps every visible ancestor even when the stack exceeds the budget', () => {
    const cache = new RenderedRouteCache(1);
    const grandparent = page(), parent = page(grandparent.rendered), child = page(parent.rendered);
    const stack = [grandparent.rendered, parent.rendered, child.rendered];
    cache.markUsedFor('nested', stack);
    expect(cache.get('nested')).toEqual(stack);
    for (const p of [grandparent, parent, child]) expect(p.cleanup).not.toHaveBeenCalled();

    const outside = page();
    cache.markUsedFor('outside', [outside.rendered]);
    expect(cache.get('nested')).toBeUndefined();
    for (const p of [grandparent, parent, child]) expect(p.cleanup).toHaveBeenCalledOnce();
    expect(outside.cleanup).not.toHaveBeenCalled();
  });

  it('with zero budget keeps only the visible stack', () => {
    const cache = new RenderedRouteCache(0);
    const a = page(), parent = page(), child = page(parent.rendered);
    cache.markUsedFor('a', [a.rendered]);
    cache.markUsedFor('nested', [parent.rendered, child.rendered]);
    expect([...cache.cache.keys()]).toEqual(['nested']);
    expect(a.cleanup).toHaveBeenCalledOnce();
    expect(parent.cleanup).not.toHaveBeenCalled();
    expect(child.cleanup).not.toHaveBeenCalled();
  });

  it('also bounds entry indexes when many entries share the same page', () => {
    const cache = new RenderedRouteCache(2);
    const shared = page();
    for (let i = 0; i < 100; i++) cache.markUsedFor(String(i), [shared.rendered]);
    expect([...cache.cache.keys()]).toEqual(['98', '99']);
    expect(shared.cleanup).not.toHaveBeenCalled();
  });

  it('removes disposed indexes immediately but keeps pages used by other entries', () => {
    const cache = new RenderedRouteCache();
    const parent = page(), child = page(parent.rendered), outside = page();
    const stack = [parent.rendered, child.rendered];
    cache.markUsedFor('a', stack);
    cache.markUsedFor('b', stack);
    cache.markUsedFor('outside', [outside.rendered]);

    cache.unreference('a');
    expect(cache.get('a')).toBeUndefined();
    expect(parent.cleanup).not.toHaveBeenCalled();
    expect(child.cleanup).not.toHaveBeenCalled();
    cache.unreference('b');
    expect([...cache.cache.keys()]).toEqual(['outside']);
    expect(parent.cleanup).toHaveBeenCalledOnce();
    expect(child.cleanup).toHaveBeenCalledOnce();

    cache.unreference('a');
    cache.unreference('b');
    cache.unreference('unknown');
    expect([...cache.cache.keys()]).toEqual(['outside']);
    expect(parent.cleanup).toHaveBeenCalledOnce();
    expect(child.cleanup).toHaveBeenCalledOnce();
  });

  it('does not dispose a displayed stack while a replacement is still rendering', () => {
    const cache = new RenderedRouteCache(1);
    const parent = page(), child = page(parent.rendered);
    cache.markUsedFor('old', [parent.rendered, child.rendered]);
    cache.unreference('old');
    expect(cache.get('old')).toBeUndefined();
    expect(parent.cleanup).not.toHaveBeenCalled();
    expect(child.cleanup).not.toHaveBeenCalled();

    const sibling = page(parent.rendered);
    cache.markUsedFor('replacement', [parent.rendered, sibling.rendered]);
    expect(child.cleanup).toHaveBeenCalledOnce();
    expect(parent.cleanup).not.toHaveBeenCalled();
    expect(sibling.cleanup).not.toHaveBeenCalled();
  });

  it('protects reused offscreen ancestors until every pending render releases them', () => {
    const cache = new RenderedRouteCache();
    const parent = page(), child = page(parent.rendered), outside = page();
    cache.markUsedFor('nested', [parent.rendered, child.rendered]);
    cache.markUsedFor('outside', [outside.rendered]);
    const first = cache.retainForRender([parent.rendered]);
    const second = cache.retainForRender([parent.rendered]);
    cache.unreference('nested');
    expect(parent.cleanup).not.toHaveBeenCalled();
    expect(child.cleanup).toHaveBeenCalledOnce();
    first();
    first();
    expect(parent.cleanup).not.toHaveBeenCalled();
    second();
    expect(parent.cleanup).toHaveBeenCalledOnce();
  });

  it('does not charge construction-only pins against the history cache budget', () => {
    const cache = new RenderedRouteCache(2);
    const parent = page(), child = page(parent.rendered), a = page(), b = page();
    cache.markUsedFor('nested', [parent.rendered, child.rendered]);
    const release = cache.retainForRender([parent.rendered]);
    cache.markUsedFor('a', [a.rendered]);
    cache.markUsedFor('b', [b.rendered]);
    expect([...cache.cache.keys()]).toEqual(['a', 'b']);
    expect(parent.cleanup).not.toHaveBeenCalled();
    expect(a.cleanup).not.toHaveBeenCalled();
    release();
    expect(parent.cleanup).toHaveBeenCalledOnce();
    expect(a.cleanup).not.toHaveBeenCalled();
  });

  it('releases a replaced child without disposing its retained parent', () => {
    const cache = new RenderedRouteCache();
    const parent = page(), a = page(parent.rendered), b = page(parent.rendered);
    cache.markUsedFor('entry', [parent.rendered, a.rendered]);
    cache.markUsedFor('entry', [parent.rendered, b.rendered]);
    expect(cache.get('entry')).toEqual([parent.rendered, b.rendered]);
    expect(a.cleanup).toHaveBeenCalledOnce();
    expect(parent.cleanup).not.toHaveBeenCalled();
    expect(b.cleanup).not.toHaveBeenCalled();
  });

  it('takes a snapshot rather than retaining the caller\'s mutable stack', () => {
    const cache = new RenderedRouteCache();
    const a = page();
    const stack = [a.rendered];
    cache.markUsedFor('a', stack);
    stack.length = 0;
    expect(cache.get('a')).toEqual([a.rendered]);
  });
});
