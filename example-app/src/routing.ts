import { RoutingContract } from "@kinetic-router/solid/contract.js";
import { sitemap } from "./sitemap";

export const contract = new RoutingContract<
  { viewAs: 'mainpage' | 'detail' | 'fullscreen' },
  { description: string }
>()

export const routeImpl = contract.implementation(sitemap);
