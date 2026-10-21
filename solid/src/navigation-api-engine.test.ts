import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavigationApiEngine } from './navigation-api-engine.js';

function entry(id: string, key: string, index: number) {
  return Object.assign(new EventTarget(), { id, key, index, url: `https://example.com/${id}`, getState: () => undefined });
}

function setup() {
  const first = entry('first', 'slot', 0);
  const navigation = Object.assign(new EventTarget(), {
    currentEntry: first,
    entries: () => [first],
    navigate: vi.fn(),
    traverseTo: vi.fn(),
    updateCurrentEntry: vi.fn(),
  });
  vi.stubGlobal('navigation', navigation);
  const handlers = { handleNavigate: vi.fn(async () => {}), handleBeforeCommit: vi.fn(), handleDispose: vi.fn() };
  const engine = new NavigationApiEngine();
  const detach = engine.attach(handlers);
  return { engine, navigation, first, handlers, detach };
}

afterEach(() => vi.unstubAllGlobals());

describe('NavigationApiEngine', () => {
  it('exposes the browser history and delegates targeted traversal', () => {
    const { engine, navigation, first } = setup();
    expect(engine.currentEntry()).toBe(first);
    expect(engine.entries()).toEqual([first]);
    const info = { forceNewInstance: true };
    engine.traverseTo(first.key, info);
    expect(navigation.traverseTo).toHaveBeenCalledWith(first.key, { info });
  });

  it('leaves download requests to the browser without capturing state or intercepting', () => {
    const { navigation, handlers } = setup();
    const intercept = vi.fn();
    navigation.dispatchEvent(Object.assign(new Event('navigate'), {
      canIntercept: true, navigationType: 'push', downloadRequest: '', intercept,
    }));
    expect(intercept).not.toHaveBeenCalled();
    expect(handlers.handleBeforeCommit).not.toHaveBeenCalled();
    expect(handlers.handleNavigate).not.toHaveBeenCalled();
  });

  it('rejects duplicate attachment', () => {
    const { engine, handlers } = setup();
    expect(() => engine.attach(handlers)).toThrow('already attached');
  });

  it('uses the committed entry, watches disposal once and captures the outgoing state before commit', async () => {
    const { engine, navigation, first, handlers } = setup();
    const replacement = entry('replacement', first.key, 0);
    const intercept = vi.fn(({ handler }) => {
      expect(handlers.handleBeforeCommit).toHaveBeenCalledOnce();
      navigation.currentEntry = replacement;
      return handler();
    });
    const event = Object.assign(new Event('navigate'), {
      canIntercept: true, navigationType: 'replace', destination: first,
      signal: new AbortController().signal,
      info: { forceNewInstance: true }, intercept,
    });
    navigation.dispatchEvent(event);
    await intercept.mock.results[0].value;
    expect(handlers.handleNavigate).toHaveBeenCalledWith({
      navigationType: 'replace', fromId: first.id, committedId: replacement.id,
      signal: event.signal, destination: replacement, info: event.info,
    });
    // Programmatic commit observation and interception must not add two listeners.
    navigation.navigate.mockReturnValue({ committed: Promise.resolve(replacement), finished: Promise.resolve(replacement) });
    await engine.navigate({ url: '/replacement', state: {}, history: 'replace' }).committed;
    replacement.dispatchEvent(new Event('dispose'));
    expect(handlers.handleDispose).toHaveBeenCalledExactlyOnceWith(replacement.id);
  });

  it.each([false, true])('reports application failure unless its own navigation was cancelled (cancelled %s)', async cancelled => {
    const { navigation, handlers } = setup();
    const controller = new AbortController();
    const failure = new DOMException('Application resource failed', 'AbortError');
    handlers.handleNavigate.mockRejectedValue(failure);
    const intercept = vi.fn(({ handler }) => handler());
    const event = Object.assign(new Event('navigate'), {
      canIntercept: true, navigationType: 'push', signal: controller.signal,
      info: {}, intercept,
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      if (cancelled) controller.abort();
      navigation.dispatchEvent(event);
      await expect(intercept.mock.results[0].value).rejects.toBe(failure);
      if (cancelled) expect(log).not.toHaveBeenCalled();
      else expect(log).toHaveBeenCalledExactlyOnceWith('Navigation failed', failure);
    } finally { log.mockRestore(); }
  });

  it('detaches navigation and entry listeners, and permits a clean reattachment', async () => {
    const { engine, navigation, first, handlers, detach } = setup();
    const late = entry('late', 'late-slot', 1);
    const committed = Promise.withResolvers<typeof late>();
    navigation.navigate.mockReturnValue({ committed: committed.promise, finished: Promise.resolve() });
    engine.navigate({ url: '/late', state: {}, history: 'push' });
    detach();
    const intercept = vi.fn();
    navigation.dispatchEvent(Object.assign(new Event('navigate'), { canIntercept: true, intercept }));
    first.dispatchEvent(new Event('dispose'));
    expect(intercept).not.toHaveBeenCalled();
    expect(handlers.handleDispose).not.toHaveBeenCalled();

    const next = { handleNavigate: vi.fn(async () => {}), handleDispose: vi.fn() };
    const detachNext = engine.attach(next);
    detach();
    first.dispatchEvent(new Event('dispose'));
    expect(next.handleDispose).toHaveBeenCalledExactlyOnceWith(first.id);
    committed.resolve(late);
    await committed.promise;
    late.dispatchEvent(new Event('dispose'));
    expect(next.handleDispose).toHaveBeenCalledOnce();
    detachNext();
    first.dispatchEvent(new Event('dispose'));
    expect(next.handleDispose).toHaveBeenCalledOnce();
  });

  it('rejects an intercepted handler that starts after detachment', async () => {
    const { navigation, handlers, detach } = setup();
    const intercept = vi.fn();
    navigation.dispatchEvent(Object.assign(new Event('navigate'), {
      canIntercept: true, navigationType: 'push', signal: new AbortController().signal, intercept,
    }));
    detach();
    await expect(intercept.mock.calls[0][0].handler()).rejects.toMatchObject({ name: 'AbortError' });
    expect(handlers.handleNavigate).not.toHaveBeenCalled();
  });

  it('does not orphan a rejected commit while observing disposal', async () => {
    const { engine, navigation } = setup();
    const error = new DOMException('Superseded', 'AbortError');
    navigation.navigate.mockReturnValue({ committed: Promise.reject(error), finished: Promise.reject(error) });
    const result = engine.navigate({ url: '/next', state: {}, history: 'push' });
    expect(await Promise.allSettled([result.committed, result.finished])).toEqual([
      { status: 'rejected', reason: error }, { status: 'rejected', reason: error },
    ]);
  });
});
