/**
 * Typed React Query key factory.
 *
 * The codebase previously had ~13 hand-rolled `*Keys` objects, each declaring
 * a list of method-shaped tuples (`all`, `byDate(date)`, etc.). They were
 * loosely typed (most declared `as const`, but call sites could still pass
 * `undefined` to a key that required a string), and the only invariant
 * linking them was a `all` root tuple that consumers had to remember.
 *
 * `createQueryKeys` collapses that into a single declarative shape:
 *
 *   export const salesKeys = createQueryKeys('sales', {
 *     all:    null,                            // → ['sales']
 *     byDate: (date: string) => ({ date }),    // → ['sales', { date }]
 *   });
 *
 * Two wins:
 *   1. **Typing.**  `salesKeys.byDate(123)` is a compile error; the argument
 *      shape is driven by the function you declared.
 *   2. **Hierarchical invalidation.**  `salesKeys.all` is always the parent
 *      prefix, and `queryClient.invalidateQueries({ queryKey: salesKeys.all })`
 *      matches every entry in this namespace. We use the root tuple as the
 *      prefix, so the React Query `queryKeyHash` matches all `sales.*` keys.
 *
 * This is a refactor-only helper; the produced keys are still plain tuples,
 * so React Query consumers can be migrated gradually.
 */

/**
 * The shape a single key entry can take in `createQueryKeys`:
 *   * `null`         → bare-root key, `['<root>']`
 *   * `string`       → tagged sub-key, `['<root>', '<tag>']`
 *   * `(args) => …`  → callable that returns the tail tuple
 */
export type QueryKeyEntry =
  | null
  | string
  | ((...args: any[]) => any);

/**
 * The shape of a factory entry — `T[K]` of the user-provided record.
 * A `QueryKeyEntry` is the runtime contract; we accept anything TS will
 * accept (including `(date: string) => { date }`).
 */
export type QueryKeyFactoryInput = Record<string, QueryKeyEntry>;

/**
 * The output type: each key either resolves to a tuple (for `null` /
 * `string` entries) or stays a function (for function entries).
 */
export type QueryKeyFactory<T extends QueryKeyFactoryInput> = {
  readonly [K in keyof T]: T[K] extends null
    ? readonly [root: string]
    : T[K] extends string
      ? readonly [root: string, name: T[K]]
      : T[K] extends (...args: infer A) => unknown
        ? (...args: A) => readonly [root: string, tail: unknown]
        : never;
};

/**
 * Build a typed queryKey factory.
 *
 * @param root   The root tuple, conventionally the feature name (`'sales'`,
 *               `'mess-settings'`). This is the prefix that
 *               `invalidateQueries({ queryKey: keys.all })` matches against.
 * @param shape  An object whose values describe each sub-key. `null` denotes
 *               the bare-root key. A string value becomes a static `name`
 *               tag. A function value receives the arguments at call time
 *               and its return value is appended to the root tuple verbatim.
 */
export function createQueryKeys<T extends QueryKeyFactoryInput>(
  root: string,
  shape: T
): QueryKeyFactory<T> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape) as Array<keyof T>) {
    const entry = shape[key];
    if (entry === null) {
      out[key as string] = [root] as const;
    } else if (typeof entry === 'string') {
      out[key as string] = [root, entry] as const;
    } else if (typeof entry === 'function') {
      out[key as string] = (...args: unknown[]) => {
        const tail = (entry as (...a: unknown[]) => unknown).apply(null, args);
        return [root, tail] as const;
      };
    } else {
      throw new Error(
        `createQueryKeys: shape[${String(key)}] must be null, a string, or a function — got ${typeof entry}`
      );
    }
  }
  return out as QueryKeyFactory<T>;
}
