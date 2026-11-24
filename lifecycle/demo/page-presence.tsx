import { render } from '@solidjs/web'
import { createPagePresence, PresenceContext } from '@kinetic-router/presence'
import { createCssTransition, createTransition, fade } from '@kinetic-router/motion'
import { Lifecycle } from '../src/index.js'

function NativeEntry() {
  const transition = createTransition(fade, { duration: 5_000, delay: 1_000, easing: 'linear' })
  return <div id="routed-native" ref={transition}>Nested native entry</div>
}

function Page() {
  const transition = createCssTransition({
    properties: ['opacity'],
    apply(element, direction) { element.dataset.direction = direction },
  })
  return <>
    <div id="routed-css" ref={transition}>Page CSS transition</div>
    <Lifecycle.Show when={true}><NativeEntry /></Lifecycle.Show>
  </>
}

export function mountPagePresenceFixture(container: HTMLElement) {
  const page = document.createElement('article')
  let presence!: ReturnType<typeof createPagePresence>
  render(() => {
    presence = createPagePresence()
    return <PresenceContext value={presence}><Page /></PresenceContext>
  }, page)
  render(() => {
    let live!: HTMLDivElement
    function present(animate: boolean) {
      live.append(page)
      presence.present(animate)
    }
    function park() {
      page.remove()
      presence.park()
    }
    return <>
      <style>{`
        #routed-css { opacity: 0.15; transition: opacity 5s linear; }
        #routed-css[data-direction=in] { opacity: 1; }
      `}</style>
      <button onClick={() => present(true)}>Present</button>
      <button onClick={() => present(false)}>Snap</button>
      <button onClick={() => presence.exit(park)}>Exit</button>
      <button onClick={park}>Park</button>
      <div id="staged" style={{ visibility: 'hidden' }} ref={node => node.append(page)} />
      <div id="live" ref={live} />
    </>
  }, container)
}
