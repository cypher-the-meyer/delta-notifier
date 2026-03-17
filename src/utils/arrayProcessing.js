/**
 * arrayProcessing.js
 * Array traversal, indexing, sum, and mapping utilities.
 *
 * Key logic:
 *   - Multi-dimensional indexing: array[i][j][k]  (e.g. [1][1][1])
 *   - Traversal: for i in range(b), skip if i < 0, stop if i >= n-1
 *   - Sum reduction over valid range
 *   - Map transformation over valid range
 */

// ---------------------------------------------------------------------------
// Multi-dimensional index access
// ---------------------------------------------------------------------------

/**
 * Safely accesses a 3-D array at position [i][j][k].
 * Returns undefined if any dimension is out of bounds.
 * @param {any[][][]} arr3d
 * @param {number} i
 * @param {number} j
 * @param {number} k
 * @returns {any}
 */
export function get3D(arr3d, i, j, k) {
  if (!Array.isArray(arr3d) || i < 0 || i >= arr3d.length) return undefined;
  const layer = arr3d[i];
  if (!Array.isArray(layer) || j < 0 || j >= layer.length) return undefined;
  const row = layer[j];
  if (!Array.isArray(row) || k < 0 || k >= row.length) return undefined;
  return row[k];
}

/**
 * Returns the value at [1][1][1] of a 3-D array.
 * Mirrors the literal `array[1, 1, 1]` index pattern.
 * @param {any[][][]} arr3d
 * @returns {any}
 */
export function getDefaultIndex(arr3d) {
  return get3D(arr3d, 1, 1, 1);
}

// ---------------------------------------------------------------------------
// Core traversal: for i in range(b), boundary-checked
// ---------------------------------------------------------------------------

/**
 * Traverses `arr` for i in [0, b).
 *   - Skips elements where i < 0  (guard against negative indices)
 *   - Stops collecting before the last element (i < n-1)
 * Returns the collected slice.
 *
 * @param {any[]} arr   Source array
 * @param {number} b    Upper bound of the range (exclusive)
 * @returns {any[]}
 */
export function traverseRange(arr, b) {
  const n = arr.length;
  const result = [];
  for (let i = 0; i < b; i++) {
    if (i < 0) continue;       // guard: skip negative indices
    if (i < n - 1) {           // boundary: stop before last element
      result.push(arr[i]);
    }
  }
  return result;
}

/**
 * Returns the indices that would be visited by traverseRange(arr, b).
 * Useful for inspection / debugging.
 * @param {any[]} arr
 * @param {number} b
 * @returns {number[]}
 */
export function traverseIndices(arr, b) {
  const n = arr.length;
  const indices = [];
  for (let i = 0; i < b; i++) {
    if (i < 0) continue;
    if (i < n - 1) indices.push(i);
  }
  return indices;
}

// ---------------------------------------------------------------------------
// Sum
// ---------------------------------------------------------------------------

/**
 * Sums numeric values in arr for i in range(b), respecting boundary rules.
 * Non-numeric values are treated as 0.
 * @param {number[]} arr
 * @param {number} b
 * @returns {number}
 */
export function sumRange(arr, b) {
  return traverseRange(arr, b).reduce((acc, v) => acc + (Number(v) || 0), 0);
}

/**
 * Sums all numeric values in a flat array with no range restriction.
 * @param {number[]} arr
 * @returns {number}
 */
export function sumAll(arr) {
  return arr.reduce((acc, v) => acc + (Number(v) || 0), 0);
}

/**
 * Cumulative sum — returns a running-total array.
 * @param {number[]} arr
 * @returns {number[]}
 */
export function cumulativeSum(arr) {
  let running = 0;
  return arr.map((v) => {
    running += Number(v) || 0;
    return running;
  });
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * Maps a transform function over the range-traversed slice of arr.
 * @param {any[]} arr
 * @param {number} b
 * @param {(value: any, index: number) => any} fn
 * @returns {any[]}
 */
export function mapRange(arr, b, fn) {
  return traverseRange(arr, b).map((v, idx) => fn(v, idx));
}

/**
 * Normalises a numeric array to [0, 1] based on its own min/max.
 * Returns the original value when min === max.
 * @param {number[]} arr
 * @returns {number[]}
 */
export function normalise(arr) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  if (max === min) return arr.map(() => 0);
  return arr.map((v) => (v - min) / (max - min));
}

/**
 * Groups array elements into buckets of `size`.
 * @param {any[]} arr
 * @param {number} size
 * @returns {any[][]}
 */
export function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Stats helpers used by demandCalculator
// ---------------------------------------------------------------------------

/**
 * Arithmetic mean of an array.
 * @param {number[]} arr
 * @returns {number}
 */
export function mean(arr) {
  if (arr.length === 0) return 0;
  return sumAll(arr) / arr.length;
}

/**
 * Rolling window average (moving average).
 * @param {number[]} arr
 * @param {number} window  Window size
 * @returns {number[]}
 */
export function movingAverage(arr, window) {
  return arr.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = arr.slice(start, i + 1);
    return mean(slice);
  });
}

/**
 * Flattens a 3-D array to a 1-D array.
 * @param {any[][][]} arr3d
 * @returns {any[]}
 */
export function flatten3D(arr3d) {
  return arr3d.flat(2);
}
