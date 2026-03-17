/**
 * NotificationController.jsx
 * React controller component for the Delta Notifier dashboard.
 *
 * Responsibilities:
 *   - Select payload type
 *   - Fill required fields dynamically
 *   - Send notification to Google Chat webhook
 *   - Feed dispatch results into traffic list for demand model
 *   - Pass state down to AnalyticsDashboard
 */

import React, { useState, useCallback, useRef } from "react";
import { dispatch, listTypes, requiredFields } from "../utils/payloadProcessor.js";
import { toReadableUTC8 } from "../utils/datetime.js";
import { calculateDemand, formatDemandSummary } from "../utils/demandCalculator.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAYLOAD_TYPES = listTypes();

const FIELD_LABELS = {
  message: "Message",
  title: "Title",
  subtitle: "Subtitle",
  headerImageUrl: "Header Image URL",
  sectionHeader: "Section Header",
  labelKey: "Label Key",
  labelValue: "Label Value",
  bodyText: "Body Text",
  primaryButtonLabel: "Primary Button Label",
  primaryButtonUrl: "Primary Button URL",
  secondaryButtonLabel: "Secondary Button Label",
  secondaryButtonUrl: "Secondary Button URL",
  imageUrl: "Image URL",
  imageLinkUrl: "Image Link URL",
  caption: "Caption",
  threadName: "Thread Name (spaces/threads/{threadId})",
};

