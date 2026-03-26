import { RoutingContract } from "@kinetic-router/solid/src/contract";
import { sitemap } from "./sitemap";

export const contract = new RoutingContract<
  { viewAs: 'mainpage' | 'detail' | 'fullscreen' },
  { description: string }
>()

export const routeImpl = contract.implementation(sitemap);
