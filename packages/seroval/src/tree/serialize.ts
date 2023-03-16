/* eslint-disable @typescript-eslint/no-use-before-define */
import { Feature } from '../compat';
import {
  SerializationContext,
  Assignment,
  getRefParam,
  markRef,
} from '../context';
import quote from '../quote';
import {
  SerovalAggregateErrorNode,
  SerovalArrayNode,
  SerovalBigIntTypedArrayNode,
  SerovalErrorNode,
  SerovalIterableNode,
  SerovalMapNode,
  SerovalNode,
  SerovalNodeType,
  SerovalNullConstructorNode,
  SerovalObjectRecordNode,
  SerovalPromiseNode,
  SerovalReferenceNode,
  SerovalSetNode,
  SerovalTypedArrayNode,
} from './types';

function getAssignmentExpression(assignment: Assignment): string {
  switch (assignment.t) {
    case 'index':
      return `${assignment.s}=${assignment.v}`;
    case 'map':
      return `${assignment.s}.set(${assignment.k},${assignment.v})`;
    case 'set':
      return `${assignment.s}.add(${assignment.v})`;
    default:
      return '';
  }
}

function mergeAssignments(assignments: Assignment[]) {
  const newAssignments = [];
  let current = assignments[0];
  let prev = current;
  let item: Assignment;
  for (let i = 1, len = assignments.length; i < len; i++) {
    item = assignments[i];
    if (item.t === prev.t) {
      if (item.t === 'index' && item.v === prev.v) {
        // Merge if the right-hand value is the same
        // saves at least 2 chars
        current = {
          t: 'index',
          s: item.s,
          k: undefined,
          v: getAssignmentExpression(current),
        };
      } else if (item.t === 'map' && item.s === prev.s) {
        // Maps has chaining methods, merge if source is the same
        current = {
          t: 'map',
          s: getAssignmentExpression(current),
          k: item.k,
          v: item.v,
        };
      } else if (item.t === 'set' && item.s === prev.s) {
        // Sets has chaining methods too
        current = {
          t: 'set',
          s: getAssignmentExpression(current),
          k: undefined,
          v: item.v,
        };
      } else {
        // Different assignment, push current
        newAssignments.push(current);
        current = item;
      }
    } else {
      newAssignments.push(current);
      current = item;
    }
    prev = item;
  }

  newAssignments.push(current);

  return newAssignments;
}

function resolveAssignments(assignments: Assignment[]) {
  if (assignments.length) {
    let result = '';
    const merged = mergeAssignments(assignments);
    for (let i = 0, len = merged.length; i < len; i++) {
      result += `${getAssignmentExpression(merged[i])},`;
    }
    return result;
  }
  return undefined;
}

export function resolvePatches(ctx: SerializationContext) {
  return resolveAssignments(ctx.assignments);
}

/**
 * Generates the inlined assignment for the reference
 * This is different from the assignments array as this one
 * signifies creation rather than mutation
 */

function createAssignment(
  ctx: SerializationContext,
  source: string,
  value: string,
) {
  ctx.assignments.push({
    t: 'index',
    s: source,
    k: undefined,
    v: value,
  });
}

function createSetAdd(
  ctx: SerializationContext,
  ref: number,
  value: string,
) {
  markRef(ctx, ref);
  ctx.assignments.push({
    t: 'set',
    s: getRefParam(ctx, ref),
    k: undefined,
    v: value,
  });
}

function createMapSet(
  ctx: SerializationContext,
  ref: number,
  key: string,
  value: string,
) {
  markRef(ctx, ref);
  ctx.assignments.push({
    t: 'map',
    s: getRefParam(ctx, ref),
    k: key,
    v: value,
  });
}

function createArrayAssign(
  ctx: SerializationContext,
  ref: number,
  index: number | string,
  value: string,
) {
  markRef(ctx, ref);
  createAssignment(ctx, `${getRefParam(ctx, ref)}[${index}]`, value);
}

function createObjectAssign(
  ctx: SerializationContext,
  ref: number,
  key: string,
  value: string,
) {
  markRef(ctx, ref);
  createAssignment(ctx, `${getRefParam(ctx, ref)}.${key}`, value);
}

function assignRef(
  ctx: SerializationContext,
  index: number,
  value: string,
) {
  if (ctx.markedRefs.has(index)) {
    return `${getRefParam(ctx, index)}=${value}`;
  }
  return value;
}

function isReferenceInStack(
  ctx: SerializationContext,
  node: SerovalNode,
): node is SerovalReferenceNode {
  return node.t === SerovalNodeType.Reference && ctx.stack.includes(node.i);
}

