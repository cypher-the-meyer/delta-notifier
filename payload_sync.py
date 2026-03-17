"""
payload_sync.py
===============
Bridge between the Google Cloud watchers and the payload dispatch pipeline.

Called by watcher.py whenever Drive or GCS reports a file change.
Responsibilities:
  - Detect payload type from filename
  - Validate and merge new content into the local payloads/ cache
  - Build and POST the notification to Google Chat webhook
  - Log the event with UTC-8 timestamp
"""

import json
import logging
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

log = logging.getLogger("payload-sync")

# UTC-8 timestamp helper (no external dependency)
UTC8 = timezone(timedelta(hours=-8))
def _now():
    return datetime.now(UTC8).strftime("%Y-%m-%dT%H:%M:%S-08:00")

# Local payloads cache directory
PAYLOADS_DIR = Path("./payloads")

# Map filename keywords → Google Chat payload type
FILENAME_TYPE_MAP = {
    "text":         "text",
    "card":         "card",
    "button":       "button_card",
    "image":        "image_card",
    "thread":       "thread",
}

# ---------------------------------------------------------------------------
# Payload builder  (pure Python — no JS runtime required)
# ---------------------------------------------------------------------------

def _build_text_body(content: dict, event: str, source: str, name: str) -> dict:
    """Builds a Google Chat text payload from the change event."""
    icon = {"update": "🔄", "remove": "🗑️"}.get(event, "📋")
    title = content.get("title", name)
    body  = content.get("text") or content.get("bodyText") or content.get("raw", "")
    ts    = _now()

    return {
        "text": (
            f"{icon} *[Delta Notifier]* `{source.upper()}` change detected\n"
            f"*File:* `{name}`\n"
            f"*Event:* `{event}`\n"
            f"*Title:* {title}\n"
            f"*Preview:* {str(body)[:200]}\n"
            f"_Timestamp: {ts}_"
        )
    }


def _build_card_body(content: dict, event: str, source: str, name: str) -> dict:
    """Builds a Google Chat card payload for richer change notifications."""
    ts = _now()
    icon = {"update": "🔄", "remove": "🗑️"}.get(event, "📋")

    widgets = [
        {"keyValue": {"topLabel": "Source",    "content": source.upper()}},
        {"keyValue": {"topLabel": "Event",     "content": event}},
        {"keyValue": {"topLabel": "File",      "content": name}},
        {"keyValue": {"topLabel": "Timestamp", "content": ts}},
    ]

    # Append preview of any string fields from the content
    preview = content.get("text") or content.get("bodyText") or content.get("raw", "")
    if preview:
        widgets.append({
            "textParagraph": {"text": f"<b>Preview:</b> {str(preview)[:300]}"}
        })

    return {
        "cards": [{
            "header": {
                "title": f"{icon} Payload Updated",
                "subtitle": name,
            },
            "sections": [{"widgets": widgets}],
        }]
    }


# ---------------------------------------------------------------------------
# Dispatch helper  (raw urllib — no extra dependency)
# ---------------------------------------------------------------------------

def _post_to_webhook(webhook_url: str, body: dict) -> tuple[bool, int]:
    """POSTs body as JSON to the webhook URL. Returns (ok, status_code)."""
    if not webhook_url:
        log.warning("No webhook URL configured — skipping dispatch")
        return False, 0

    raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=raw,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            log.info("Webhook dispatched — HTTP %s", status)
            return status < 300, status
    except urllib.error.HTTPError as e:
        log.error("Webhook HTTP error: %s", e.code)
        return False, e.code
    except Exception as exc:
        log.error("Webhook request failed: %s", exc)
        return False, -1


# ---------------------------------------------------------------------------
# Local cache helpers
# ---------------------------------------------------------------------------

def _save_to_cache(name: str, content: dict):
    """Writes the updated content to the local payloads/ folder."""
    PAYLOADS_DIR.mkdir(parents=True, exist_ok=True)
    dest = PAYLOADS_DIR / name
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(content, f, indent=2, ensure_ascii=False)
    log.info("Cache updated: %s", dest)


def _detect_type(name: str) -> str:
    """Infers payload type from the filename."""
    lower = name.lower()
    for keyword, ptype in FILENAME_TYPE_MAP.items():
        if keyword in lower:
            return ptype
    return "text"   # default


# ---------------------------------------------------------------------------
# Public API — called by watcher.py
# ---------------------------------------------------------------------------

def on_payload_changed(
    source: str,
    event: str,
    name: str,
    content: dict | None,
    webhook_url: str,
):
    """
    Entry point called by DriveWatcher and GCSWatcher on every file event.

    Parameters
    ----------
    source      : "drive" or "gcs"
    event       : "update" or "remove"
    name        : filename (e.g. "card_payload.json")
    content     : parsed JSON dict of the new file content, or None on remove
    webhook_url : Google Chat webhook URL to notify
    """
    log.info("[sync] %s → %s event on '%s'", source.upper(), event, name)

    # --- Handle removal ---
    if event == "remove" or content is None:
        body = _build_text_body(
            content={"text": f"File `{name}` was removed from {source}."},
            event="remove", source=source, name=name,
        )
        _post_to_webhook(webhook_url, body)
        # Optionally remove from local cache
        cached = PAYLOADS_DIR / name
        if cached.exists():
            cached.unlink()
            log.info("Removed from local cache: %s", cached)
        return

    # --- Handle update / create ---
    payload_type = _detect_type(name)
    log.info("[sync] Detected payload type: %s", payload_type)

    # Persist to local cache so the React app can reload
    _save_to_cache(name, content)

    # Choose card vs text based on type
    if payload_type in ("card", "button_card", "image_card"):
        body = _build_card_body(content, event, source, name)
    else:
        body = _build_text_body(content, event, source, name)

    ok, status = _post_to_webhook(webhook_url, body)

    if ok:
        log.info("[sync] ✓ Notification sent for '%s' (%s)", name, payload_type)
    else:
        log.error("[sync] ✗ Failed to notify for '%s' — HTTP %s", name, status)
