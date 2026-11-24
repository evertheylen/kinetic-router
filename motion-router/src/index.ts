import { createOutlet } from '@kinetic-router/solid/outlet.js';

function presentExit(outlet: HTMLElement, page: Node) {
  const document = outlet.ownerDocument;
  const view = document.defaultView!;
  if (!(page instanceof view.HTMLElement)) {
    // Text and other non-HTML output do not expose HTML layout offsets or inert.
    const layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;pointer-events:none;';
    layer.setAttribute('data-kinetic-router-outgoing', '');
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    outlet.insertBefore(layer, page.parentNode === outlet ? page : null);
    layer.append(page);
    return { node: layer };
  }

  const attributes = ['data-kinetic-router-outgoing', 'inert', 'aria-hidden'];
  const values = attributes.map(name => page.getAttribute(name));
  const styles: [string, string, string][] = [];
  const hadStyle = page.hasAttribute('style');
  const css = view.getComputedStyle(page);
  if (css.position !== 'absolute' && css.position !== 'fixed') {
    // Keep the root a direct child so outlet-scoped CSS still applies. Use
    // layout offsets, not its transformed visual bounds, to freeze the box.
    const exitStyles = {
      position: 'absolute', left: `${page.offsetLeft}px`, top: `${page.offsetTop}px`,
      right: 'auto', bottom: 'auto', width: css.width, height: css.height,
      'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
    };
    for (const [name, value] of Object.entries(exitStyles)) {
      styles.push([name, page.style.getPropertyValue(name), page.style.getPropertyPriority(name)]);
      page.style.setProperty(name, value, 'important');
    }
  }
  page.setAttribute('data-kinetic-router-outgoing', '');
  page.setAttribute('inert', '');
  page.setAttribute('aria-hidden', 'true');
  return {
    node: page,
    restore() {
      for (const [name, value, priority] of styles) page.style.setProperty(name, value, priority);
      if (!hadStyle && !page.style.length) page.removeAttribute('style');
      attributes.forEach((name, index) => {
        const value = values[index];
        if (value === null) page.removeAttribute(name);
        else page.setAttribute(name, value);
      });
    },
  };
}

/** Experimental workspace companion to `@kinetic-router/motion` and
 * `@kinetic-router/lifecycle`. Same props and dumb-SSR behavior as Outlet;
 * each nested slot opts in separately. A retained HTML page stays a direct child,
 * but its normal-flow root is temporarily taken out of flow with a fixed layout
 * box. Use a positioned outlet and a page root that generates a box (not
 * `display: contents`). Animate an inner element for layout-property effects.
 * The outgoing subtree is inert and aria-hidden. Gate external portals and
 * native modal dialogs on PageStatus.isVisible(): they escape ancestor inertness.
 * Exit work does not delay navigation.finished. */
export const MotionOutlet = createOutlet(presentExit);
