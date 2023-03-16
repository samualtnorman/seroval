/* eslint-disable no-await-in-loop */
import { Feature } from './compat';
import {
  SerializationContext,
  getRefParam,
  Options,
  createParserContext,
  createSerializationContext,
} from './context';
import parseAsync from './tree/async';
import SerovalSerializer, { resolvePatches } from './tree/serialize';
import parseSync from './tree/sync';
import { SerovalNode } from './tree/types';
import {
  AsyncServerValue,
  PrimitiveValue,
  ServerValue,
  CommonServerValue,
  SemiPrimitiveValue,
  ErrorValue,
} from './types';

export {
  AsyncServerValue,
  ServerValue,
  PrimitiveValue,
  CommonServerValue,
  SemiPrimitiveValue,
  ErrorValue,
};

function finalize(
  ctx: SerializationContext,
  rootID: number,
  isObject: boolean,
  result: string,
) {
  // Shared references detected
  if (ctx.vars.length) {
    const patches = resolvePatches(ctx);
    let body = result;
    if (patches) {
      // Get (or create) a ref from the source
      const index = getRefParam(ctx, rootID);
      if (result.startsWith(`${index}=`)) {
        body = `${result},${patches}${index}`;
      } else {
        body = `${index}=${result},${patches}${index}`;
      }
    }
    let params = ctx.vars.length > 1
      ? ctx.vars.join(',')
      : ctx.vars[0];
    // Source is probably already assigned
    if (ctx.features & Feature.ArrowFunction) {
      params = ctx.vars.length > 1 || ctx.vars.length === 0
        ? `(${params})`
        : params;
      return `(${params}=>(${body}))()`;
    }
    return `(function(${params}){return ${body}})()`;
  }
  if (isObject) {
    return `(${result})`;
  }
  return result;
}

export function serialize<T extends ServerValue>(
  source: T,
  options?: Partial<Options>,
) {
  const ctx = createParserContext(options);
  const [tree, rootID, isObject] = parseSync(ctx, source);
  const serial = createSerializationContext(ctx);
  const result = SerovalSerializer.serialize(serial, tree);
  return finalize(serial, rootID, isObject, result);
}

export async function serializeAsync<T extends AsyncServerValue>(
  source: T,
  options?: Partial<Options>,
) {
  const ctx = createParserContext(options);
  const [tree, rootID, isObject] = await parseAsync(ctx, source);
  const serial = createSerializationContext(ctx);
  const result = SerovalSerializer.serialize(serial, tree);
  return finalize(serial, rootID, isObject, result);
}

export function deserialize<T extends AsyncServerValue>(source: string): T {
  // eslint-disable-next-line no-eval
  return (0, eval)(source) as T;
}

interface SerovalJSON {
  t: SerovalNode,
  r: number,
  i: boolean,
  f: number,
  m: number[],
}

export function toJSON<T extends ServerValue>(
  source: T,
  options?: Partial<Options>,
) {
  const ctx = createParserContext(options);
  const [tree, root, isObject] = parseSync(ctx, source);
  return JSON.stringify({
    t: tree,
    r: root,
    i: isObject,
    f: ctx.features,
    m: Array.from(ctx.markedRefs),
  });
}

export async function toJSONAsync<T extends AsyncServerValue>(
  source: T,
  options?: Partial<Options>,
) {
  const ctx = createParserContext(options);
  const [tree, root, isObject] = await parseAsync(ctx, source);
  return JSON.stringify({
    t: tree,
    r: root,
    i: isObject,
    f: ctx.features,
    m: Array.from(ctx.markedRefs),
  });
}

export function compileJSON(source: string): string {
  const parsed = JSON.parse(source) as SerovalJSON;
  const serial = createSerializationContext({
    features: parsed.f,
    markedRefs: parsed.m,
  });
  const result = SerovalSerializer.serialize(serial, parsed.t);
  return finalize(serial, parsed.r, parsed.i, result);
}

export function fromJSON<T extends AsyncServerValue>(source: string): T {
  return deserialize<T>(compileJSON(source));
}

export default serialize;
