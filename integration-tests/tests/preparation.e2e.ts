import { test, expect } from './helpers.js';
import type { ActualRouter } from '@kinetic-router/solid/actual-router.js';
import type { Route } from '@kinetic-router/definition';

// Exercise the internal preparation seam without adding interaction triggers or
// a production testing API. ActualRouter already exposes __router for debugging.
test('Backstage preserves viewport geometry without layout, focus, accessibility or history effects, then adopts in the browser', async ({ page }) => {
  await page.goto('/home?scenario=menu&checks=manual');
  await expect(page.getByTestId('scenario-app').getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  // The playground's first polling update also changes document height.
  await expect(page.getByRole('list', { name: 'Actual history stack' }).getByRole('listitem')).toHaveCount(1);
  const result = await page.evaluate(async () => {
    const router = (window as unknown as { __router: ActualRouter<{}, {}> }).__router;
    const sitemap = router.sitemap as unknown as { a: { detail: Route<{}> }, b: Route<{}> };
    const target = sitemap.a.detail.locate({});
    const other = sitemap.b.locate({});
    const snapshot = router.resolveDestination(target);
    const live = document.getElementById('__kinetic_router_root_frame')!;
    const activeNode = live.firstChild;
    const input = live.querySelector('input')!;
    // Make window scrolling measurable, independently of the playground layout.
    const spacer = document.createElement('div');
    spacer.style.height = '2000px';
    document.body.append(spacer);
    input.focus({ preventScroll: true });
    window.scrollTo(0, 100);
    const read = () => ({
      history: window.navigation.entries().map(e => [e.id, e.key, e.url]),
      url: location.href, title: document.title, scroll: scrollY,
      height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth,
      bounds: live.getBoundingClientRect().toJSON(),
    });
    const before = read();
    const first = router.acquirePreparation(snapshot)!;
    const second = router.acquirePreparation(router.resolveDestination(other))!;
    const [prepared, otherPrepared] = await Promise.all([first.ready, second.ready]);
    const node = prepared.routes[0].renderOutput!.html as HTMLElement;
    node.style.cssText = 'box-sizing:border-box;width:100%;height:200vh;padding:0;border:0;';
    const probe = document.createElement('div');
    probe.style.cssText = 'width:50%;height:123px;';
    node.append(probe);
    const stagedInput = node.querySelector('input')!;
    stagedInput.focus(); // inert must reject even programmatic focus
    await new Promise(requestAnimationFrame);
    const hosts = [...document.querySelectorAll<HTMLElement>('[data-kinetic-router-backstage]')];
    const geometry = {
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
      probeWidth: probe.getBoundingClientRect().width,
      probeHeight: probe.getBoundingClientRect().height,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
    };
    const unchanged = read();
    const isolated = {
      activeNode: live.firstChild === activeNode,
      focus: document.activeElement === input,
      hosts: hosts.length,
      separateTrees: !hosts[0].contains(otherPrepared.routes[0].renderOutput!.html),
      inert: hosts.every(host => host.inert && host.getAttribute('aria-hidden') === 'true'),
      hidden: hosts.every(host => getComputedStyle(host).visibility === 'hidden' && getComputedStyle(host).opacity === '0'),
      noHitTarget: !hosts.some(host => host.contains(document.elementFromPoint(10, 10))),
      preparing: prepared.routes[0].renderArgs.pageStatus.shouldFetch()
        && !prepared.routes[0].renderArgs.pageStatus.isVisible(),
    };
    // Actual navigation takes ownership synchronously, before this consumer ends.
    const navigation = router.activateDestination(snapshot);
    first.release();
    await navigation.finished;
    await new Promise(requestAnimationFrame);
    const adopted = live.firstChild === node
      && router.rrCache.get(window.navigation.currentEntry!.id)?.[0] === prepared.routes[0];
    second.release();
    router.disposePreparations();
    spacer.remove();
    return { before, unchanged, geometry, isolated, adopted,
      finalEntries: window.navigation.entries().length,
      finalTitle: document.title,
      stagesLeft: document.querySelectorAll('[data-kinetic-router-backstage]').length };
  });
  expect(result.unchanged).toEqual(result.before);
  expect(result.isolated).toEqual({ activeNode: true, focus: true, hosts: 2, separateTrees: true,
    inert: true, hidden: true, noHitTarget: true, preparing: true });
  expect(result.geometry.width).toBe(result.geometry.viewportWidth);
  expect(result.geometry.height).toBe(result.geometry.viewportHeight * 2);
  expect(result.geometry.probeWidth).toBe(result.geometry.viewportWidth / 2);
  expect(result.geometry.probeHeight).toBe(123);
  expect(result.adopted).toBe(true);
  expect(result.finalEntries).toBe(result.before.history.length + 1);
  expect(result.finalTitle).toBe('Detail');
  expect(result.stagesLeft).toBe(0);
});

test('browser pre-commit cancellation releases navigation ownership and a later activation reuses retained output', async ({ page }) => {
  await page.goto('/home?scenario=links&checks=manual');
  await expect(page.getByTestId('scenario-app').getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const router = (window as unknown as { __router: ActualRouter<{}, {}> }).__router;
    const target = (router.sitemap as unknown as { about: Route<{}> }).about.locate({});
    const snapshot = router.resolveDestination(target);
    const originalEntry = window.navigation.currentEntry!.id;
    const originalURL = location.href;
    const first = router.acquirePreparation(snapshot)!;
    const prepared = await first.ready;
    const status = prepared.routes[0].renderArgs.pageStatus;
    const fetching = status.fetchSignal()!;
    const node = prepared.routes[0].renderOutput!.html;
    window.navigation.addEventListener('navigate', event => event.preventDefault(), { once: true });
    const cancelled = router.activateDestination(snapshot);
    first.release();
    const outcome = await Promise.allSettled([cancelled.committed, cancelled.finished]);
    await new Promise(requestAnimationFrame);
    const retained = {
      commitRejected: outcome[0].status === 'rejected',
      finishRejected: outcome[1].status === 'rejected',
      unchangedEntry: window.navigation.currentEntry!.id === originalEntry,
      unchangedURL: location.href === originalURL,
      title: document.title,
      shouldFetch: status.shouldFetch(), visible: status.isVisible(), aborted: fetching.aborted,
    };
    const retry = router.acquirePreparation(snapshot)!;
    const output = await retry.ready;
    await new Promise(requestAnimationFrame);
    const resumed = status.fetchSignal() !== fetching && status.fetchSignal()?.aborted === false;
    const navigation = router.activateDestination(snapshot);
    retry.release();
    await navigation.finished;
    const adopted = output === prepared && document.getElementById('__kinetic_router_root_frame')!.firstChild === node;
    router.disposePreparations();
    return { retained, resumed, adopted, visibleAfterDisposal: status.isVisible() };
  });
  expect(result.retained).toEqual({ commitRejected: true, finishRejected: true, unchangedEntry: true,
    unchangedURL: true, title: 'Home', shouldFetch: false, visible: false, aborted: true });
  expect(result.resumed).toBe(true);
  expect(result.adopted).toBe(true);
  expect(result.visibleAfterDisposal).toBe(true);
  await expect(page).toHaveTitle('About');
});
