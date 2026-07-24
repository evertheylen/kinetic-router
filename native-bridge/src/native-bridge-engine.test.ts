import { describe, it, expect, vi, beforeEach } from 'vitest';
import { param, route, root } from '@kinetic-router/definition';
import {
  EngineHandlers,
  EngineNavigateEvent,
} from '@kinetic-router/solid/navigation-engine.js';

import { NativeBridgeEngine, NativeBridge } from './native-bridge-engine.js';

function createSitemap() {
  const userId = param.path<string>();
  const search = param.search<string>();
  const home = route({});
  const user = route({ userId });
  const searchRoute = route({ search: search.withDefault('') });

  return {
    sitemap: root({
      home,
      users: { [userId.$]: user },
      search: searchRoute,
    }),
    routes: { home, user, searchRoute },
  };
}

function createMockBridge() {
  const messages: unknown[] = [];
  return {
    messages,
    postMessage(message: unknown) {
      messages.push(message);
    },
    reset() {
      messages.length = 0;
    },
  };
}

function createMockHandlers() {
  const navigateCalls: EngineNavigateEvent[] = [];
  const disposeCalls: string[] = [];
  let navigateResolve: (() => void) | null = null;
  let navigateReject: ((error: Error) => void) | null = null;

  const handlers: EngineHandlers = {
    handleNavigate(event: EngineNavigateEvent): Promise<void> {
      navigateCalls.push(event);
      return new Promise<void>((resolve, reject) => {
        navigateResolve = resolve;
        navigateReject = reject;
      });
    },
    handleDispose(entryId: string): void {
      disposeCalls.push(entryId);
    },
  };

  return {
    handlers,
    navigateCalls,
    disposeCalls,
    resolveNavigate() {
      navigateResolve?.();
      navigateResolve = null;
    },
    rejectNavigate(error: Error) {
      navigateReject?.(error);
      navigateReject = null;
    },
  };
}