const IDENTIFIER_CHECK = /^([$A-Z_][0-9A-Z_$]*)$/i;

export default class SerovalSerializer {
  static serializeNodeList(
    ctx: SerializationContext,
    node: SerovalArrayNode | SerovalIterableNode,
  ) {
    // This is different than Map and Set
    // because we also need to serialize
    // the holes of the Array
    const size = node.a.length;
    let values = '';
    let item: SerovalNode;
    let isHoley = false;
    for (let i = 0; i < size; i++) {
      if (i !== 0) {
        // Add an empty item
        values += ',';
      }
      item = node.a[i];
      // Check if index is a hole
      if (item) {
        // Check if item is a parent
        if (isReferenceInStack(ctx, item)) {
          createArrayAssign(ctx, node.i, i, getRefParam(ctx, item.i));
          isHoley = true;
        } else {
          values += this.serialize(ctx, item);
          isHoley = false;
        }
      } else {
        isHoley = true;
      }
    }
    if (isHoley) {
      values += ',';
    }
    return `[${values}]`;
  }

  static serializeArray(
    ctx: SerializationContext,
    node: SerovalArrayNode,
  ) {
    ctx.stack.push(node.i);
    const result = this.serializeNodeList(ctx, node);
    ctx.stack.pop();
    return assignRef(ctx, node.i, result);
  }

  static serializeObject(
    ctx: SerializationContext,
    sourceID: number,
    node: SerovalObjectRecordNode,
  ) {
    if (node.s === 0) {
      return '{}';
    }
    let result = '';
    ctx.stack.push(sourceID);
    let key: string;
    let val: SerovalNode;
    let check: number;
    let isIdentifier: boolean;
    let refParam: string;
    let hasPrev = false;
    for (let i = 0; i < node.s; i++) {
      key = node.k[i];
      val = node.v[i];
      check = Number(key);
      // Test if key is a valid number or JS identifier
      // so that we don't have to serialize the key and wrap with brackets
      isIdentifier = check >= 0 || IDENTIFIER_CHECK.test(key);
      if (isReferenceInStack(ctx, val)) {
        refParam = getRefParam(ctx, val.i);
        if (isIdentifier && Number.isNaN(check)) {
          createObjectAssign(ctx, sourceID, key, refParam);
        } else {
          createArrayAssign(ctx, sourceID, isIdentifier ? key : quote(key), refParam);
        }
      } else {
        if (hasPrev) {
          result += ',';
        }
        result += `${isIdentifier ? key : quote(key)}:${this.serialize(ctx, val)}`;
        hasPrev = true;
      }
    }
    ctx.stack.pop();
    return `{${result}}`;
  }

  static serializeWithObjectAssign(
    ctx: SerializationContext,
    value: SerovalObjectRecordNode,
    id: number,
    serialized: string,
  ) {
    const fields = this.serializeObject(ctx, id, value);
    if (fields !== '{}') {
      return `Object.assign(${serialized},${fields})`;
    }
    return serialized;
  }

  static serializeAssignments(
    ctx: SerializationContext,
    sourceID: number,
    node: SerovalObjectRecordNode,
  ) {
    ctx.stack.push(sourceID);
    const mainAssignments: Assignment[] = [];
    let parentStack: number[];
    let refParam: string;
    let key: string;
    let check: number;
    let parentAssignment: Assignment[];
    let isIdentifier: boolean;
    for (let i = 0; i < node.s; i++) {
      parentStack = ctx.stack;
      ctx.stack = [];
      refParam = this.serialize(ctx, node.v[i]);
      ctx.stack = parentStack;
      key = node.k[i];
      check = Number(key);
      parentAssignment = ctx.assignments;
      ctx.assignments = mainAssignments;
      // Test if key is a valid number or JS identifier
      // so that we don't have to serialize the key and wrap with brackets
      isIdentifier = check >= 0 || IDENTIFIER_CHECK.test(key);
      if (isIdentifier && Number.isNaN(check)) {
        createObjectAssign(ctx, sourceID, key, refParam);
      } else {
        createArrayAssign(ctx, sourceID, isIdentifier ? key : quote(key), refParam);
      }
      ctx.assignments = parentAssignment;
    }
    ctx.stack.pop();
    return resolveAssignments(mainAssignments);
  }