const DEFAULT_FIELDS = {
  message: "Delta Notifier alert",
  title: "Delta Alert",
  subtitle: "Automated notification",
  headerImageUrl: "",
  sectionHeader: "Details",
  labelKey: "Status",
  labelValue: "Active",
  bodyText: "Please review the latest update.",
  primaryButtonLabel: "View",
  primaryButtonUrl: "https://example.com",
  secondaryButtonLabel: "Dismiss",
  secondaryButtonUrl: "https://example.com/dismiss",
  imageUrl: "https://example.com/image.png",
  imageLinkUrl: "https://example.com",
  caption: "Notification image",
  threadName: "spaces/AAAA/threads/BBB",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NotificationController({ onTrafficUpdate, onDemandUpdate }) {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [payloadType, setPayloadType] = useState("text");
  const [fields, setFields] = useState({ ...DEFAULT_FIELDS });
  const [sending, setSending] = useState(false);
  const [log, setLog] = useState([]);
  const trafficRef = useRef([]);
  const logEndRef = useRef(null);

  // Derive required fields for the selected payload type
  const required = requiredFields(payloadType);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleFieldChange = useCallback((key, value) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  }, []);

  const appendLog = useCallback((entry) => {
    setLog((prev) => {
      const updated = [...prev, entry];
      return updated.slice(-100); // keep last 100 entries
    });
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const handleSend = useCallback(async () => {
    if (!webhookUrl.trim()) {
      appendLog({ type: "error", time: toReadableUTC8(), message: "Webhook URL is required." });
      return;
    }

    setSending(true);
    const ts = Date.now();

    try {
      const result = await dispatch(webhookUrl, payloadType, fields);

      // Record traffic tick
      trafficRef.current = [...trafficRef.current, ts];

      // Compute demand from traffic timestamps (per-minute slots)
      const slotMs = 60000;
      const allTs = trafficRef.current;
      if (allTs.length > 0) {
        const startMs = allTs[0];
        const numSlots = Math.ceil((Date.now() - startMs) / slotMs) + 1;
        const slots = new Array(numSlots).fill(0);
        allTs.forEach((t) => {
          const idx = Math.floor((t - startMs) / slotMs);
          if (slots[idx] !== undefined) slots[idx]++;
        });
        const validSlots = slots.filter((v) => typeof v === "number");
        if (validSlots.length >= 2) {
          const report = calculateDemand(validSlots);
          onDemandUpdate?.(report);
          onTrafficUpdate?.(validSlots);
        }
      }

      appendLog({
        type: result.ok ? "success" : "warn",
        time: toReadableUTC8(),
        message: result.ok
          ? `Sent [${payloadType}] — HTTP ${result.status}`
          : `Webhook returned HTTP ${result.status}`,
        meta: result.meta,
      });
    } catch (err) {
      appendLog({ type: "error", time: toReadableUTC8(), message: err.message });
    } finally {
      setSending(false);
    }
  }, [webhookUrl, payloadType, fields, appendLog, onDemandUpdate, onTrafficUpdate]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Notification Controller</h2>

      {/* Webhook URL */}
      <section style={styles.section}>
        <label style={styles.label}>Google Chat Webhook URL</label>
        <input
          style={styles.input}
          type="url"
          placeholder="https://chat.googleapis.com/v1/spaces/..."
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
        />
      </section>

      {/* Payload type selector */}
      <section style={styles.section}>
        <label style={styles.label}>Payload Type</label>
        <div style={styles.typeGrid}>
          {PAYLOAD_TYPES.map((t) => (
            <button
              key={t}
              style={t === payloadType ? styles.typeButtonActive : styles.typeButton}
              onClick={() => setPayloadType(t)}
            >
              {t.replace("_", " ")}
            </button>
          ))}
        </div>
      </section>

      {/* Dynamic field inputs */}
      <section style={styles.section}>
        <label style={styles.label}>Payload Fields</label>
        {required.map((key) => (
          <div key={key} style={styles.fieldRow}>
            <label style={styles.fieldLabel}>{FIELD_LABELS[key] ?? key}</label>
            {key === "bodyText" || key === "message" ? (
              <textarea
                style={styles.textarea}
                rows={3}
                value={fields[key] ?? ""}
                onChange={(e) => handleFieldChange(key, e.target.value)}
              />
            ) : (
              <input
                style={styles.input}
                type="text"
                value={fields[key] ?? ""}
                onChange={(e) => handleFieldChange(key, e.target.value)}
              />
            )}
          </div>
        ))}
      </section>

      {/* Send button */}
      <button
        style={sending ? styles.sendButtonDisabled : styles.sendButton}
        onClick={handleSend}
        disabled={sending}
      >
        {sending ? "Sending..." : "Send Notification"}
      </button>

      {/* Dispatch log */}
      <section style={styles.section}>
        <label style={styles.label}>Dispatch Log</label>
        <div style={styles.logBox}>
          {log.length === 0 && (
            <span style={styles.logEmpty}>No dispatches yet.</span>
          )}
          {log.map((entry, i) => (
            <div key={i} style={{ ...styles.logEntry, ...logTypeStyle(entry.type) }}>
              <span style={styles.logTime}>{entry.time}</span>
              <span style={styles.logMsg}>{entry.message}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function logTypeStyle(type) {
  const map = {
    success: { borderLeft: "3px solid #22c55e" },
    warn:    { borderLeft: "3px solid #f59e0b" },
    error:   { borderLeft: "3px solid #ef4444" },
  };
  return map[type] ?? {};
}

const styles = {
  container: {
    fontFamily: "'Inter', sans-serif",
    background: "#0f172a",
    color: "#e2e8f0",
    padding: "24px",
    borderRadius: "12px",
    maxWidth: "640px",
    width: "100%",
  },
  heading: {
    fontSize: "1.25rem",
    fontWeight: 700,
    marginBottom: "20px",
    color: "#f8fafc",
  },
  section: { marginBottom: "20px" },
  label: {
    display: "block",
    fontSize: "0.75rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#94a3b8",
    marginBottom: "8px",
  },
  input: {
    width: "100%",
    padding: "8px 12px",
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "6px",
    color: "#f1f5f9",
    fontSize: "0.875rem",
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    padding: "8px 12px",
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "6px",
    color: "#f1f5f9",
    fontSize: "0.875rem",
    resize: "vertical",
    boxSizing: "border-box",
  },
  typeGrid: { display: "flex", gap: "8px", flexWrap: "wrap" },
  typeButton: {
    padding: "6px 14px",
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "20px",
    color: "#94a3b8",
    cursor: "pointer",
    fontSize: "0.8rem",
    textTransform: "capitalize",
  },
  typeButtonActive: {
    padding: "6px 14px",
    background: "#6366f1",
    border: "1px solid #6366f1",
    borderRadius: "20px",
    color: "#fff",
    cursor: "pointer",
    fontSize: "0.8rem",
    textTransform: "capitalize",
  },
  fieldRow: { marginBottom: "12px" },
  fieldLabel: {
    display: "block",
    fontSize: "0.78rem",
    color: "#64748b",
    marginBottom: "4px",
  },
  sendButton: {
    width: "100%",
    padding: "12px",
    background: "#6366f1",
    border: "none",
    borderRadius: "8px",
    color: "#fff",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: "20px",
  },
  sendButtonDisabled: {
    width: "100%",
    padding: "12px",
    background: "#4338ca",
    border: "none",
    borderRadius: "8px",
    color: "#a5b4fc",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "not-allowed",
    marginBottom: "20px",
  },
  logBox: {
    background: "#0a0f1e",
    border: "1px solid #1e293b",
    borderRadius: "8px",
    padding: "12px",
    maxHeight: "220px",
    overflowY: "auto",
    fontSize: "0.78rem",
  },
  logEmpty: { color: "#475569" },
  logEntry: {
    padding: "4px 8px",
    marginBottom: "4px",
    borderRadius: "4px",
    display: "flex",
    gap: "12px",
  },
  logTime: { color: "#475569", whiteSpace: "nowrap" },
  logMsg:  { color: "#cbd5e1" },
};
