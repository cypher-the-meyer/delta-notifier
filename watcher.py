"""
watcher.py
==========
Google Cloud Console watcher for Delta Notifier.

Monitors TWO Google Cloud products simultaneously:
  1. Google Drive API  — watches a Drive folder for file changes (add/modify/delete)
  2. Google Cloud Storage (GCS) — subscribes to a Pub/Sub topic for bucket events

On any detected change the affected payload file is:
  - Downloaded / re-read
  - Validated and rebuilt via payloadProcessor logic
  - Dispatched to the configured Google Chat webhook

Authentication: Service Account key JSON from Google Cloud Console.

──────────────────────────────────────────────────────────────────────
GOOGLE CLOUD CONSOLE SETUP  (one-time, step by step)
──────────────────────────────────────────────────────────────────────
 1. Go to https://console.cloud.google.com/
 2. Create or select a project
 3. Enable these APIs  (APIs & Services → Enable APIs):
      • Google Drive API
      • Cloud Storage API
      • Cloud Pub/Sub API
 4. Create a Service Account  (IAM & Admin → Service Accounts):
      • Name: delta-notifier-watcher
      • Roles: Drive File Viewer, Storage Object Viewer, Pub/Sub Subscriber
 5. Create and download a JSON key for that Service Account
 6. Copy the key path into .env  →  GOOGLE_SERVICE_ACCOUNT_JSON=./credentials.json
 7. Share the Drive folder with the Service Account email  (e.g. delta-notifier@project.iam.gserviceaccount.com)
──────────────────────────────────────────────────────────────────────
"""

import os
import io
import json
import time
import threading
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv

# Google API clients
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google.cloud import pubsub_v1, storage

from payload_sync import on_payload_changed

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("delta-watcher")

# UTC-8 helper
UTC8 = timezone(timedelta(hours=-8))
def now_utc8():
    return datetime.now(UTC8).strftime("%Y-%m-%dT%H:%M:%S-08:00")

# ---------------------------------------------------------------------------
# Config  (all values come from .env)
# ---------------------------------------------------------------------------

SERVICE_ACCOUNT_JSON = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials.json")
GOOGLE_API_KEY       = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CHAT_WEBHOOK  = os.getenv("GOOGLE_CHAT_WEBHOOK_URL", "")

# Google Drive
DRIVE_FOLDER_ID      = os.getenv("DRIVE_FOLDER_ID", "")
DRIVE_POLL_INTERVAL  = int(os.getenv("DRIVE_POLL_INTERVAL_SEC", "30"))

# Google Cloud Storage + Pub/Sub
GCS_BUCKET_NAME      = os.getenv("GCS_BUCKET_NAME", "")
GCS_PUBSUB_PROJECT   = os.getenv("GCS_PUBSUB_PROJECT", "")
GCS_PUBSUB_SUB       = os.getenv("GCS_PUBSUB_SUBSCRIPTION", "delta-notifier-sub")

LOCAL_PAYLOADS_DIR   = Path(os.getenv("LOCAL_PAYLOADS_DIR", "./payloads"))

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/cloud-platform",
]

# ---------------------------------------------------------------------------
# Credential loader
# ---------------------------------------------------------------------------

def load_credentials():
    # Priority 1: Service Account JSON key (full Drive + GCS access)
    if Path(SERVICE_ACCOUNT_JSON).exists():
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_JSON, scopes=SCOPES
        )
        log.info("Auth: Service Account loaded from %s", SERVICE_ACCOUNT_JSON)
        return creds

    # Priority 2: API Key (limited — public resources only, no user data)
    if GOOGLE_API_KEY:
        log.warning(
            "Auth: Using API key only. Service account not found at %s.\n"
            "      Drive folder watch and GCS require a Service Account for full access.\n"
            "      API key works for public Drive files and webhook dispatch only.",
            SERVICE_ACCOUNT_JSON,
        )
        # Return None — callers that need OAuth will skip; webhook dispatch uses key directly
        return None

    raise RuntimeError(
        "No credentials found.\n"
        "  Option A (recommended): download a Service Account JSON key from\n"
        "    Google Cloud Console → IAM & Admin → Service Accounts → Keys\n"
        "    and set GOOGLE_SERVICE_ACCOUNT_JSON in .env\n"
        "  Option B: set GOOGLE_API_KEY in .env (limited access only)"
    )

