import { render } from '@solidjs/web';
import { createSignal, onCleanup } from 'solid-js';
import { instruction, type Scenario, type Snapshot } from './scenario.js';
import { scenarios } from './scenarios/index.js';
import { actionTarget, mismatches, performAction, readSnapshot } from './checks.js';
import './style.css';

const activeKey = 'kinetic-router-scenario';
const scenarioId = new URL(location.href).searchParams.get('scenario')
  ?? sessionStorage.getItem(activeKey);
const scenario = scenarios.find(scenario => scenario.id === scenarioId);
const root = document.getElementById('root')!;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function Picker() {
  return <main class="picker">
    <h1>Router scenarios</h1>
    <p>Each scenario opens in a fresh tab so its history starts empty.</p>
    <ul>{scenarios.map(scenario => <li>
      <a href={`/home?scenario=${scenario.id}`} target="_blank" rel="noopener">{scenario.name}</a>
    </li>)}</ul>
    <p>Follow the highlighted controls; checks run automatically. Or use Run step / Autoplay.</p>
  </main>;
}

function HistoryStack(props: { paths: string[], index?: number, label: string }) {
  return <ol class="history-stack" role="list" aria-label={props.label}>
    {props.paths.map((path, index) => <li aria-current={index === props.index ? 'page' : undefined}>
      <code>{path}</code>{index === props.index && <span>current</span>}
    </li>)}
  </ol>;
}

function Expectations(props: { expected: Partial<Snapshot> }) {
  return <div class="expectations">
    {props.expected.history && <>
      <p>After this step, we expect the stack to be:</p>
      <HistoryStack paths={props.expected.history} index={props.expected.index} label="Expected history stack" />
    </>}
    {props.expected.heading !== undefined && <p>Visible page: <strong>{props.expected.heading ?? 'none'}</strong>.</p>}
    {props.expected.notes !== undefined && <p>Notes: <q>{props.expected.notes || '(empty)'}</q>.</p>}
    {props.expected.transition !== undefined && <p>{props.expected.transition === null
      ? 'Navigation should be finished.' : `A ${props.expected.transition} navigation should still be in progress.`}</p>}
    {props.expected.title !== undefined && <p>Document title: <q>{props.expected.title}</q>.</p>}
  </div>;
}

