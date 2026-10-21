import { expect, it, vi } from 'vitest';
import { root, route } from '@kinetic-router/definition';
import { createComponent } from 'solid-js';
import { render } from '@solidjs/web';
import { MemoryEngine } from './memory-engine.js';
import { Outlet, rootOutletId } from './outlet.js';
import { Router } from './router.js';

it('connects to the router automatically and replaces page content inside its container', async () => {
  const home = route({}), next = route({});
  const router = new Router(root({ home, next }), { engine: new MemoryEngine('/home') });
  for (const [name, definition] of Object.entries({ home, next })) {
    router.implement(definition, {
      untrackedKeys: [],
      async render() {
        return () => {
          const html = document.createElement('section');
          html.textContent = name;
          return { html, title: name };
        };
      },
    });
  }
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => createComponent(Outlet, { component: 'main', class: 'page-content' }), host);
  try {
    const outlet = host.querySelector('main')!;
    expect(outlet.id).toBe(rootOutletId);
    expect(outlet.className).toBe('page-content');
    await vi.waitFor(() => expect(router.currentLocator()?.route).toBe(home));
    expect(outlet.textContent).toBe('home');
    const initialPage = outlet.firstChild;

    await router.navigate(next.locate({})).finished;
    expect(host.querySelector('main')).toBe(outlet);
    expect(outlet.textContent).toBe('next');
    expect(outlet.childNodes).toHaveLength(1);
    expect(outlet.firstChild).not.toBe(initialPage);
  } finally {
    router.dispose();
    dispose();
    host.remove();
  }
});
