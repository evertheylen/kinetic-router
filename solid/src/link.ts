import { isEqual } from '@dovetail-js/utils/equal.js';
import { Route, type Locator, type RouteTarget } from '@kinetic-router/definition/routes.js';
import type { AnyParamDefs } from '@kinetic-router/definition/params.js';
import { createComponent, createMemo, createRenderEffect, createSignal, getOwner, merge, omit, onCleanup, untrack, useContext } from 'solid-js';
import { dynamic, isServer, type JSX } from '@solidjs/web';
import type { Router, NavigationMode } from './router.js';
import type { PreparationLease } from './preparation-registry.js';
import { locatorToUrl } from '@kinetic-router/url';
import { DumbSsrContext, withoutClientHandlers } from './dumb-ssr-context.js';

export type LinkMode = NavigationMode;
/** Speculative interaction settings. Delays are finite, nonnegative milliseconds;
 * zero starts immediately. These defaults apply once prefetch is enabled. */
export type PrefetchOptions = {
  /** Continuous, non-touch hover delay; false disables it. Default: 75. */
  hover?: false | number,
  /** Prepare immediately on primary pointer press. Default: true. */
  press?: boolean,
  /** Keyboard/assistive focus delay; false disables it. Default: 75. */
  focus?: false | number,
  /** This Link's release grace period after interaction ends. Default: 0. */
  cancelDelay?: number,
  /** Suppress speculation when saveData is true, not navigation. Default: true. */
  respectSaveData?: boolean,
};
/** Disabled by default. An omitted Link value inherits the Router setting;
 * false disables, true enables with inherited options, and an object enables
 * while overriding individual options. Precedence: defaults, Router, Link. */
export type Prefetch = boolean | PrefetchOptions;
export type LinkProps<ParamDefs extends AnyParamDefs> = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  /** Locator, or a bare Route when no values are required. Required parameters
   * are never borrowed from the current page; omitted/undefined values use the
   * declared defaults consistently for preparation, activation, and URL visits. */
  route: RouteTarget<ParamDefs>,
  href?: never,
  /** Defaults to push; menu hrefs reflect the resolved resumable destination. */
  mode?: LinkMode,
  prefetch?: Prefetch,
};
export type Link = <ParamDefs extends AnyParamDefs>(props: LinkProps<ParamDefs>) => JSX.Element;

let activeLink: Link | undefined;

/** A real anchor with reactive URL, children, attributes, refs, and Solid handlers.
 * Caller handlers run first and can prevent internal actions; modified clicks,
 * downloads, and other targets keep native behavior. The active Router is
 * captured once on mount; existing Links never switch to a replacement Router.
 * Dumb SSR emits native anchors only: no refs/handlers/prefetch; menu uses its
 * declared destination rather than browser visit state. */
export const Link: Link = props => {
  const server = isServer && getOwner() ? useContext(DumbSsrContext) : null;
  if (server) {
    const target = props.route;
    const locator = target instanceof Route ? { route: target, values: {} } : target;
    return createComponent(Anchor, merge(withoutClientHandlers(omit(props, 'route', 'mode', 'prefetch', 'href')), {
      href: locatorToUrl(server.sitemap, locator),
    }));
  }
  const implementation = activeLink;
  if (!implementation) throw new Error('Create a Router before rendering Link');
  return createComponent(implementation, props);
};

/** @internal Registration follows the Router lifetime, not individual Links. */
export function registerLink(router: Router<any, any>, prefetch: Prefetch | undefined, isReady: () => boolean): () => void {
  if (activeLink) throw new Error('Only one Router can be active; dispose the previous Router first');
  const implementation = createLink(router, prefetch, isReady);
  activeLink = implementation;
  return () => {
    if (activeLink === implementation) activeLink = undefined;
  };
}

type Settings = Required<PrefetchOptions> & { enabled: boolean };
const defaults: Settings = { enabled: false, hover: 75, press: true, focus: 75, cancelDelay: 0, respectSaveData: true };

function configure(parent: Settings, value?: Prefetch): Settings {
  const settings = { ...parent, enabled: value === undefined ? parent.enabled : value !== false };
  if (typeof value === 'object') {
    for (const key of ['hover', 'press', 'focus', 'cancelDelay', 'respectSaveData'] as const) {
      const option = value[key];
      if (option !== undefined) Object.assign(settings, { [key]: option });
    }
  }
  for (const key of ['hover', 'focus', 'cancelDelay'] as const) {
    const delay = settings[key];
    if (delay === false && key !== 'cancelDelay') continue;
    if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0) {
      throw new RangeError(`prefetch.${key} must be finite and non-negative`);
    }
  }
  return settings;
}

