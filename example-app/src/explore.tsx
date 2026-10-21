import { Frame } from "@kinetic-router/solid/frame.js";
import { Link } from "@kinetic-router/solid/link.js";
import { Fingerprint } from "@kinetic-router/testing-utils/fingerprint.js";
import { index } from "@kinetic-router/definition";

import { router } from "./routing.js";
import { agencyId, explore, sitemap } from "./sitemap.js";
import { TrainImage } from "./train-image.js";

router.implement(explore, {
  untrackedKeys: [],
  viewAs: 'mainpage',
  async render() {
    return () => {
      const html = <div>
        <h1>Agencies</h1>
        <Fingerprint />
        <Frame component="div" class="route-frame" />
      </div>;

      return { html, title: 'agencies', description: 'Agency wrapper' };
    }
  }
});

router.implement(sitemap.explore[index], {
  untrackedKeys: [],
  viewAs: 'mainpage',
  async render() {
    return () => {
      const html = (
        <section>
          <Fingerprint />
          <ul>
            <li><Link route={sitemap.explore[agencyId.$].locate({ agencyId: 'NMBS' })}>NMBS</Link> — default prefetch</li>
            <li><Link route={sitemap.explore[agencyId.$].locate({ agencyId: 'DB' })} prefetch={{ hover: 150 }}>DB</Link> — 150 ms hover</li>
            <li><Link route={sitemap.explore[agencyId.$].locate({ agencyId: 'OBB' })} prefetch={false}>ÖBB</Link> — no prefetch</li>
          </ul>
          <p>The layout stays mounted between agencies. Matching fingerprints mean the same rendered instance.</p>
          <TrainImage page="agencies" />
        </section>
      );

      return { html, title: 'agencies', description: 'List of agencies' };
    }
  }
});


router.implement(sitemap.explore[agencyId.$], {
  untrackedKeys: [],
  viewAs: 'mainpage',
  async render() {
    return (params) => {
      const html = (
        <section>
          <h2>This is {params.agencyId}</h2>
          <Fingerprint />
          <TrainImage page={params.agencyId} />
        </section>
      );

      return { html, get title() { return params.agencyId; }, get description() { return `agency ${params.agencyId}`; } };
    }
  }
})
