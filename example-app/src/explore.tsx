import { Frame } from "@kinetic-router/solid/frame.js";
import { index } from "@kinetic-router/definition";

import { router } from "./routing";
import { agencyId, explore, sitemap } from "./sitemap";

// top page
router.implement(explore, {
  untrackedKeys: [],
  viewAs: 'mainpage',
  async render(untrackedParams) {
    return (params) => {
      const html = <div>
        <h1>Agencies</h1>
        <Frame component="div" style={{ padding: '10px', margin: '10px', border: '1px solid red' }}/>
      </div>;

      return { html, title: 'agencies', description: 'Agency wrapper' };
    }
  }
});

router.implement(sitemap.explore[index], {
  untrackedKeys: [],
  // TODO: viewAs no longer important for nested routes?
  viewAs: 'mainpage',
  async render(untrackedParams) {
    return (params) => {
      const html = (
        <ul>
          <li><a href={router.toUrl(sitemap.explore[agencyId.$].locate({ agencyId: 'NMBS' }))}>NMBS</a></li>
          <li><a href={router.toUrl(sitemap.explore[agencyId.$].locate({ agencyId: 'DB' }))}>DB</a></li>
          <li><a href={router.toUrl(sitemap.explore[agencyId.$].locate({ agencyId: 'OBB' }))}>OBB</a></li>
        </ul>
      );

      return { html, title: 'agencies', description: 'List of agencies' };
    }
  }
});


router.implement(sitemap.explore[agencyId.$], {
  untrackedKeys: [],
  // TODO: viewAs no longer important for nested routes?
  viewAs: 'mainpage',
  async render(untrackedParams) {
    return (params) => {
      const html = (
        <h2>This is {params.agencyId}</h2>
      );

      return { html, title: params.agencyId, get description() { return `agency ${params.agencyId}` } };
    }
  }
})
