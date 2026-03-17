/**
 * App.jsx
 * Root application — wires NotificationController and AnalyticsDashboard together.
 */

import React, { useState } from "react";
import NotificationController from "./components/NotificationController.jsx";
import AnalyticsDashboard from "./components/AnalyticsDashboard.jsx";

export default function App() {
  const [trafficList, setTrafficList] = useState([]);
  const [demandReport, setDemandReport] = useState(null);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.logo}>⬡ Delta Notifier</h1>
        <span style={styles.sub}>Google Chat Webhook Dashboard</span>
      </header>

      <main style={styles.main}>
        <NotificationController
          onTrafficUpdate={setTrafficList}
          onDemandUpdate={setDemandReport}
        />
        <AnalyticsDashboard
          trafficList={trafficList}
          demandReport={demandReport}
        />
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#020817",
    color: "#e2e8f0",
    fontFamily: "'Inter', sans-serif",
  },
  header: {
    padding: "20px 32px",
    borderBottom: "1px solid #1e293b",
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  logo: {
    margin: 0,
    fontSize: "1.4rem",
    fontWeight: 800,
    color: "#818cf8",
  },
  sub: {
    fontSize: "0.85rem",
    color: "#475569",
  },
  main: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "24px",
    padding: "32px",
    maxWidth: "1400px",
    margin: "0 auto",
  },
};
