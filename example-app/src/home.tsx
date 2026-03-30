import { router } from "./routing";
import { homePage } from "./sitemap";

router.implement(homePage, {
  untrackedKeys: [],
  viewAs: 'mainpage',
  async render(untrackedParams) {
    return (params) => {
      const html = <div>
        <h1>Welcome to the homepage!</h1>
      </div>;

      return { html, title: 'home', description: 'This is home' };
    }
  },
})

