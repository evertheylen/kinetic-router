import { Route } from "./routes";

export const index: unique symbol = Symbol('kinetic-router:index');

export type Sitemap = SubRoutes | Route;

export type SubRoutes = (
  { [key in typeof index]?: Route }
  & (
    { [key in string]: Sitemap }
    // cant enforce a single path param sadly
    | { [key in symbol]: Sitemap }
  )
);

