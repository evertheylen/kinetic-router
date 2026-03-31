import { Route } from "./routes";

// Not using a symbol even though that might be cleanest
// BUT it collides with symbol usage for path params!
// if [index] and [pathParam.$] are both symbols you can no longer differentiate
// routes as typescript consider `pathParam.$` as a generic symbol.
// Using empty string instead!
export const index = "";

export type Sitemap = SubRoutes | Route;

export type SubRoutes = (
  { ''?: Route }
  & (
    // sadly can't exclude ""
    { [key in string]: Sitemap }
    // cant enforce a single path param sadly
    | { [key in symbol]: Sitemap }
  )
);
