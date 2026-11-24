import { index, root, route } from '@kinetic-router/definition';
import { Lifecycle, onEnter, onExit } from '@kinetic-router/lifecycle';
import { createCssTransition, motion } from '@kinetic-router/motion';
import { MotionOutlet } from '@kinetic-router/motion-router';
import { Link } from '@kinetic-router/solid/link.js';
import { Outlet } from '@kinetic-router/solid/outlet.js';
import type { PageStatus } from '@kinetic-router/solid/page.js';
import { Router } from '@kinetic-router/solid/router.js';
import { Portal, render } from '@solidjs/web';
import { Show } from 'solid-js';

// Tests explicitly seek/finish the real WAAPI effects, not the wall clock.
const transition = { duration: 3600, ease: 'linear' };

type RouteMotionFixture = ReturnType<typeof mountRouteMotion>;

declare global {
  interface Window { routeMotionFixture: RouteMotionFixture }
}

export function mountRouteMotion(element: HTMLElement) {
  const library = route({});
  const { home, album, css } = library.nest(nestedRoute => ({
    home: nestedRoute({}), album: nestedRoute({}), css: nestedRoute({}),
  }));
  const albumRoutes = album.nest(nestedRoute => ({ notes: nestedRoute({}), summary: nestedRoute({}) }));
  const { notes, summary } = albumRoutes;
  const sitemap = root({ library: { [index]: library, home, css, album: { [index]: album, ...albumRoutes } } });
  const query = new URL(location.href).searchParams;
  const router = new Router(sitemap, { basePath: '/motion-test', maxCachedPages: query.has('evict') ? 0 : undefined });
  const holdAlbum = query.has('hold-album');
  const albumRender = Promise.withResolvers<void>();
  const started: ('album' | 'notes')[] = [];
  const albumExits: { signal: AbortSignal; release: () => void }[] = [];
  let localEnters = 0;
  let notesStatus: PageStatus;

  function LocalCard() {
    onEnter(() => { localEnters++; });
    return <motion.div data-testid="local-card" initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0 }} transition={transition}>Local card</motion.div>;
  }

  function Album(props: { status: PageStatus }) {
    onExit(({ signal }) => {
      // Ignore abort deliberately: the test can resolve a superseded run later.
      const gate = Promise.withResolvers<void>();
      albumExits.push({ signal, release: gate.resolve });
      return gate.promise;
    });
    return <motion.section data-testid="album-page" initial={{ opacity: 0.25 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0.5 }} transition={transition}>
      <h1>Album</h1><label>Album draft <input /></label>
      <Show when={props.status.isVisible()}>
        <Portal><button data-testid="album-portal-control">Album action</button></Portal>
        <dialog aria-label="Album details"><button>Inside modal</button></dialog>
      </Show>
      <Lifecycle.Show when={true}><LocalCard /></Lifecycle.Show>
      <Outlet component="div" />
    </motion.section>;
  }

  function LegacyEntry() {
    let heading!: HTMLElement;
    onEnter(() => { heading.dataset.entered = 'true'; });
    const ref = onEnter<HTMLElement>({
      prepare(element) { element.style.opacity = '0'; },
      run({ element }) { element.style.opacity = '1'; },
    });
    return <h2 ref={element => { heading = element; ref(element); }}>Notes</h2>;
  }

  function Notes() {
    // A plain outlet must not wait even for a never-settling exit callback.
    onExit(() => new Promise<void>(() => {}));
    return <motion.section data-testid="notes-page" initial={{ opacity: 0.2 }}
      animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition}>
      <Lifecycle.Show when={true}><LegacyEntry /></Lifecycle.Show>
    </motion.section>;
  }

  function CssPage() {
    const ref = createCssTransition<HTMLElement>({
      properties: ['opacity'],
      apply(element, direction) { element.classList.toggle('selected', direction === 'in'); },
    });
    return <section class="css-page" ref={ref}><h1>CSS page</h1></section>;
  }

  router.implement(library, {
    untrackedKeys: [],
    async render() {
      return () => ({ title: 'Library', html: <MotionOutlet component="section" class="library-slot" aria-label="Library slot" /> });
    },
  });
  router.implement(home, {
    untrackedKeys: [],
    async render() {
      return () => ({ title: 'Library home', html: <section><h1>Library home</h1><label>Home draft <input /></label></section> });
    },
  });
  router.implement(album, {
    untrackedKeys: [],
    async render(_params, { pageStatus }) {
      started.push('album');
      if (holdAlbum) await albumRender.promise;
      return () => ({ title: 'Album', html: <Album status={pageStatus} /> });
    },
  });
  router.implement(css, {
    untrackedKeys: [],
    async render() {
      return () => ({ title: 'CSS page', html: <CssPage /> });
    },
  });
  router.implement(notes, {
    untrackedKeys: [],
    async render(_params, { pageStatus }) {
      started.push('notes');
      notesStatus = pageStatus;
      return () => ({ title: 'Notes', html: <Notes /> });
    },
  });
  router.implement(summary, {
    untrackedKeys: [],
    async render() {
      return () => ({ title: 'Summary', html: <motion.section data-testid="summary-page" initial={{ opacity: 0.2 }}
        animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition}><h2>Summary</h2></motion.section> });
    },
  });

  render(() => <>
    <style>{`
      .library-slot { position: relative; width: 400px; }
      .library-slot > .css-page { width: 50%; margin: 0 20px; opacity: 0; transition: opacity 3600s linear; }
      .library-slot > .css-page.selected { opacity: 1; }
    `}</style>
    <nav aria-label="Library navigation">
      <Link route={notes} prefetch={{ hover: 0, focus: false, press: false, respectSaveData: false }}>Open album</Link>
    </nav>
    <Outlet component="main" />
  </>, element);

  const fixture = {
    started, albumExits,
    get localEnters() { return localEnters; },
    get notesStatus() { return notesStatus; },
    releaseAlbum: () => albumRender.resolve(),
    async openAlbum() { await router.navigate(notes.locate({})).finished; },
    async openCssPage() { await router.navigate(css.locate({})).finished; },
    async replaceWithHome() { await router.navigate(home.locate({}), { mode: 'replace' }).finished; },
    async showSummary() { await router.navigate(summary.locate({})).finished; },
  };
  window.routeMotionFixture = fixture;
  return fixture;
}
