/* eslint-disable no-restricted-globals */
import assert from '../assert';

const REFERENCE = new Map<unknown, string>();
const INV_REFERENCE = new Map<string, unknown>();

export function createReference<T>(id: string, value: T): T {
  REFERENCE.set(value, id);
  INV_REFERENCE.set(id, value);
  return value;
}

export function hasReferenceID<T>(value: T): boolean {
  return REFERENCE.has(value);
}

export function hasReference(id: string): boolean {
  return INV_REFERENCE.has(id);
}

export function getReferenceID<T>(value: T): string {
  assert(hasReferenceID(value), 'Missing reference id');
  return REFERENCE.get(value) as string;
}

export function getReference<T>(id: string): T {
  assert(hasReference(id), 'Missing reference for id:' + id);
  return INV_REFERENCE.get(id) as T;
}

export const GLOBAL_KEY = '__SEROVAL__';

if (typeof globalThis !== undefined) {
  Object.defineProperty(globalThis, GLOBAL_KEY, {
    value: INV_REFERENCE,
    configurable: true,
    writable: false,
    enumerable: false,
  });
} else if (typeof window !== undefined) {
  Object.defineProperty(window, GLOBAL_KEY, {
    value: INV_REFERENCE,
    configurable: true,
    writable: false,
    enumerable: false,
  });
} else if (typeof self !== undefined) {
  Object.defineProperty(self, GLOBAL_KEY, {
    value: INV_REFERENCE,
    configurable: true,
    writable: false,
    enumerable: false,
  });
} else if (typeof global !== undefined) {
  Object.defineProperty(global, GLOBAL_KEY, {
    value: INV_REFERENCE,
    configurable: true,
    writable: false,
    enumerable: false,
  });
}
