import { it } from 'vitest';
import { param, route } from "./index.js";

const usersOverview = route({
  nameFilter: param.search<string>().optional(),
  foobar: param.hidden<number>(),
});

// @ts-expect-error — foobar is required but missing
usersOverview.getUrl({});

// @ts-expect-error — extraProp is not declared
usersOverview.getUrl({ foobar: 123, nameFilter: 'test', extraProp: true });

// optional params may be omitted
usersOverview.getUrl({ foobar: 99 });

it('type-checks pass', () => {});
