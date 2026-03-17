/**
 * AnalyticsDashboard.jsx
 * Analytics view for the Delta Notifier webhook dashboard.
 *
 * Displays:
 *   - Live traffic sparkline (SVG bar chart)
 *   - Demand tier badge with animated indicator
 *   - Trend direction & model confidence
 *   - Forecast bars for the next N periods
 *   - Key stats: total load, peak, avg, cumulative
 */

import React, { useMemo } from "react";
import { toReadableUTC8 } from "../utils/datetime.js";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Minimal inline SVG bar chart */
function BarChart({ data = [], height = 80, color = "#6366f1", forecastCount = 0 }) {
  if (data.length === 0) return <EmptyChart height={height} />;

  const max = Math.max(...data, 1);
  const barW = Math.max(4, Math.floor(460 / data.length) - 2);
  const gap = 2;
  const totalW = data.length * (barW + gap);

  return (
    <svg
      viewBox={`0 0 ${totalW} ${height}`}
      style={{ width: "100%", height, display: "block" }}
      preserveAspectRatio="none"
    >
      {data.map((v, i) => {
        const barH = Math.max(2, (v / max) * (height - 4));
        const x = i * (barW + gap);
        const y = height - barH;
        const isForecast = i >= data.length - forecastCount;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={barH}
            rx={2}
            fill={isForecast ? "#f59e0b" : color}
            opacity={isForecast ? 0.7 : 1}
          />
        );
      })}
    </svg>
  );
}

function EmptyChart({ height }) {
  return (
    <div
      style={{
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#334155",
        fontSize: "0.78rem",
      }}
    >
      No traffic data yet
    </div>
  );
}

/** Demand tier badge */
function TierBadge({ tier }) {
  const colors = {
    low:      { bg: "#14532d", text: "#86efac", dot: "#22c55e" },
    medium:   { bg: "#713f12", text: "#fde68a", dot: "#f59e0b" },
    high:     { bg: "#7f1d1d", text: "#fca5a5", dot: "#ef4444" },
    critical: { bg: "#581c87", text: "#e879f9", dot: "#d946ef" },
  };
  const c = colors[tier] ?? colors.low;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c.bg, borderRadius: 20, padding: "4px 12px" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot, display: "inline-block" }} />
      <span style={{ color: c.text, fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase" }}>{tier}</span>
    </div>
  );
}

/** Single stat card */
function StatCard({ label, value, sub }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
      {sub && <div style={styles.statSub}>{sub}</div>}
    </div>
  );
}