describe('NativeBridgeEngine', () => {
  let bridge: ReturnType<typeof createMockBridge>;
  let mock: ReturnType<typeof createMockHandlers>;
  let engine: NativeBridgeEngine;

  beforeEach(() => {
    bridge = createMockBridge();
    mock = createMockHandlers();
    const { sitemap } = createSitemap();
    engine = new NativeBridgeEngine({ sitemap, bridge: bridge as unknown as NativeBridge });
    engine.attach(mock.handlers);
  });

  it('sends a ready message on attach', () => {
    expect(bridge.messages).toHaveLength(1);
    const msg = bridge.messages[0] as any;
    expect(msg.type).toBe('ready');
    expect(msg.protocolVersion).toBe(1);
    expect(msg.url).toBe(location.href);
  });

  it('exposes window.__kineticNative with render, dispose, and setStack', () => {
    expect(window.__kineticNative).toBeDefined();
    expect(typeof window.__kineticNative!.render).toBe('function');
    expect(typeof window.__kineticNative!.dispose).toBe('function');
    expect(typeof window.__kineticNative!.setStack).toBe('function');
  });

  describe('navigate', () => {
    it('sends visitProposed and returns pending promises', async () => {
      const result = engine.navigate({
        url: '/home',
        state: { test: true },
        history: 'push',
      });

      expect(bridge.messages).toHaveLength(2); // ready + visitProposed
      const msg = bridge.messages[1] as any;
      expect(msg.type).toBe('visitProposed');
      expect(msg.url).toBe('/home');
      expect(msg.state).toEqual({ test: true });
      expect(msg.action).toBe('push');
      expect(msg.routePattern).toBe('home');

      // promises should not be resolved yet
      let committedResolved = false;
      let finishedResolved = false;
      result.committed!.then(() => { committedResolved = true; });
      result.finished!.then(() => { finishedResolved = true; });

      // flush microtasks
      await Promise.resolve();
      expect(committedResolved).toBe(false);
      expect(finishedResolved).toBe(false);
    });

    it('resolves committed and calls handleNavigate when Swift calls render', async () => {
      const result = engine.navigate({
        url: '/users/alice',
        state: { slugs: ['users', null] },
        history: 'push',
      });

      let committedValue: any = null;
      result.committed!.then((v) => { committedValue = v; });

      const renderPromise = engine.render('swift-entry-1', '/users/alice', { slugs: ['users', null] });
      mock.resolveNavigate();
      await renderPromise;

      expect(committedValue).toEqual({ id: 'swift-entry-1', url: '/users/alice' });
      expect(mock.navigateCalls).toHaveLength(1);
      expect(mock.navigateCalls[0].navigationType).toBe('push');
      expect(mock.navigateCalls[0].committedId).toBe('swift-entry-1');
      expect(mock.navigateCalls[0].destination.getState!()).toEqual({ slugs: ['users', null] });
    });

    it('sends renderCompleted after successful render', async () => {
      engine.navigate({ url: '/home', state: null, history: 'push' });
      const renderPromise = engine.render('e1', '/home', null);
      mock.resolveNavigate();
      await renderPromise;

      const completedMsg = bridge.messages.find((m: any) => m.type === 'renderCompleted');
      expect(completedMsg).toBeDefined();
    });

    it('sends renderFailed when render throws', async () => {
      const result = engine.navigate({ url: '/home', state: null, history: 'push' });
      // suppress unhandled rejection on the finished promise
      result.finished!.catch(() => {});

      const renderPromise = engine.render('e1', '/home', null);

      // reject AFTER render starts but BEFORE awaiting
      await new Promise(r => setTimeout(r, 0));
      mock.rejectNavigate(new Error('boom'));

      let renderError: Error | undefined;
      try {
        await renderPromise;
      } catch (e) {
        renderError = e as Error;
      }

      expect(renderError).toBeDefined();
      const failedMsg = bridge.messages.find((m: any) => m.type === 'renderFailed');
      expect(failedMsg).toBeDefined();
    });

    it('handles ignore navigations locally without sending to bridge', async () => {
      const msgCountBefore = bridge.messages.length;

      const result = engine.navigate({
        url: '/home',
        state: null,
        history: 'replace',
        info: { ignore: true },
      });

      expect(bridge.messages.length).toBe(msgCountBefore);

      const committed = await result.committed;
      expect(committed!.id).toMatch(/^__native_local_/);

      await result.finished!;
    });

    it('replace navigations dispose the previous entry', async () => {
      const pushResult = engine.navigate({ url: '/users/alice', state: null, history: 'push' });
      const pushRender = engine.render('e1', '/users/alice', null);
      mock.resolveNavigate();
      await pushRender;

      mock.disposeCalls.length = 0;

      engine.navigate({ url: '/users/bob', state: null, history: 'replace' });
      const replaceRender = engine.render('e2', '/users/bob', null);
      mock.resolveNavigate();
      await replaceRender;

      expect(mock.disposeCalls).toContain('e1');
    });
  });

  describe('render (standalone)', () => {
    it('calls handleNavigate with traverse type when no pending navigate', async () => {
      const renderPromise = engine.render('e-back', '/home', null);
      mock.resolveNavigate();
      await renderPromise;

      expect(mock.navigateCalls).toHaveLength(1);
      expect(mock.navigateCalls[0].navigationType).toBe('traverse');
      expect(mock.navigateCalls[0].committedId).toBe('e-back');
    });

    it('sends renderCompleted after standalone render', async () => {
      const renderPromise = engine.render('e-back', '/home', null);
      mock.resolveNavigate();
      await renderPromise;

      const completedMsg = bridge.messages.find((m: any) => m.type === 'renderCompleted');
      expect(completedMsg).toBeDefined();
    });
  });

  describe('dispose', () => {
    it('calls handleDispose on the router', () => {
      engine.dispose('e-old');
      expect(mock.disposeCalls).toEqual(['e-old']);
    });
  });

  describe('setStack', () => {
    it('renders the leaf entry', async () => {
      const setStackPromise = engine.setStack([
        { entryId: 'e-home', url: '/home', state: null },
        { entryId: 'e-user', url: '/users/alice', state: { slugs: ['users', null] } },
      ]);

      mock.resolveNavigate();
      // setStack calls render internally, which is async
      await new Promise(r => setTimeout(r, 0));

      expect(mock.navigateCalls).toHaveLength(1);
      expect(mock.navigateCalls[0].committedId).toBe('e-user');
      expect(mock.navigateCalls[0].navigationType).toBe('traverse');
    });

    it('does nothing for an empty stack', () => {
      engine.setStack([]);
      expect(mock.navigateCalls).toHaveLength(0);
    });
  });

  describe('currentEntry / updateCurrentEntry', () => {
    it('tracks the current entry after render', async () => {
      const renderPromise = engine.render('e1', '/home', null);
      mock.resolveNavigate();
      await renderPromise;

      const entry = engine.currentEntry()!;
      expect(entry.id).toBe('e1');
      expect(entry.url).toBe('/home');
    });

    it('sends stateUpdated when updateCurrentEntry is called', async () => {
      const renderPromise = engine.render('e1', '/home', null);
      mock.resolveNavigate();
      await renderPromise;

      engine.updateCurrentEntry({ scrollTop: 42 });

      const msg = bridge.messages.find((m: any) => m.type === 'stateUpdated');
      expect(msg).toBeDefined();
      expect((msg as any).entryId).toBe('e1');
      expect((msg as any).state).toEqual({ scrollTop: 42 });
    });

    it('returns undefined when no entry has been rendered', () => {
      const freshBridge = createMockBridge();
      const { sitemap } = createSitemap();
      const freshEngine = new NativeBridgeEngine({ sitemap, bridge: freshBridge as unknown as NativeBridge });
      expect(freshEngine.currentEntry()).toBeUndefined();
    });
  });

  describe('click interception', () => {
    function simulateClick(anchor: HTMLAnchorElement, overrides: Partial<MouseEventInit> = {}) {
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...overrides,
      });
      Object.defineProperty(event, 'target', { value: anchor, configurable: true });
      (engine as any).handleClick(event);
    }

    it('sends visitProposed for same-origin anchor clicks', () => {
      const anchor = document.createElement('a');
      anchor.href = '/home';
      anchor.textContent = 'Home';
      document.body.appendChild(anchor);

      bridge.reset();
      simulateClick(anchor);

      const msg = bridge.messages.find((m: any) => m.type === 'visitProposed');
      expect(msg).toBeDefined();
      expect((msg as any).url).toContain('/home');
      expect((msg as any).action).toBe('push');

      document.body.removeChild(anchor);
    });

    it('sends externalUrl for off-sitemap links', () => {
      const anchor = document.createElement('a');
      anchor.href = '/nonexistent/path';
      anchor.textContent = 'Missing';
      document.body.appendChild(anchor);

      bridge.reset();
      simulateClick(anchor);

      const msg = bridge.messages.find((m: any) => m.type === 'externalUrl');
      expect(msg).toBeDefined();
      expect((msg as any).url).toContain('/nonexistent/path');

      document.body.removeChild(anchor);
    });

    it('does not intercept clicks with modifier keys', () => {
      const anchor = document.createElement('a');
      anchor.href = '/home';
      document.body.appendChild(anchor);

      bridge.reset();
      simulateClick(anchor, { metaKey: true });

      expect(bridge.messages.find((m: any) => m.type === 'visitProposed')).toBeUndefined();

      document.body.removeChild(anchor);
    });

    it('does not intercept target=_blank links', () => {
      const anchor = document.createElement('a');
      anchor.href = '/home';
      anchor.target = '_blank';
      document.body.appendChild(anchor);

      bridge.reset();
      simulateClick(anchor);

      expect(bridge.messages.find((m: any) => m.type === 'visitProposed')).toBeUndefined();

      document.body.removeChild(anchor);
    });

    it('does not intercept download links', () => {
      const anchor = document.createElement('a');
      anchor.href = '/file.pdf';
      anchor.setAttribute('download', '');
      document.body.appendChild(anchor);

      bridge.reset();
      simulateClick(anchor);

      expect(bridge.messages.find((m: any) => m.type === 'visitProposed')).toBeUndefined();

      document.body.removeChild(anchor);
    });

    it('finds anchor through nested elements', () => {
      const span = document.createElement('span');
      const anchor = document.createElement('a');
      anchor.href = '/home';
      anchor.appendChild(span);
      document.body.appendChild(anchor);

      bridge.reset();
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      // set target to the span (simulates clicking inside the anchor)
      Object.defineProperty(event, 'target', { value: span, configurable: true });
      (engine as any).handleClick(event);

      const msg = bridge.messages.find((m: any) => m.type === 'visitProposed');
      expect(msg).toBeDefined();

      document.body.removeChild(anchor);
    });
  });

  describe('route resolution', () => {
    it('includes routePattern in visitProposed for known routes', () => {
      engine.navigate({
        url: '/users/alice',
        state: null,
        history: 'push',
      });

      const msg = bridge.messages[bridge.messages.length - 1] as any;
      expect(msg.routePattern).toBe('users/<param>');
    });

    it('omits routePattern and native for unresolvable URLs', () => {
      engine.navigate({
        url: '/nonexistent/path',
        state: null,
        history: 'push',
      });

      const msg = bridge.messages[bridge.messages.length - 1] as any;
      expect(msg.routePattern).toBeUndefined();
      expect(msg.native).toBeUndefined();
    });
  });
});
