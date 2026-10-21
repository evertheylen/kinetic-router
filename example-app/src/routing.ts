import { Router } from "@kinetic-router/solid/router.js";
import { sitemap } from "./sitemap.js";

export const router = new Router<
  { viewAs: 'mainpage' | 'detail' | 'fullscreen' },
  { description: string }
>(sitemap, { prefetch: true });