# ---------------------------------------------------------------------------
# 1. GOOGLE DRIVE WATCHER  (polling via Drive Changes API)
# ---------------------------------------------------------------------------

class DriveWatcher(threading.Thread):
    """
    Uses the Google Drive Changes API to poll a folder for modifications.
    Runs in its own daemon thread.

    Drive API reference:
      • changes.getStartPageToken  — get the latest checkpoint token
      • changes.list               — list all changes since the token
      • files.get / files.export   — download the modified file
    """

    def __init__(self, creds):
        super().__init__(daemon=True, name="DriveWatcher")
        self.service    = build("drive", "v3", credentials=creds) if creds else None
        self.page_token = None  # Drive Changes page token

    # ------------------------------------------------------------------
    def _init_token(self):
        """Grab the current page token so we only see *future* changes."""
        resp = self.service.changes().getStartPageToken().execute()
        self.page_token = resp.get("startPageToken")
        log.info("[Drive] Watching folder %s — start token: %s", DRIVE_FOLDER_ID, self.page_token)

    # ------------------------------------------------------------------
    def _poll(self):
        """Fetch changes since the last token and dispatch each relevant file."""
        params = dict(
            pageToken=self.page_token,
            spaces="drive",
            fields="nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents,modifiedTime))",
            includeRemoved=True,
        )

        while True:
            resp = self.service.changes().list(**params).execute()

            for change in resp.get("changes", []):
                file_meta = change.get("file", {})
                parents   = file_meta.get("parents", [])

                # Only care about files inside our watched folder
                if DRIVE_FOLDER_ID and DRIVE_FOLDER_ID not in parents:
                    continue

                file_id   = change.get("fileId", "")
                file_name = file_meta.get("name", "unknown")
                removed   = change.get("removed", False)
                mime      = file_meta.get("mimeType", "")
                modified  = file_meta.get("modifiedTime", now_utc8())

                if removed:
                    log.info("[Drive] File removed: %s", file_name)
                    on_payload_changed(
                        source="drive", event="remove",
                        name=file_name, content=None,
                        webhook_url=GOOGLE_CHAT_WEBHOOK
                    )
                else:
                    log.info("[Drive] File changed: %s (%s) @ %s", file_name, mime, modified)
                    content = self._download(file_id, mime)
                    if content:
                        on_payload_changed(
                            source="drive", event="update",
                            name=file_name, content=content,
                            webhook_url=GOOGLE_CHAT_WEBHOOK
                        )

            # Advance the token
            if "newStartPageToken" in resp:
                self.page_token = resp["newStartPageToken"]
                break
            params["pageToken"] = resp.get("nextPageToken")

    # ------------------------------------------------------------------
    def _download(self, file_id: str, mime: str) -> dict | None:
        """Download a Drive file; export Google Docs formats to JSON-friendly text."""
        try:
            # Native files (e.g. uploaded .json)
            if "google-apps" not in mime:
                req    = self.service.files().get_media(fileId=file_id)
                buf    = io.BytesIO()
                dl     = MediaIoBaseDownload(buf, req)
                done   = False
                while not done:
                    _, done = dl.next_chunk()
                raw = buf.getvalue().decode("utf-8")
                return json.loads(raw) if raw.strip().startswith("{") else {"raw": raw}

            # Google Sheets / Docs — export as plain text
            export_mime = "text/plain"
            req = self.service.files().export_media(fileId=file_id, mimeType=export_mime)
            buf = io.BytesIO()
            dl  = MediaIoBaseDownload(buf, req)
            done = False
            while not done:
                _, done = dl.next_chunk()
            return {"raw": buf.getvalue().decode("utf-8")}

        except Exception as exc:
            log.error("[Drive] Download failed for %s: %s", file_id, exc)
            return None

    # ------------------------------------------------------------------
    def run(self):
        if self.service is None:
            log.warning("[Drive] No Service Account — Drive watcher requires OAuth credentials")
            return
        if not DRIVE_FOLDER_ID:
            log.warning("[Drive] DRIVE_FOLDER_ID not set — Drive watcher disabled")
            return
        self._init_token()
        log.info("[Drive] Polling every %ds", DRIVE_POLL_INTERVAL)
        while True:
            try:
                self._poll()
            except Exception as exc:
                log.error("[Drive] Poll error: %s", exc)
            time.sleep(DRIVE_POLL_INTERVAL)


