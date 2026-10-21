import { router } from "./routing.js";
import { sitemap } from "./sitemap.js";
import "./home.js";
import "./explore.js";

router.implementLazy(sitemap.account, () => import("./account.js").then(module => module.default), {
  untrackedKeys: [],
  viewAs: 'mainpage',
});

router.implementLazy(sitemap.todos, () => import("./todos.js").then(module => module.default), {
  untrackedKeys: [],
  viewAs: 'mainpage',
});
