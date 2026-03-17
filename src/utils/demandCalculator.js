/**
 * demandCalculator.js
 * Predictive model demand calculator based on traffic lists.
 *
 * Pipeline:
 *   1. Ingest raw traffic list (requests / events per time slot)
 *   2. Clean & normalise via arrayProcessing utilities
 *   3. Compute trend via linear regression
 *   4. Apply moving-average smoothing
 *   5. Project future demand for N periods ahead
 *   6. Classify demand tier (low / medium / high / critical)
 */

import {
  sumAll,
  mean,
  movingAverage,
  normalise,
  cumulativeSum,
  traverseRange,
} from "./arrayProcessing.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEMAND_TIERS = [
  { label: "low",      min: 0,    max: 0.33 },
  { label: "medium",   min: 0.33, max: 0.66 },
  { label: "high",     min: 0.66, max: 0.85 },
  { label: "critical", min: 0.85, max: Infinity },
];

const DEFAULT_WINDOW = 5;    // moving-average window
const DEFAULT_HORIZON = 6;   // periods to forecast

// ---------------------------------------------------------------------------
// Linear regression (least squares)
// ---------------------------------------------------------------------------

/**
 * Fits a simple linear regression y = a + b*x over the array.
 * @param {number[]} arr
 * @returns {{ slope: number, intercept: number, r2: number }}
 */
export function linearRegression(arr) {
  const n = arr.length;
  if (n < 2) return { slope: 0, intercept: arr[0] ?? 0, r2: 0 };

  const xs = arr.map((_, i) => i);
  const xMean = mean(xs);
  const yMean = mean(arr);

  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    const dy = arr[i] - yMean;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }

  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = yMean - slope * xMean;
  const r2 = ssYY === 0 ? 1 : (ssXY * ssXY) / (ssXX * ssYY);

  return { slope, intercept, r2 };
}

// ---------------------------------------------------------------------------
// Demand tier classification
// ---------------------------------------------------------------------------

/**
 * Classifies a normalised demand value [0, 1] into a tier label.
 * @param {number} normValue
 * @returns {string}
 */
export function classifyDemand(normValue) {
  const tier = DEMAND_TIERS.find((t) => normValue >= t.min && normValue < t.max);
  return tier ? tier.label : "critical";
}

// ---------------------------------------------------------------------------
// Core demand model
// ---------------------------------------------------------------------------

/**
 * Calculates demand metrics and a multi-step forecast from a traffic list.
 *
 * @param {number[]} trafficList  Raw traffic counts (ordered oldest→newest)
 * @param {Object}  [options]
 * @param {number}  [options.window=5]    Moving-average window size
 * @param {number}  [options.horizon=6]   Periods ahead to forecast
 * @param {number}  [options.rangeB]      Optional range(b) for traversal filter
 * @returns {DemandReport}
 */
export function calculateDemand(trafficList, options = {}) {
  if (!Array.isArray(trafficList) || trafficList.length === 0) {
    throw new Error("trafficList must be a non-empty array of numbers");
  }

  const window = options.window ?? DEFAULT_WINDOW;
  const horizon = options.horizon ?? DEFAULT_HORIZON;

  // Optional range-filtered subset using traverseRange logic
  const rangeB = options.rangeB ?? trafficList.length;
  const filtered = traverseRange(trafficList, rangeB);
  const working = filtered.length > 0 ? filtered : trafficList;

  // Smoothed series
  const smoothed = movingAverage(working, window);

  // Normalised [0, 1]
  const normed = normalise(smoothed);

  // Regression on smoothed data
  const { slope, intercept, r2 } = linearRegression(smoothed);

  // Forecast: extend the regression line forward `horizon` periods
  const lastIdx = working.length - 1;
  const forecast = Array.from({ length: horizon }, (_, h) => {
    const raw = intercept + slope * (lastIdx + 1 + h);
    return Math.max(0, raw); // demand can't be negative
  });

  const forecastNormed = normalise([...smoothed, ...forecast]).slice(smoothed.length);

  // Current demand (last smoothed value)
  const currentNorm = normed[normed.length - 1] ?? 0;
  const currentTier = classifyDemand(currentNorm);

  // Peak detection within working set
  const peakValue = Math.max(...working);
  const peakIndex = working.indexOf(peakValue);

  // Cumulative load
  const totalLoad = sumAll(working);
  const avgLoad = mean(working);

  return {
    // Raw inputs
    inputLength: trafficList.length,
    workingLength: working.length,

    // Descriptive stats
    totalLoad,
    avgLoad,
    peakValue,
    peakIndex,

    // Trend
    trend: { slope, intercept, r2 },
    trendDirection: slope > 0.01 ? "rising" : slope < -0.01 ? "falling" : "stable",

    // Smoothed history
    smoothed,
    smoothedNormed: normed,
    cumulativeLoad: cumulativeSum(working),

    // Current state
    currentDemandNorm: currentNorm,
    currentTier,

    // Forecast
    forecast,
    forecastNormed,
    forecastTiers: forecastNormed.map(classifyDemand),

    // Model confidence
    r2,
    confidence: r2 >= 0.8 ? "high" : r2 >= 0.5 ? "medium" : "low",
  };
}

// ---------------------------------------------------------------------------
// Traffic list builder helpers
// ---------------------------------------------------------------------------

/**
 * Aggregates raw event timestamps into per-slot traffic counts.
 * @param {number[]} timestamps   Unix ms values
 * @param {number}   slotMs       Slot duration in milliseconds (default 1 min)
 * @returns {{ slots: number[], startMs: number, slotMs: number }}
 */
export function aggregateTraffic(timestamps, slotMs = 60000) {
  if (timestamps.length === 0) return { slots: [], startMs: 0, slotMs };
  const startMs = Math.min(...timestamps);
  const endMs = Math.max(...timestamps);
  const numSlots = Math.ceil((endMs - startMs) / slotMs) + 1;
  const slots = new Array(numSlots).fill(0);
  for (const ts of timestamps) {
    const idx = Math.floor((ts - startMs) / slotMs);
    slots[idx]++;
  }
  return { slots, startMs, slotMs };
}

/**
 * Merges multiple traffic lists by summing per-slot values.
 * All lists must have the same length.
 * @param {number[][]} lists
 * @returns {number[]}
 */
export function mergeTrafficLists(lists) {
  if (lists.length === 0) return [];
  const len = lists[0].length;
  return Array.from({ length: len }, (_, i) =>
    sumAll(lists.map((list) => list[i] ?? 0))
  );
}

/**
 * Returns a demand summary string suitable for a webhook text notification.
 * @param {ReturnType<calculateDemand>} report
 * @returns {string}
 */
export function formatDemandSummary(report) {
  const pct = (report.currentDemandNorm * 100).toFixed(1);
  const nextTier = report.forecastTiers[0] ?? report.currentTier;
  return (
    `*Demand Report* | Tier: *${report.currentTier.toUpperCase()}* (${pct}%)` +
    ` | Trend: ${report.trendDirection}` +
    ` | Next period: ${nextTier}` +
    ` | Confidence: ${report.confidence}` +
    ` | Peak: ${report.peakValue} @ slot ${report.peakIndex}`
  );
}
