import { expect, it, vi } from 'vitest';
import { param, route } from "./index.js";
import { convertParamsByDefinition, convertParamsByKey } from './params.js';

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

it('normalizes omitted and undefined defaults without changing explicit values', () => {
  const definitions = {
    path: param.path<string>().withDefault('home'),
    query: param.search<string>().withDefault('all'),
    hidden: param.hidden<number>().withDefault(42),
    optional: param.search<string>().optional(),
  };
  const r = route(definitions);
  const normalize = (values: Parameters<typeof r.locate>[0]) =>
    convertParamsByKey(convertParamsByDefinition(values, definitions), definitions);
  expect(normalize({})).toEqual({ path: 'home', query: 'all', hidden: 42 });
  expect('optional' in normalize({})).toBe(false);
  expect(normalize({ path: undefined, query: undefined, hidden: 0 })).toEqual({
    path: 'home', query: 'all', hidden: 0, optional: undefined,
  });
  expect(normalize({ path: '', query: '', hidden: 7 })).toEqual({ path: '', query: '', hidden: 7, optional: undefined });
  const nullable = route({ value: param.hidden<string | null>().withDefault('default') });
  expect(nullable.locate({ value: null }).values.value).toBeNull();
});

it('resolves a factory default once per located value and leaves the input untouched', () => {
  const makeDefault = vi.fn(() => ({ value: 42 }));
  const r = route({ payload: param.hidden<{ value: number }>().withDefault(makeDefault) });
  const input = {};
  const locator = r.locate(input);
  expect(locator.values.payload).toEqual({ value: 42 });
  expect(r.locate(locator.values).values.payload).toBe(locator.values.payload);
  expect(makeDefault).toHaveBeenCalledOnce();
  expect(input).toEqual({});
});
