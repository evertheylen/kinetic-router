
export const backstageId = '__kinetic_router_backstage';

export const Backstage = () => {
  const el = document.createElement('div');
  el.setAttribute('id', backstageId);
  el.setAttribute('style', 'visibility: hidden;');
  return el;
}
