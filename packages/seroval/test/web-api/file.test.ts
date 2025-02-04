import { describe, it, expect } from 'vitest';
import 'node-fetch-native/polyfill';
import {
  deserialize,
  fromJSON,
  serializeAsync,
  toJSONAsync,
} from '../../src';

describe('File', () => {
  describe('serializeAsync', () => {
    it('supports File', async () => {
      const example = new File(['Hello World'], 'hello.txt', {
        type: 'text/plain',
        lastModified: 1681027542680,
      });
      const result = await serializeAsync(Promise.resolve(example));
      expect(result).toMatchSnapshot();
      const back = await deserialize<Promise<File>>(result);
      expect(back).toBeInstanceOf(File);
      expect(await back.text()).toBe(await example.text());
      expect(back.type).toBe(example.type);
    });
  });
  describe('toJSONAsync', () => {
    it('supports File', async () => {
      const example = new File(['Hello World'], 'hello.txt', {
        type: 'text/plain',
        lastModified: 1681027542680,
      });
      const result = await toJSONAsync(Promise.resolve(example));
      expect(JSON.stringify(result)).toMatchSnapshot();
      const back = await fromJSON<Promise<File>>(result);
      expect(back).toBeInstanceOf(File);
      expect(await back.text()).toBe(await example.text());
      expect(back.type).toBe(example.type);
    });
  });
});
