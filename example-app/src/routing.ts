import { Router } from "@kinetic-router/solid/router.js";
import { detectNativeEngine } from "@kinetic-router/native-bridge";
import { sitemap } from "./sitemap";

export const router = new Router<
  { viewAs: 'mainpage' | 'detail' | 'fullscreen' },
  { description: string }
>(sitemap, { engine: detectNativeEngine({ sitemap }) });