  static serializeNullConstructor(
    ctx: SerializationContext,
    node: SerovalNullConstructorNode,
  ) {
    let serialized = 'Object.create(null)';
    if (ctx.features & Feature.ObjectAssign) {
      serialized = this.serializeWithObjectAssign(ctx, node.d, node.i, serialized);
    } else {
      markRef(ctx, node.i);
      const assignments = this.serializeAssignments(ctx, node.i, node.d);
      if (assignments) {
        const ref = getRefParam(ctx, node.i);
        return `(${assignRef(ctx, node.i, serialized)},${assignments}${ref})`;
      }
    }
    return assignRef(ctx, node.i, serialized);
  }

  static serializeSet(
    ctx: SerializationContext,
    node: SerovalSetNode,
  ) {
    let serialized = 'new Set';
    const size = node.a.length;
    if (size) {
      let result = '';
      ctx.stack.push(node.i);
      let item: SerovalNode;
      let hasPrev = false;
      for (let i = 0; i < size; i++) {
        item = node.a[i];
        if (isReferenceInStack(ctx, item)) {
          createSetAdd(ctx, node.i, getRefParam(ctx, item.i));
        } else {
          // Push directly
          if (hasPrev) {
            result += ',';
          }
          result += this.serialize(ctx, item);
          hasPrev = true;
        }
      }
      ctx.stack.pop();
      if (result) {
        serialized += `([${result}])`;
      }
    }
    return assignRef(ctx, node.i, serialized);
  }

  static serializeMap(
    ctx: SerializationContext,
    node: SerovalMapNode,
  ) {
    let serialized = 'new Map';
    if (node.d.s) {
      let result = '';
      ctx.stack.push(node.i);
      let key: SerovalNode;
      let val: SerovalNode;
      let keyRef: string;
      let valueRef: string;
      let parent: number[];
      let hasPrev = false;
      for (let i = 0; i < node.d.s; i++) {
        // Check if key is a parent
        key = node.d.k[i];
        val = node.d.v[i];
        if (isReferenceInStack(ctx, key)) {
          // Create reference for the map instance
          keyRef = getRefParam(ctx, key.i);
          // Check if value is a parent
          if (isReferenceInStack(ctx, val)) {
            valueRef = getRefParam(ctx, val.i);
            // Register an assignment since
            // both key and value are a parent of this
            // Map instance
            createMapSet(ctx, node.i, keyRef, valueRef);
          } else {
            // Reset the stack
            // This is required because the serialized
            // value is no longer part of the expression
            // tree and has been moved to the deferred
            // assignment
            parent = ctx.stack;
            ctx.stack = [];
            createMapSet(ctx, node.i, keyRef, this.serialize(ctx, val));
            ctx.stack = parent;
          }
        } else if (isReferenceInStack(ctx, val)) {
          // Create ref for the Map instance
          valueRef = getRefParam(ctx, val.i);
          // Reset stack for the key serialization
          parent = ctx.stack;
          ctx.stack = [];
          createMapSet(ctx, node.i, this.serialize(ctx, key), valueRef);
          ctx.stack = parent;
        } else {
          if (hasPrev) {
            result += ',';
          }
          result += `[${this.serialize(ctx, key)},${this.serialize(ctx, val)}]`;
          hasPrev = true;
        }
      }
      ctx.stack.pop();
      // Check if there are any values
      // so that the empty Map constructor
      // can be used instead
      if (result) {
        serialized += `([${result}])`;
      }
    }
    return assignRef(ctx, node.i, serialized);
  }

  static serializeAggregateError(
    ctx: SerializationContext,
    node: SerovalAggregateErrorNode,
  ) {
    // Serialize the required arguments
    ctx.stack.push(node.i);
    let serialized = `new AggregateError(${this.serialize(ctx, node.n)},${quote(node.m)})`;
    ctx.stack.pop();
    // `AggregateError` might've been extended
    // either through class or custom properties
    // Make sure to assign extra properties
    if (node.d) {
      if (ctx.features & Feature.ObjectAssign) {
        serialized = this.serializeWithObjectAssign(ctx, node.d, node.i, serialized);
      } else {
        markRef(ctx, node.i);
        const assignments = this.serializeAssignments(ctx, node.i, node.d);
        if (assignments) {
          const ref = getRefParam(ctx, node.i);
          return `(${assignRef(ctx, node.i, serialized)},${assignments}${ref})`;
        }
      }
    }
    return assignRef(ctx, node.i, serialized);
  }