/** Trend arrow */
function TrendArrow({ direction }) {
  const map = {
    rising:  { icon: "↑", color: "#ef4444" },
    falling: { icon: "↓", color: "#22c55e" },
    stable:  { icon: "→", color: "#94a3b8" },
  };
  const { icon, color } = map[direction] ?? map.stable;
  return <span style={{ color, fontWeight: 700, fontSize: "1.1rem" }}>{icon}</span>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * @param {{ trafficList: number[], demandReport: object|null }} props
 */
export default function AnalyticsDashboard({ trafficList = [], demandReport = null }) {
  const now = toReadableUTC8();

  // Combine actual + forecast bars for unified chart
  const chartData = useMemo(() => {
    if (!demandReport) return trafficList;
    return [...(demandReport.smoothed ?? trafficList), ...demandReport.forecast];
  }, [trafficList, demandReport]);

  const forecastCount = demandReport?.forecast?.length ?? 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.heading}>Analytics Dashboard</h2>
        <span style={styles.timestamp}>{now}</span>
      </div>

      {/* Traffic + forecast chart */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>Traffic &amp; Forecast</span>
          {forecastCount > 0 && (
            <span style={styles.legendForecast}>■ forecast ({forecastCount} periods)</span>
          )}
        </div>
        <div style={styles.chartBox}>
          <BarChart data={chartData} height={100} forecastCount={forecastCount} />
        </div>
      </section>

      {/* Current demand state */}
      {demandReport ? (
        <>
          <section style={styles.section}>
            <span style={styles.sectionTitle}>Current Demand</span>
            <div style={styles.demandRow}>
              <TierBadge tier={demandReport.currentTier} />
              <span style={styles.normValue}>
                {(demandReport.currentDemandNorm * 100).toFixed(1)}%
              </span>
              <TrendArrow direction={demandReport.trendDirection} />
              <span style={styles.trendLabel}>{demandReport.trendDirection}</span>
            </div>
          </section>

          {/* Forecast tiers */}
          <section style={styles.section}>
            <span style={styles.sectionTitle}>Upcoming Forecast Tiers</span>
            <div style={styles.forecastRow}>
              {demandReport.forecastTiers.map((tier, i) => (
                <div key={i} style={styles.forecastCell}>
                  <div style={styles.forecastIdx}>+{i + 1}</div>
                  <TierBadge tier={tier} />
                </div>
              ))}
            </div>
          </section>

          {/* Stats grid */}
          <section style={styles.section}>
            <span style={styles.sectionTitle}>Statistics</span>
            <div style={styles.statsGrid}>
              <StatCard
                label="Total Load"
                value={demandReport.totalLoad.toLocaleString()}
                sub="cumulative requests"
              />
              <StatCard
                label="Avg / Slot"
                value={demandReport.avgLoad.toFixed(2)}
                sub="moving average"
              />
              <StatCard
                label="Peak"
                value={demandReport.peakValue.toLocaleString()}
                sub={`slot #${demandReport.peakIndex}`}
              />
              <StatCard
                label="Model R²"
                value={demandReport.r2.toFixed(3)}
                sub={`confidence: ${demandReport.confidence}`}
              />
              <StatCard
                label="Slope"
                value={demandReport.trend.slope.toFixed(4)}
                sub="req / period"
              />
              <StatCard
                label="Data Points"
                value={demandReport.workingLength}
                sub={`of ${demandReport.inputLength} total`}
              />
            </div>
          </section>
        </>
      ) : (
        <div style={styles.emptyState}>
          Send a notification to start collecting traffic data and generate demand predictions.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  container: {
    fontFamily: "'Inter', sans-serif",
    background: "#0f172a",
    color: "#e2e8f0",
    padding: "24px",
    borderRadius: "12px",
    width: "100%",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "20px",
  },
  heading: {
    fontSize: "1.25rem",
    fontWeight: 700,
    color: "#f8fafc",
    margin: 0,
  },
  timestamp: {
    fontSize: "0.72rem",
    color: "#475569",
  },
  section: { marginBottom: "24px" },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "8px",
  },
  sectionTitle: {
    display: "block",
    fontSize: "0.72rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "#64748b",
    marginBottom: "8px",
  },
  legendForecast: {
    fontSize: "0.7rem",
    color: "#f59e0b",
  },
  chartBox: {
    background: "#0a0f1e",
    border: "1px solid #1e293b",
    borderRadius: "8px",
    padding: "12px",
    overflow: "hidden",
  },
  demandRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginTop: "8px",
  },
  normValue: {
    fontSize: "1.6rem",
    fontWeight: 700,
    color: "#f1f5f9",
  },
  trendLabel: {
    fontSize: "0.85rem",
    color: "#94a3b8",
    textTransform: "capitalize",
  },
  forecastRow: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    marginTop: "6px",
  },
  forecastCell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
  },
  forecastIdx: {
    fontSize: "0.68rem",
    color: "#475569",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "10px",
    marginTop: "8px",
  },
  statCard: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "8px",
    padding: "12px",
  },
  statLabel: {
    fontSize: "0.68rem",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: "4px",
  },
  statValue: {
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "#f1f5f9",
  },
  statSub: {
    fontSize: "0.68rem",
    color: "#475569",
    marginTop: "2px",
  },
  emptyState: {
    textAlign: "center",
    color: "#475569",
    fontSize: "0.85rem",
    padding: "40px 0",
    borderTop: "1px solid #1e293b",
  },
};
