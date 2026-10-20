import { onCleanup } from 'solid-js';

let lastTimestamp = 0;
let instanceCount = 0;

export function Fingerprint() {
  // Distinguish even two instances rendered in the same millisecond.
  const timestamp = lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
  const instance = ++instanceCount;
  const created = new Date(timestamp);
  let seed = 2166136261;
  for (const character of String(timestamp)) {
    seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  }

  function animateBorder(border: SVGRectElement) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | undefined;
    function update() {
      animation?.cancel();
      animation = reducedMotion.matches ? undefined : border.animate(
        [{ strokeDashoffset: '0px' }, { strokeDashoffset: '-100px' }],
        // Refs can run while SVG nodes still belong to an inert template document.
        { duration: 10_000, iterations: Infinity, easing: 'linear', timeline: document.timeline },
      );
    }
    update();
    reducedMotion.addEventListener('change', update);
    onCleanup(() => {
      reducedMotion.removeEventListener('change', update);
      animation?.cancel();
    });
  }

  return <div class="page-fingerprint" data-testid="page-fingerprint" data-instance={String(timestamp)}
    title={`Page instance ${instance}, created ${created.toISOString()}. The same badge means the same rendered page.`}
    style={{
      '--fingerprint-hue': String(seed % 360),
      '--fingerprint-angle': `${seed % 180}deg`,
      '--fingerprint-size': `${12 + (seed >>> 16) % 16}px`,
    }}>
    <svg class="fingerprint-border" viewBox="0 0 160 64" preserveAspectRatio="none" aria-hidden="true">
      <rect ref={animateBorder} x="2" y="2" width="156" height="60" rx="12" pathLength="100" />
    </svg>
    <span class="fingerprint-caption">Page instance #{instance}</span>
    <time datetime={created.toISOString()}>{created.toTimeString().slice(0, 8)}</time>
  </div>;
}
