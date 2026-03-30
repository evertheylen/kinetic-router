import { Router } from "@kinetic-router/solid/router.js";
import { sitemap } from "./sitemap";

export const router = new Router<
  { viewAs: 'mainpage' | 'detail' | 'fullscreen' },
  { description: string }
>(sitemap);