  static serializeError(
    ctx: SerializationContext,
    node: SerovalErrorNode,
  ) {
    let serialized = `new ${node.c}(${quote(node.m)})`;
    if (node.d) {
      if (ctx.features & Feature.ObjectAssign) {
        serialized = this.serializeWithObjectAssign(ctx, node.d, node.i, serialized);
      } else {
        markRef(ctx, node.i);
        const assignments = this.serializeAssignments(ctx, node.i, node.d);
        if (assignments) {
          const ref = getRefParam(ctx, node.i);
          return `(${assignRef(ctx, node.i, serialized)},${assignments}${ref})`;
        }
      }
    }
    return assignRef(ctx, node.i, serialized);
  }

  static serializePromise(
    ctx: SerializationContext,
    node: SerovalPromiseNode,
  ) {
    let serialized: string;
    // Check if resolved value is a parent expression
    if (isReferenceInStack(ctx, node.n)) {
      // A Promise trick, reference the value
      // inside the `then` expression so that
      // the Promise evaluates after the parent
      // has initialized
      serialized = `Promise.resolve().then(()=>${getRefParam(ctx, node.n.i)})`;
    } else {
      ctx.stack.push(node.i);
      const result = this.serialize(ctx, node.n);
      ctx.stack.pop();
      // just inline the value/reference here
      serialized = `Promise.resolve(${result})`;
    }
    return assignRef(ctx, node.i, serialized);
  }

  static serializeTypedArray(
    ctx: SerializationContext,
    node: SerovalTypedArrayNode | SerovalBigIntTypedArrayNode,
  ) {
    let args = `[${node.s}]`;
    if (node.l !== 0) {
      args += `,${node.l}`;
    }
    return assignRef(ctx, node.i, `new ${node.c}(${args})`);
  }

  static serializeIterable(
    ctx: SerializationContext,
    node: SerovalIterableNode,
  ) {
    const parent = ctx.stack;
    ctx.stack = [];
    const values = this.serializeNodeList(ctx, node);
    ctx.stack = parent;
    let serialized: string;
    if (ctx.features & Feature.ArrayPrototypeValues) {
      serialized = `${values}.values()`;
    } else {
      serialized = `${values}[Symbol.iterator]()`;
    }
    if (ctx.features & Feature.ArrowFunction) {
      serialized = `{[Symbol.iterator]:()=>${serialized}}`;
    } else if (ctx.features & Feature.MethodShorthand) {
      serialized = `{[Symbol.iterator](){return ${serialized}}}`;
    } else {
      serialized = `{[Symbol.iterator]:function(){return ${serialized}}}`;
    }
    if (node.d) {
      if (ctx.features & Feature.ObjectAssign) {
        serialized = this.serializeWithObjectAssign(ctx, node.d, node.i, serialized);
      } else {
        markRef(ctx, node.i);
        const assignments = this.serializeAssignments(ctx, node.i, node.d);
        if (assignments) {
          const ref = getRefParam(ctx, node.i);
          return `(${assignRef(ctx, node.i, serialized)},${assignments}${ref})`;
        }
      }
    }
    return assignRef(ctx, node.i, serialized);
  }

  static serialize(
    ctx: SerializationContext,
    node: SerovalNode,
  ): string {
    switch (node.t) {
      case SerovalNodeType.Primitive:
        return String(node.s);
      case SerovalNodeType.BigInt:
        return node.s;
      case SerovalNodeType.Reference:
        return getRefParam(ctx, node.i);
      case SerovalNodeType.Array:
        return this.serializeArray(ctx, node);
      case SerovalNodeType.Object:
        return assignRef(ctx, node.i, this.serializeObject(ctx, node.i, node.d));
      case SerovalNodeType.NullConstructor:
        return this.serializeNullConstructor(ctx, node);
      case SerovalNodeType.Date:
        return assignRef(ctx, node.i, `new Date("${node.s}")`);
      case SerovalNodeType.RegExp:
        return assignRef(ctx, node.i, node.s);
      case SerovalNodeType.Set:
        return this.serializeSet(ctx, node);
      case SerovalNodeType.Map:
        return this.serializeMap(ctx, node);
      case SerovalNodeType.BigIntTypedArray:
      case SerovalNodeType.TypedArray:
        return this.serializeTypedArray(ctx, node);
      case SerovalNodeType.AggregateError:
        return this.serializeAggregateError(ctx, node);
      case SerovalNodeType.Error:
        return this.serializeError(ctx, node);
      case SerovalNodeType.Iterable:
        return this.serializeIterable(ctx, node);
      case SerovalNodeType.Promise:
        return this.serializePromise(ctx, node);
      default:
        throw new Error('Unsupported type');
    }
  }
}