function Playground(props: { scenario: Scenario }) {
  const { scenario } = props;
  const setup = scenario.setup();
  let app!: HTMLDivElement;
  let hint!: HTMLDivElement;
  let highlighted: HTMLElement | undefined;
  let previousDescription: string | null = null;
  let checking = false;
  let isSettled = () => false;
  const [automatic, setAutomatic] = createSignal(new URL(location.href).searchParams.get('checks') !== 'manual');
  const [step, setStep] = createSignal(0);
  const [actual, setActual] = createSignal<Snapshot>();
  const [result, setResult] = createSignal('Ready');
  const [failure, setFailure] = createSignal<string[]>([]);
  const [errors, setErrors] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [playing, setPlaying] = createSignal(false);
  let autoplayController: AbortController | undefined;
  const finished = () => step() === scenario.steps.length;

  function reportError(message: string) {
    setErrors(errors => [...errors, message]);
    autoplayController?.abort();
    setResult('Failed');
  }
  const onError = (event: ErrorEvent) => reportError(event.message);
  const onRejection = (event: PromiseRejectionEvent) => reportError(String(event.reason));
  const onNavigationError = (event: ErrorEvent) => reportError(String(event.error));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.navigation.addEventListener('navigateerror', onNavigationError);
  const timer = setInterval(() => {
    if (!app) return;
    const snapshot = readSnapshot(app);
    setActual(snapshot);
    updateGuide();
    const current = scenario.steps[step()];
    if (automatic() && !checking && !autoplayController && !errors().length && current && !current.action
      && mismatches(current.expect, snapshot).length === 0) void checkStep();
  }, 100);
  onCleanup(() => {
    autoplayController?.abort();
    clearInterval(timer);
    clearGuide();
    app?.removeEventListener('click', onInteraction, true);
    app?.removeEventListener('input', onInteraction, true);
    window.removeEventListener('scroll', updateGuide, true);
    window.removeEventListener('resize', updateGuide);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.navigation.removeEventListener('navigateerror', onNavigationError);
  });
  queueMicrotask(async () => {
    const { mount } = await import('./pages.js');
    isSettled = mount(await setup, app);
    app.addEventListener('click', onInteraction, true);
    app.addEventListener('input', onInteraction, true);
    window.addEventListener('scroll', updateGuide, true);
    window.addEventListener('resize', updateGuide);
  });

  function clearGuide() {
    if (highlighted) {
      highlighted.removeAttribute('data-scenario-target');
      if (previousDescription === null) highlighted.removeAttribute('aria-describedby');
      else highlighted.setAttribute('aria-describedby', previousDescription);
    }
    highlighted = undefined;
    if (hint) hint.hidden = true;
  }

  function updateGuide() {
    if (!app || !hint) return;
    const current = scenario.steps[step()];
    const target = errors().length ? undefined : actionTarget(app, current?.action);
    if (target !== highlighted) {
      clearGuide();
      if (target) {
        highlighted = target;
        previousDescription = target.getAttribute('aria-describedby');
        target.setAttribute('data-scenario-target', 'true');
        target.setAttribute('aria-describedby', `${previousDescription ?? ''} scenario-action-hint`.trim());
        const bounds = target.getBoundingClientRect();
        if (bounds.bottom < 0 || bounds.top > innerHeight) target.scrollIntoView({ block: 'nearest' });
      }
    }
    if (!target || !current) return;
    hint.textContent = instruction(current.action);
    hint.hidden = false;
    const bounds = target.getBoundingClientRect();
    hint.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - hint.offsetWidth - 8))}px`;
    const below = bounds.bottom + 12;
    hint.style.top = `${Math.max(8, below + hint.offsetHeight < innerHeight ? below : bounds.top - hint.offsetHeight - 12)}px`;
  }

  function onInteraction(event: Event) {
    if (!automatic() || checking || autoplayController || errors().length) return;
    const index = step();
    const action = scenario.steps[index]?.action;
    const target = actionTarget(app, action);
    if (!action || !target || !(event.target instanceof Node) || !target.contains(event.target)) return;
    if ('fill' in action) {
      // Don't check while the user is still typing the requested value.
      if (event.type !== 'input' || !(target instanceof HTMLInputElement) || target.value !== action.value) return;
    } else if (event.type !== 'click') return;
    // Let click handlers and link default actions start navigation first.
    setTimeout(() => {
      if (step() === index && automatic() && !checking && !autoplayController) void checkStep();
    }, 0);
  }

  async function checkStep(runAction = false) {
    if (checking || finished() || errors().length) return;
    const index = step();
    const current = scenario.steps[index];
    checking = true;
    setBusy(true);
    setFailure([]);
    setResult('Checking…');
    try {
      if (runAction && current.action) performAction(app, current.action);
      const deadline = performance.now() + 3000;
      while (true) {
        const snapshot = readSnapshot(app);
        setActual(snapshot);
        const problems = [...errors(), ...mismatches(current.expect, snapshot)];
        if (problems.length === 0) break;
        if (errors().length || isSettled() || performance.now() >= deadline) throw new Error(problems.join('\n'));
        await pause(25); // retry only while setup, navigation, or rendering is pending
      }
      setStep(index + 1);
      setResult(index + 1 === scenario.steps.length ? 'Passed' : `Step ${index + 1} passed`);
      return index + 1;
    } catch (error) {
      setFailure([String(error instanceof Error ? error.message : error)]);
      setResult('Failed');
    } finally {
      checking = false;
      setBusy(false);
    }
  }

  async function autoplay() {
    if (autoplayController) { autoplayController.abort(); return; }
    const controller = new AbortController();
    autoplayController = controller;
    setPlaying(true);
    try {
      while (!controller.signal.aborted) {
        const next = await checkStep(true);
        if (next === undefined || next === scenario.steps.length) break;
        await pause(500); // pacing so a human can follow autoplay
      }
    } finally {
      autoplayController = undefined;
      setPlaying(false);
    }
  }

  return <div class="playground">
    <aside aria-label="Scenario plan">
      <a href="/" target="_blank" rel="noopener">All scenarios / start a fresh run</a>
      <h2>{scenario.name}</h2>
      <p>{automatic() ? 'Follow the highlighted control. Checks run automatically after the requested interaction.'
        : 'Follow the highlighted control, then select Check step to verify the result.'}</p>
      <label class="automatic-checks"><input type="checkbox" checked={automatic()}
        onChange={event => setAutomatic(event.currentTarget.checked)} /> Check automatically</label>
      <section class="current-step" aria-label="Current step">
        <p>Step {Math.min(step() + 1, scenario.steps.length)} of {scenario.steps.length}</p>
        <h3>{finished() ? 'Scenario complete' : instruction(scenario.steps[step()]?.action)}</h3>
        {finished() ? <p>All checks passed.</p>
          : scenario.steps[step()]?.intent && <p class="intent">{scenario.steps[step()]?.intent}</p>}
        <Expectations expected={scenario.steps[step()]?.expect ?? {}} />
      </section>
      <p role="status" data-testid="result" class="result" data-state={result()}>
        {result() === 'Passed' && <span aria-hidden="true">✅ </span>}
        {result() === 'Failed' && <span aria-hidden="true">❌ </span>}
        {result()}
      </p>
      <div class="controls">
        <button disabled={busy() || playing() || finished() || errors().length > 0}
          onClick={() => checkStep()}>Check step</button>
        <button disabled={busy() || playing() || finished() || errors().length > 0}
          onClick={() => checkStep(true)}>Run step</button>
        <button disabled={!playing() && (busy() || finished() || errors().length > 0)}
          onClick={autoplay}>{playing() ? 'Stop autoplay' : 'Autoplay'}</button>
      </div>
      {(failure().length > 0 || errors().length > 0) &&
        <pre role="alert">{[...errors(), ...failure()].join('\n')}</pre>}
      <h3>Actual history stack</h3>
      <HistoryStack paths={actual()?.history ?? []} index={actual()?.index} label="Actual history stack" />
      <details><summary>Full scenario plan</summary>
        <ol>{scenario.steps.map((item, index) => <li aria-current={index === step() ? 'step' : undefined}>
          {index < step() ? '✓ ' : ''}{instruction(item.action)}{item.intent && <p>{item.intent}</p>}
        </li>)}</ol>
      </details>
      <details><summary>Technical details</summary>
        <h3>Expected</h3><pre>{JSON.stringify(scenario.steps[step()]?.expect ?? {}, null, 2)}</pre>
        <h3>Actual browser state</h3><pre data-testid="actual">{JSON.stringify(actual(), null, 2)}</pre>
      </details>
    </aside>
    <div class="scenario-app" data-testid="scenario-app" ref={app} />
    <div id="scenario-action-hint" class="action-hint" role="note" ref={hint} hidden />
  </div>;
}

if (location.pathname === '/' || !scenarioId) {
  sessionStorage.removeItem(activeKey);
  render(() => <Picker />, root);
} else if (!scenario) {
  render(() => <main><h1>Unknown scenario</h1><a href="/">All scenarios</a></main>, root);
} else if (!window.navigation) {
  render(() => <main><h1>This browser needs native Navigation API support</h1></main>, root);
} else {
  // Survives URL normalization and reloads without adding a routing-only parameter.
  sessionStorage.setItem(activeKey, scenario.id);
  render(() => <Playground scenario={scenario} />, root);
}
