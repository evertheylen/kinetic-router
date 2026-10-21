
export const Backstage = () => {
  const el = document.createElement('div');
  el.setAttribute('data-kinetic-router-backstage', '');
  el.inert = true;
  el.setAttribute('aria-hidden', 'true');
  // Fixed viewport geometry without document layout/scroll overflow. Unlike
  // display:none, descendants can measure and lay out during preparation.
  el.style.cssText = 'position:fixed;inset:0;overflow:hidden;contain:layout style paint;visibility:hidden;opacity:0;pointer-events:none;';
  return el;
}
