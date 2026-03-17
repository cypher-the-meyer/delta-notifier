/**
 * datetime.js
 * Date & time formatting utilities with UTC-8 (Pacific Standard Time) support.
 * All output strings are UTF-8 encoded.
 */

const UTC_OFFSET_HOURS = -8;

/**
 * Returns the current timestamp adjusted to UTC-8.
 * @returns {Date}
 */
export function nowUTC8() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + UTC_OFFSET_HOURS * 3600000);
}

/**
 * Pads a number to two digits.
 * @param {number} n
 * @returns {string}
 */
function pad(n) {
  return String(n).padStart(2, "0");
}

/**
 * Formats a Date to ISO 8601 with UTC-8 offset.
 * e.g. "2026-03-15T14:30:00-08:00"
 * @param {Date} [date]
 * @returns {string}
 */
export function toISO8601UTC8(date) {
  const d = date ? new Date(date.getTime()) : nowUTC8();
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${y}-${mo}-${day}T${h}:${mi}:${s}-08:00`;
}

/**
 * Formats a Date to a human-readable string in UTC-8.
 * e.g. "Sun, Mar 15 2026 02:30 PM PST"
 * @param {Date} [date]
 * @returns {string}
 */
export function toReadableUTC8(date) {
  const d = date ? new Date(date.getTime()) : nowUTC8();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const dow = days[d.getDay()];
  const mon = months[d.getMonth()];
  const day = pad(d.getDate());
  const yr = d.getFullYear();
  const rawH = d.getHours();
  const ampm = rawH < 12 ? "AM" : "PM";
  const h12 = pad(rawH % 12 === 0 ? 12 : rawH % 12);
  const mi = pad(d.getMinutes());
  return `${dow}, ${mon} ${day} ${yr} ${h12}:${mi} ${ampm} PST`;
}

/**
 * Returns Unix epoch milliseconds for a UTC-8 date.
 * @param {Date} [date]
 * @returns {number}
 */
export function toEpochMs(date) {
  return (date || nowUTC8()).getTime();
}

/**
 * Formats a duration in milliseconds to a human-readable string.
 * e.g. 90061000 → "1d 01h 01m 01s"
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  parts.push(`${pad(h)}h`, `${pad(m)}m`, `${pad(s)}s`);
  return parts.join(" ");
}

/**
 * Returns a UTC-8 timestamp string suitable for webhook payloads.
 * Encodes the result as a UTF-8-safe string (no characters outside BMP).
 * @returns {string}
 */
export function webhookTimestamp() {
  return toISO8601UTC8(nowUTC8());
}

/**
 * Parses an ISO 8601 string and converts it to UTC-8 Date.
 * @param {string} isoString
 * @returns {Date}
 */
export function parseToUTC8(isoString) {
  const utcDate = new Date(isoString);
  if (isNaN(utcDate.getTime())) {
    throw new Error(`Invalid date string: "${isoString}"`);
  }
  const utcMs = utcDate.getTime() + utcDate.getTimezoneOffset() * 60000;
  return new Date(utcMs + UTC_OFFSET_HOURS * 3600000);
}

/**
 * Returns an object with all datetime components in UTC-8.
 * @param {Date} [date]
 * @returns {{ year, month, day, hour, minute, second, offset }}
 */
export function getComponents(date) {
  const d = date ? new Date(date.getTime()) : nowUTC8();
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
    offset: "UTC-8",
  };
}
