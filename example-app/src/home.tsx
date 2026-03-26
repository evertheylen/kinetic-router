import { routeImpl } from "./routing";
import { homePage } from "./sitemap";

routeImpl.implement(homePage, {
  staticParams: [],
  viewAs: 'mainpage',
  async render(staticParams) {
    return (params) => {
      const html = <div>
        <h1>Welcome to the homepage!</h1>
      </div>;

      return { html, title: 'home', description: 'This is home' };
    }
  },
})