# ---------------------------------------------------------------------------
# 2. GOOGLE CLOUD STORAGE WATCHER  (Pub/Sub push)
# ---------------------------------------------------------------------------

class GCSWatcher(threading.Thread):
    """
    Subscribes to a Cloud Pub/Sub topic that receives GCS bucket notifications.

    Setup in Google Cloud Console:
      Storage → Bucket → Settings → Cloud Pub/Sub notifications → Create
      OR via gsutil:
        gsutil notification create -t projects/PROJECT/topics/TOPIC -f json gs://BUCKET

    The subscriber pulls messages in real time — no polling, no HTTP endpoint needed.
    """

    def __init__(self, creds):
        super().__init__(daemon=True, name="GCSWatcher")
        self.creds      = creds
        self.gcs_client = storage.Client(credentials=creds, project=GCS_PUBSUB_PROJECT)

    # ------------------------------------------------------------------
    def _handle_message(self, message):
        try:
            data       = json.loads(message.data.decode("utf-8"))
            event_type = data.get("eventType", "")        # OBJECT_FINALIZE, OBJECT_DELETE …
            bucket     = data.get("bucket", "")
            obj_name   = data.get("name", "")
            updated    = data.get("updated", now_utc8())

            log.info("[GCS] %s → gs://%s/%s @ %s", event_type, bucket, obj_name, updated)

            if event_type == "OBJECT_DELETE":
                on_payload_changed(
                    source="gcs", event="remove",
                    name=obj_name, content=None,
                    webhook_url=GOOGLE_CHAT_WEBHOOK
                )
            elif event_type in ("OBJECT_FINALIZE", "OBJECT_METADATA_UPDATE"):
                content = self._download(bucket, obj_name)
                if content is not None:
                    on_payload_changed(
                        source="gcs", event="update",
                        name=obj_name, content=content,
                        webhook_url=GOOGLE_CHAT_WEBHOOK
                    )
        except Exception as exc:
            log.error("[GCS] Message handling error: %s", exc)
        finally:
            message.ack()

    # ------------------------------------------------------------------
    def _download(self, bucket_name: str, blob_name: str) -> dict | None:
        try:
            bucket = self.gcs_client.bucket(bucket_name)
            blob   = bucket.blob(blob_name)
            raw    = blob.download_as_text(encoding="utf-8")
            return json.loads(raw) if raw.strip().startswith("{") else {"raw": raw}
        except Exception as exc:
            log.error("[GCS] Download failed for %s/%s: %s", bucket_name, blob_name, exc)
            return None

    # ------------------------------------------------------------------
    def run(self):
        if self.creds is None:
            log.warning("[GCS] No Service Account — GCS Pub/Sub watcher requires OAuth credentials")
            return
        if not GCS_PUBSUB_PROJECT or not GCS_PUBSUB_SUB:
            log.warning("[GCS] GCS_PUBSUB_PROJECT or GCS_PUBSUB_SUBSCRIPTION not set — GCS watcher disabled")
            return

        subscriber  = pubsub_v1.SubscriberClient(credentials=self.creds)
        sub_path    = subscriber.subscription_path(GCS_PUBSUB_PROJECT, GCS_PUBSUB_SUB)
        log.info("[GCS] Subscribing to %s", sub_path)

        streaming_pull = subscriber.subscribe(sub_path, callback=self._handle_message)
        log.info("[GCS] Listening for bucket events (Ctrl+C to stop)")
        try:
            streaming_pull.result()   # blocks until cancelled
        except Exception as exc:
            log.error("[GCS] Subscriber error: %s", exc)
            streaming_pull.cancel()
            streaming_pull.result()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    log.info("=== Delta Notifier — Google Cloud Watcher starting @ %s ===", now_utc8())

    creds = load_credentials()

    watchers = [
        DriveWatcher(creds),
        GCSWatcher(creds),
    ]

    for w in watchers:
        w.start()
        log.info("Started thread: %s", w.name)

    log.info("Both watchers running. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(5)
            alive = [w.name for w in watchers if w.is_alive()]
            log.debug("Active threads: %s", alive)
    except KeyboardInterrupt:
        log.info("Shutdown requested — stopping watchers.")


if __name__ == "__main__":
    main()
