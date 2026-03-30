import { router } from "./routing";
import { sitemap } from "./sitemap";

router.implement(sitemap.account, {
  untrackedKeys: [],
  viewAs: 'mainpage',
  async render(untrackedParams) {
    return (params) => {
      const html = <div>
        <h1>Account</h1>
      </div>;

      return { html, title: 'account', description: 'Your account' };
    }
  },
})

