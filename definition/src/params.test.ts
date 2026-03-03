import { it } from 'vitest';
import { param, route } from "./index.js";

const usersOverview = route({
  nameFilter: param.search<string>().optional(),
  foobar: param.hidden<number>(),
});

// @ts-expect-error — foobar is required but missing
usersOverview.locate({});

// @ts-expect-error — extraProp is not declared
usersOverview.locate({ foobar: 123, nameFilter: 'test', extraProp: true });

// optional params may be omitted
usersOverview.locate({ foobar: 99 });

it('type-checks pass', () => {});