const Anchor = dynamic(() => 'a', { static: true });
const modified = (event: MouseEvent) => event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

function currentContext(anchor: HTMLAnchorElement) {
  if (anchor.hasAttribute('download')) return false;
  const target = anchor.target || document.querySelector('base')?.target || '';
  switch (target.toLowerCase()) {
    case '': case '_self': return true;
    case '_blank': return false;
    case '_parent': return window.parent === window;
    case '_top': return window.top === window;
    default: return target === window.name;
  }
}

/** Only interaction lifetimes live here. Destination planning, shared work and
 * the synchronous navigation handoff belong to the Router. */
function createLink(router: Router<any, any>, prefetch: Prefetch | undefined, isReady: () => boolean): Link {
  const inherited = configure(defaults, prefetch);
  return props => {
    const settings = createMemo(() => configure(inherited, props.prefetch));
    const destination = createMemo(() => {
      const target: Route | Locator<any> = props.route;
      // Preserve bare aliases so activation can re-resolve their original identity.
      return router.resolveDestination(target instanceof Route ? { route: target, values: {} } : target, props.mode);
    }, { equals: (a, b) => a.mode === b.mode && a.url === b.url && a.target.route === b.target.route
      && a.locator.route === b.locator.route && isEqual(a.target.values, b.target.values)
      && isEqual(a.locator.values, b.locator.values) && isEqual(a.operation, b.operation) });
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean, addEventListener?: typeof addEventListener, removeEventListener?: typeof removeEventListener },
    }).connection;
    const [saveData, setSaveData] = createSignal(connection?.saveData === true);
    const restricted = createMemo(() => settings().respectSaveData && saveData());
    const updateSaveData = () => setSaveData(connection?.saveData === true);
    connection?.addEventListener?.('change', updateSaveData);
    onCleanup(() => connection?.removeEventListener?.('change', updateSaveData));

    let hovered = false, focused = false, pointerModality = false;
    let hoverReady = false, focusReady = false;
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    let handoffTimer: ReturnType<typeof setTimeout> | undefined;
    let press: { id: number, type: string } | undefined;
    let lease: PreparationLease | undefined;
    let disposed = false;

    const allowed = () => !disposed && isReady() && settings().enabled && currentContext(anchor)
      && !restricted() && destination().operation.type !== 'no-op';
    const release = () => {
      clearTimeout(cancelTimer);
      cancelTimer = undefined;
      const previous = lease;
      lease = undefined;
      previous?.release();
    };
    const sync = (immediate = false) => {
      const eligible = allowed();
      if (eligible && (hoverReady || focusReady || press)) {
        clearTimeout(cancelTimer);
        cancelTimer = undefined;
        lease ??= router.acquirePreparation(destination());
      } else if (immediate || !eligible || settings().cancelDelay === 0) release();
      else if (lease && cancelTimer === undefined) cancelTimer = setTimeout(release, settings().cancelDelay);
    };
    const hover = () => {
      clearTimeout(hoverTimer);
      const delay = settings().hover;
      if (!hovered || delay === false || !allowed()) return;
      const start = () => { hoverReady = true; sync(); };
      if (delay === 0) start();
      else hoverTimer = setTimeout(start, delay);
    };
    const focus = () => {
      clearTimeout(focusTimer);
      const delay = settings().focus;
      if (!focused || delay === false || !allowed()) return;
      const start = () => { focusReady = true; sync(); };
      if (delay === 0) start();
      else focusTimer = setTimeout(start, delay);
    };
    const stopPress = (immediate = false) => {
      press = undefined;
      clearTimeout(handoffTimer);
      document.removeEventListener('pointermove', outsideMove);
      document.removeEventListener('pointerup', outsideUp);
      document.removeEventListener('pointercancel', outsideCancel);
      sync(immediate);
    };
    const over = (event: PointerEvent) => {
      const rect = anchor.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
    };
    const move = (event: PointerEvent) => {
      if (press?.id === event.pointerId && !over(event)) stopPress(true);
    };
    const up = (event: PointerEvent) => {
      if (press?.id !== event.pointerId) return;
      if (!over(event)) { stopPress(true); return; }
      // A release (including implicit capture loss) is not an abandoned click.
      clearTimeout(handoffTimer);
      handoffTimer = setTimeout(() => stopPress(), 400);
    };
    const cancel = (event: PointerEvent) => {
      if (press?.id === event.pointerId) stopPress(true);
    };
    const outside = (event: Event) => !(event.target instanceof Node) || !anchor.contains(event.target);
    const outsideMove = (event: PointerEvent) => { if (outside(event)) move(event); };
    const outsideUp = (event: PointerEvent) => { if (outside(event)) up(event); };
    const outsideCancel = (event: PointerEvent) => { if (outside(event)) cancel(event); };

    function handle<E extends Event>(caller: JSX.EventHandlerUnion<HTMLAnchorElement, E> | undefined, event: E, action?: () => void) {
      if (typeof caller === 'function') caller.call(anchor, event as Parameters<typeof caller>[0]);
      else caller?.[0].call(anchor, caller[1], event as E & { currentTarget: HTMLAnchorElement, target: Element });
      if (!event.defaultPrevented) action?.();
    }
    const anchor = createComponent(Anchor, merge(omit(props, 'route', 'mode', 'prefetch', 'href'), {
      get href() { return destination().url; },
      onPointerEnter(event: PointerEvent) {
        handle(props.onPointerEnter, event, () => {
          if (event.pointerType === 'touch' || hovered) return;
          hovered = true;
          hover();
        });
      },
      onPointerLeave(event: PointerEvent) {
        handle(props.onPointerLeave, event, () => {
          if (event.pointerType === 'touch') return;
          hovered = hoverReady = false;
          clearTimeout(hoverTimer);
          // Touch's implicit capture and post-release leave must survive to click.
          if (press && press.type !== 'touch' && event.buttons !== 0) stopPress(true);
          else sync();
        });
      },
      onFocus(event: FocusEvent) {
        handle(props.onFocus, event, () => { focused = !pointerModality || anchor.matches(':focus-visible'); focus(); });
      },
      onBlur(event: FocusEvent) {
        handle(props.onBlur, event, () => {
          focused = focusReady = false;
          clearTimeout(focusTimer);
          sync();
        });
      },
      onPointerDown(event: PointerEvent) {
        handle(props.onPointerDown, event, () => {
          if (event.button !== 0 || event.isPrimary === false || modified(event) || !allowed() || !settings().press) return;
          stopPress(true);
          press = { id: event.pointerId, type: event.pointerType };
          // Press promotes pending hover/focus without losing their independence.
          clearTimeout(hoverTimer); clearTimeout(focusTimer);
          hoverReady = hovered && settings().hover !== false;
          focusReady = focused && settings().focus !== false;
          document.addEventListener('pointermove', outsideMove);
          document.addEventListener('pointerup', outsideUp);
          document.addEventListener('pointercancel', outsideCancel);
          sync();
        });
      },
      onPointerMove(event: PointerEvent) { handle(props.onPointerMove, event, () => move(event)); },
      onPointerUp(event: PointerEvent) {
        handle(props.onPointerUp, event, () => up(event));
        if (event.defaultPrevented) cancel(event);
      },
      onPointerCancel(event: PointerEvent) {
        handle(props.onPointerCancel, event);
        cancel(event); // Cancelling the event cannot keep an ended gesture alive.
      },
      onContextMenu(event: PointerEvent) { handle(props.onContextMenu, event, () => stopPress(true)); },
      onDragStart(event: DragEvent) { handle(props.onDragStart, event, () => stopPress(true)); },
      onClick(event: MouseEvent) {
        // The caller may unmount or retarget this Link. Pin existing work until
        // navigation acquires it, without starting speculation before the caller.
        const handoff = lease?.retain();
        try {
          handle(props.onClick, event, () => {
            if (event.button !== 0 || modified(event) || !currentContext(anchor) || !isReady()) return;
            event.preventDefault();
            const navigation = router.activateDestination(destination());
            // The engine reports actual failures; fire-and-forget clicks still
            // observe rejection, including host cancellation before commit.
            void navigation.finished?.catch(() => {});
          });
        } finally {
          try { stopPress(); }
          finally { handoff?.release(); }
        }
      },
    })) as HTMLAnchorElement;

    const pointer = () => { pointerModality = true; };
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      pointerModality = false;
      if (document.activeElement === anchor && !focused) { focused = true; focus(); }
    };
    const abandon = () => stopPress(true);
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', keyboard);
    window.addEventListener('blur', abandon);

    onCleanup(() => untrack(() => {
      disposed = true;
      clearTimeout(hoverTimer); clearTimeout(focusTimer);
      stopPress(true);
      release();
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', keyboard);
      window.removeEventListener('blur', abandon);
    }));
    // Configuration/destination changes are hard boundaries, not hover grace.
    // Re-evaluate ongoing hover/focus, but never replay an old pointer-down.
    createRenderEffect(() => [destination(), settings(), isReady(), restricted(), props.target, props.download], () => untrack(() => {
      clearTimeout(hoverTimer); clearTimeout(focusTimer);
      hoverReady = focusReady = false;
      stopPress(true);
      release();
      hover(); focus();
    }));
    return anchor;
  };
}
