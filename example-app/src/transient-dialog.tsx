import { render } from "@solidjs/web";
import { Link } from "@kinetic-router/solid/link.js";
import { router } from "./routing.js";
import { sitemap } from "./sitemap.js";

function openDialog(level = 1) {
  const handle = router.pushTransient(() => {
    const dialog = document.createElement('dialog');
    dialog.className = 'transient-dialog';
    dialog.setAttribute('aria-label', `Dialog level ${level}`);
    // Escape must traverse history rather than independently closing the dialog.
    dialog.oncancel = event => { event.preventDefault(); handle.close(); };
    const dispose = render(() => <>
      <h2>Dialog level {level}</h2>
      <p>Open as many levels as you like. Back, Escape, or Close dismisses just this level.</p>
      <label>Dialog notes <input placeholder="These stay while a child is open" /></label>
      <div class="dialog-actions">
        <button type="button" autofocus onClick={() => openDialog(level + 1)}>Open another dialog</button>
        <button type="button" onClick={() => handle.close()}>Close</button>
      </div>
      <Link route={sitemap.account}>Go to Account and close all dialogs</Link>
    </>, dialog);
    document.body.append(dialog);
    // Native dialogs provide focus trapping and restore focus when closed.
    dialog.showModal();
    return () => {
      dialog.close();
      dispose();
      dialog.remove();
    };
  });
}

export function TransientDialogDemo() {
  return <section class="transient-demo" aria-label="Transient dialog demo">
    <h2>Back-dismissible dialogs</h2>
    <p>Each dialog adds a history entry without changing the URL or recreating this page.
      Forward won't reopen a closed dialog.</p>
    <button type="button" onClick={() => openDialog()}>Open dialog</button>
    <p>Try nesting dialogs, then navigating away. All dialogs close, but nested entries
      may leave extra Back steps. The console warns about this on each nested open.</p>
  </section>;
}
