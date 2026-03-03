import { param, Serde } from '@kinetic-router/definition';

export const userId = param.path<string>();
export const postId = param.path<number>();

export const numberSerde: Serde<number> = {
  serialize: (n: number) => n,
  deserialize: (v: unknown) => Number(v),
};

export const stringSerde: Serde<string> = {
  serialize: (s: string) => s,
  deserialize: (v: unknown) => String(v),
};
