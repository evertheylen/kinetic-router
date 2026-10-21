/* @refresh skip */
// Recreate the module-level Router and root Outlet together on app updates.
import { render } from "@solidjs/web";

import { homePage, sitemap } from "./sitemap.js";
import { Link } from "@kinetic-router/solid/link.js";
import "./routes.js";
import { Outlet } from "@kinetic-router/solid/outlet.js";
import { index } from "@kinetic-router/definition";

export default function App() {
  return (
    <main>
      <nav aria-label="Main navigation">
        <ul>
          <li><Link route={homePage} mode="menu">Home</Link></li>
          <li><Link route={sitemap.account} mode="menu">Account</Link></li>
          <li><Link route={sitemap.explore[index]} mode="menu">Agencies</Link></li>
        </ul>
      </nav>
      <p>Hover or keyboard-focus a link to prepare its page; pressing prepares it immediately.</p>
      <p>Menu links resume your last visit. Select Agencies from an agency page to return to the list.</p>
      <Outlet component="div" />
    </main>
  );
}

const root = document.getElementById('root');

render(() => <App />, root!);
