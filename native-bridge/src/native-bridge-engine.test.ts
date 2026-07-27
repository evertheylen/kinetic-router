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
  const messages: any[] = [];
  return {
    messages,
    postMessage(message: unknown) {
      messages.push(message);
    },
    reset() {
      messages.length = 0;
    },
    /** proposalId of the most recent visitProposed message. */
    lastProposalId(): string {
      const proposals = messages.filter((m) => m.type === 'visitProposed');
      return proposals[proposals.length - 1].proposalId;
    },
  };
}

function createMockHandlers() {
  const navigateCalls: EngineNavigateEvent[] = [];
  const disposeCalls: string[] = [];
  const beforeCommitCalls: number[] = [];
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
    handleBeforeCommit(): void {
      beforeCommitCalls.push(navigateCalls.length);
    },
  };

  return {
    handlers,
    navigateCalls,
    disposeCalls,
    beforeCommitCalls,
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

  describe('handshake & initial entry', () => {
    it('sends a ready message on attach, carrying the initial entry id', () => {
      expect(bridge.messages).toHaveLength(1);
      const msg = bridge.messages[0];
      expect(msg.type).toBe('ready');
      expect(msg.protocolVersion).toBe(2);
      expect(msg.url).toBe(location.href);
      expect(msg.initialEntryId).toMatch(/^__native_local_/);
    });

    it('has a current entry immediately after attach (router init depends on this)', () => {
      const entry = engine.currentEntry()!;
      expect(entry).toBeDefined();
      expect(entry.id).toBe(bridge.messages[0].initialEntryId);
      // urls are normalized to { pathname, search }
      expect(entry.url).toEqual({
        pathname: location.pathname,
        search: location.search,
      });
    });

    it('uses options.initialUrl for the initial entry when provided', () => {
      const freshBridge = createMockBridge();
      const { sitemap } = createSitemap();
      const freshEngine = new NativeBridgeEngine({
        sitemap,
        bridge: freshBridge as unknown as NativeBridge,
        initialUrl: '/home',
      });
      freshEngine.attach(createMockHandlers().handlers);

      expect(freshBridge.messages[0].url).toBe('/home');
      expect(freshEngine.currentEntry()!.url).toEqual({ pathname: '/home', search: '' });
    });

    it('exposes window.__kineticNative with render, dispose, setStack, and visit', () => {
      expect(window.__kineticNative).toBeDefined();
      expect(typeof window.__kineticNative!.render).toBe('function');
      expect(typeof window.__kineticNative!.dispose).toBe('function');
      expect(typeof window.__kineticNative!.setStack).toBe('function');
      expect(typeof window.__kineticNative!.visit).toBe('function');
    });

    it('__kineticNative wrappers never return a value (WKWebView chokes on promises)', () => {
      const result = window.__kineticNative!.render('e1', '/home', null);
      expect(result).toBeUndefined();
      mock.resolveNavigate();
    });

    it('proposes a visit requested by native chrome', () => {
      window.__kineticNative!.visit('/home');

      const message = bridge.messages[bridge.messages.length - 1]!;
      expect(message.type).toBe('visitProposed');
      expect(message.url).toBe('/home');
      expect(message.action).toBe('push');
    });
  });

  describe('navigate', () => {
    it('sends visitProposed (with proposalId) and returns pending promises', async () => {
      const result = engine.navigate({
        url: '/home',
        state: { test: true },
        history: 'push',
      });

      expect(bridge.messages).toHaveLength(2); // ready + visitProposed
      const msg = bridge.messages[1];
      expect(msg.type).toBe('visitProposed');
      expect(msg.proposalId).toMatch(/^__proposal_/);
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

    it('resolves committed and calls handleNavigate when Swift renders the proposal', async () => {
      const result = engine.navigate({
        url: '/users/alice',
        state: { slugs: ['users', null] },
        history: 'push',
      });

      let committedValue: any = null;
      result.committed!.then((v) => { committedValue = v; });

      const renderPromise = engine.render(
        'swift-entry-1', '/users/alice', { slugs: ['users', null] }, bridge.lastProposalId(),
      );
      mock.resolveNavigate();
      await renderPromise;

      expect(committedValue).toEqual({ id: 'swift-entry-1', url: '/users/alice' });
      expect(mock.navigateCalls).toHaveLength(1);
      expect(mock.navigateCalls[0].navigationType).toBe('push');
      expect(mock.navigateCalls[0].committedId).toBe('swift-entry-1');
      expect(mock.navigateCalls[0].destination.getState!()).toEqual({ slugs: ['users', null] });
      // urls in destinations are normalized to { pathname, search }
      expect(mock.navigateCalls[0].destination.url).toEqual({ pathname: '/users/alice', search: '' });
    });

    it('sends renderCompleted after successful render', async () => {
      engine.navigate({ url: '/home', state: null, history: 'push' });
      const renderPromise = engine.render('e1', '/home', null, bridge.lastProposalId());
      mock.resolveNavigate();
      await renderPromise;

      const completedMsg = bridge.messages.find((m) => m.type === 'renderCompleted');
      expect(completedMsg).toBeDefined();
      expect(completedMsg.entryId).toBe('e1');
    });

    it('sends renderFailed when render throws', async () => {
      const result = engine.navigate({ url: '/home', state: null, history: 'push' });
      // suppress unhandled rejection on the finished promise
      result.finished!.catch(() => {});

      const renderPromise = engine.render('e1', '/home', null, bridge.lastProposalId());

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
      const failedMsg = bridge.messages.find((m) => m.type === 'renderFailed');
      expect(failedMsg).toBeDefined();
    });

    it('normalizes null state (Swift JSON tunnel) to undefined', async () => {
      engine.navigate({ url: '/home', state: null, history: 'push' });
      const renderPromise = engine.render('e1', '/home', null, bridge.lastProposalId());
      mock.resolveNavigate();
      await renderPromise;

      // getState() must not hand null to AppState.deserialize
      expect(mock.navigateCalls[0].destination.getState!()).toBeUndefined();
    });

    it('handles ignore navigations locally, keeping the initial entry id', async () => {
      const initialId = engine.currentEntry()!.id;

      const result = engine.navigate({
        url: '/home',
        state: 's',
        history: 'replace',
        info: { ignore: true },
      });

      // no proposal is sent; the shell is synced via stateUpdated instead
      expect(bridge.messages.filter((m) => m.type === 'visitProposed')).toHaveLength(0);
      const stateMsg = bridge.messages.find((m) => m.type === 'stateUpdated');
      expect(stateMsg).toBeDefined();
      expect(stateMsg.entryId).toBe(initialId);
      expect(stateMsg.url).toBe('/home');
      expect(stateMsg.state).toBe('s');

      const committed = await result.committed;
      // the entry is replaced in place: the id the shell adopted stays valid
      expect(committed!.id).toBe(initialId);
      expect(engine.currentEntry()!.url).toEqual({ pathname: '/home', search: '' });

      await result.finished!;
      // nothing was disposed and nothing rendered
      expect(mock.disposeCalls).toHaveLength(0);
      expect(mock.navigateCalls).toHaveLength(0);
    });

    it('replace navigations dispose the previous entry only after rendering finished', async () => {
      engine.navigate({ url: '/users/alice', state: null, history: 'push' });
      const pushRender = engine.render('e1', '/users/alice', null, bridge.lastProposalId());
      mock.resolveNavigate();
      await pushRender;

      mock.disposeCalls.length = 0;

      engine.navigate({ url: '/users/bob', state: null, history: 'replace' });
      const replaceRender = engine.render('e2', '/users/bob', null, bridge.lastProposalId());

      // not disposed yet: rendered subtrees may still be reused/migrated
      await new Promise(r => setTimeout(r, 0));
      expect(mock.disposeCalls).not.toContain('e1');

      mock.resolveNavigate();
      await replaceRender;

      expect(mock.disposeCalls).toContain('e1');
    });

    it('forwards off-sitemap urls as externalUrl and rejects locally', async () => {
      const result = engine.navigate({
        url: 'https://elsewhere.example/x',
        state: null,
        history: 'push',
      });

      const msg = bridge.messages.find((m) => m.type === 'externalUrl');
      expect(msg).toBeDefined();
      expect(msg.url).toBe('https://elsewhere.example/x');
      expect(bridge.messages.filter((m) => m.type === 'visitProposed')).toHaveLength(0);

      await expect(result.committed).rejects.toThrow(/not on the sitemap/);
    });
  });

  describe('proposal lifecycle', () => {
    it('rejects a stale proposal when an unrelated render arrives (shell ignored it)', async () => {
      // shell decides to handle this route natively and never renders it
      const result = engine.navigate({ url: '/users/alice', state: null, history: 'push' });

      // later: the user pops back and the shell renders a previous entry
      const renderPromise = engine.render('e-prev', '/home', null);
      mock.resolveNavigate();
      await renderPromise;

      await expect(result.committed).rejects.toThrow(/not accepted/);
      await expect(result.finished).rejects.toThrow(/not accepted/);

      // the pop must be reported as a traverse, untouched by the stale proposal
      expect(mock.navigateCalls).toHaveLength(1);
      expect(mock.navigateCalls[0].navigationType).toBe('traverse');
      expect(mock.navigateCalls[0].committedId).toBe('e-prev');
    });

    it('supersedes an unanswered proposal when a new one is made (double-tap)', async () => {
      const first = engine.navigate({ url: '/users/alice', state: null, history: 'push' });
      const second = engine.navigate({ url: '/users/bob', state: null, history: 'push' });

      await expect(first.committed).rejects.toThrow(/Superseded/);

      const renderPromise = engine.render('e2', '/users/bob', null, bridge.lastProposalId());
      mock.resolveNavigate();
      await renderPromise;

      await expect(second.committed).resolves.toEqual({ id: 'e2', url: '/users/bob' });
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

      const completedMsg = bridge.messages.find((m) => m.type === 'renderCompleted');
      expect(completedMsg).toBeDefined();
    });

    it('invokes handleBeforeCommit before switching the current entry', async () => {
      const renderPromise = engine.render('e1', '/home', null);
      // beforeCommit fired before handleNavigate was called
      expect(mock.beforeCommitCalls).toEqual([0]);
      mock.resolveNavigate();
      await renderPromise;
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
      engine.setStack([
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

  describe('currentEntry / updateCurrentEntry / titleChanged', () => {
    it('tracks the current entry after render', async () => {
      const renderPromise = engine.render('e1', '/home', null);
      mock.resolveNavigate();
      await renderPromise;

      const entry = engine.currentEntry()!;
      expect(entry.id).toBe('e1');
      expect(entry.url).toEqual({ pathname: '/home', search: '' });
    });

    it('sends stateUpdated when updateCurrentEntry is called', async () => {
      const renderPromise = engine.render('e1', '/home', null);
      mock.resolveNavigate();
      await renderPromise;
      bridge.reset();

      engine.updateCurrentEntry({ scrollTop: 42 });

      const msg = bridge.messages.find((m) => m.type === 'stateUpdated');
      expect(msg).toBeDefined();
      expect(msg.entryId).toBe('e1');
      expect(msg.state).toEqual({ scrollTop: 42 });
    });

    it('preserves state set via updateCurrentEntry during rendering', async () => {
      const renderPromise = engine.render('e1', '/home', null);
      engine.updateCurrentEntry({ scrollTop: 7 });
      mock.resolveNavigate();
      await renderPromise;

      expect(engine.currentEntry()!.getState!()).toEqual({ scrollTop: 7 });
    });

    it('sends titleChanged for the current entry', async () => {
      const renderPromise = engine.render('e1', '/home', null);
      mock.resolveNavigate();
      await renderPromise;
      bridge.reset();

      engine.titleChanged('Fancy page');

      const msg = bridge.messages.find((m) => m.type === 'titleChanged');
      expect(msg).toBeDefined();
      expect(msg.entryId).toBe('e1');
      expect(msg.title).toBe('Fancy page');
    });

    it('returns undefined when not attached yet', () => {
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

      const msg = bridge.messages.find((m) => m.type === 'visitProposed');
      expect(msg).toBeDefined();
      expect(msg.url).toContain('/home');
      expect(msg.action).toBe('push');
      expect(msg.proposalId).toMatch(/^__proposal_/);

      document.body.removeChild(anchor);
    });

    it('intercepts target=_self links (same as no target)', () => {
      const anchor = document.createElement('a');
      anchor.href = '/home';
      anchor.target = '_self';
      document.body.appendChild(anchor);

      bridge.reset();
      simulateClick(anchor);

      expect(bridge.messages.find((m) => m.type === 'visitProposed')).toBeDefined();

      document.body.removeChild(anchor);
    });

    it('sends externalUrl for off-sitemap links', () => {
      const anchor = document.createElement('a');
      anchor.href = '/nonexistent/path';
      anchor.textContent = 'Missing';
      document.body.appendChild(anchor);

      bridge.reset();
      simulateClick(anchor);

      const msg = bridge.messages.find((m) => m.type === 'externalUrl');
      expect(msg).toBeDefined();
      expect(msg.url).toContain('/nonexistent/path');

      document.body.removeChild(anchor);
    });

    it('does not intercept clicks with modifier keys', () => {
      const anchor = document.createElement('a');
      anchor.href = '/home';
      document.body.appendChild(anchor);

      for (const overrides of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
        bridge.reset();
        simulateClick(anchor, overrides);
        expect(bridge.messages.find((m) => m.type === 'visitProposed')).toBeUndefined();
      }

      document.body.removeChild(anchor);
    });

    it('does not intercept target=_blank links', () => {
      const anchor = document.createElement('a');
      anchor.href = '/home';
      anchor.target = '_blank';
      document.body.appendChild(anchor);

      bridge.reset();
      simulateClick(anchor);

      expect(bridge.messages.find((m) => m.type === 'visitProposed')).toBeUndefined();

      document.body.removeChild(anchor);
    });

    it('does not intercept download links', () => {
      const anchor = document.createElement('a');
      anchor.href = '/file.pdf';
      anchor.setAttribute('download', '');
      document.body.appendChild(anchor);

      bridge.reset();
      simulateClick(anchor);

      expect(bridge.messages.find((m) => m.type === 'visitProposed')).toBeUndefined();

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

      const msg = bridge.messages.find((m) => m.type === 'visitProposed');
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

      const msg = bridge.messages[bridge.messages.length - 1];
      expect(msg.routePattern).toBe('users/<param>');
    });
  });
});
