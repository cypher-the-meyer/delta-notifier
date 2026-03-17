/**
 * payloadProcessor.js
 * Loads, validates, fills, and dispatches each payload type
 * to the Google Chat webhook endpoint.
 *
 * Each payload template uses {{variableName}} placeholders.
 * The processor interpolates them, attaches a UTC-8 timestamp,
 * then POSTs to the configured webhook URL.
 */

import { webhookTimestamp } from "./datetime.js";

// ---------------------------------------------------------------------------
// Payload templates (mirrors payloads/ folder structure)
// ---------------------------------------------------------------------------

const TEMPLATES = {
  text: {
    payload: { text: "{{message}}" },
    required: ["message"],
  },

  card: {
    payload: {
      cards: [
        {
          header: {
            title: "{{title}}",
            subtitle: "{{subtitle}}",
            imageUrl: "{{headerImageUrl}}",
            imageStyle: "IMAGE",
          },
          sections: [
            {
              header: "{{sectionHeader}}",
              widgets: [
                { keyValue: { topLabel: "{{labelKey}}", content: "{{labelValue}}" } },
                { textParagraph: { text: "{{bodyText}}" } },
              ],
            },
          ],
        },
      ],
    },
    required: ["title", "subtitle", "bodyText"],
  },

  button_card: {
    payload: {
      cards: [
        {
          header: { title: "{{title}}", subtitle: "{{subtitle}}" },
          sections: [
            {
              widgets: [
                { textParagraph: { text: "{{bodyText}}" } },
                {
                  buttons: [
                    {
                      textButton: {
                        text: "{{primaryButtonLabel}}",
                        onClick: { openLink: { url: "{{primaryButtonUrl}}" } },
                      },
                    },
                    {
                      textButton: {
                        text: "{{secondaryButtonLabel}}",
                        onClick: { openLink: { url: "{{secondaryButtonUrl}}" } },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    required: ["title", "bodyText", "primaryButtonLabel", "primaryButtonUrl"],
  },

  image_card: {
    payload: {
      cards: [
        {
          header: { title: "{{title}}" },
          sections: [
            {
              widgets: [
                { image: { imageUrl: "{{imageUrl}}", onClick: { openLink: { url: "{{imageLinkUrl}}" } } } },
                { textParagraph: { text: "{{caption}}" } },
              ],
            },
          ],
        },
      ],
    },
    required: ["title", "imageUrl", "caption"],
  },

  thread: {
    payload: {
      text: "{{message}}",
      thread: { name: "{{threadName}}" },
    },
    required: ["message", "threadName"],
  },
};

// ---------------------------------------------------------------------------
// Template interpolation
// ---------------------------------------------------------------------------

/**
 * Recursively replaces {{key}} tokens in any JSON-serialisable value.
 * @param {any} node      Template value (object, array, or string)
 * @param {Object} vars   Key→value replacement map
 * @returns {any}
 */
function interpolate(node, vars) {
  if (typeof node === "string") {
    return node.replace(/\{\{(\w+)\}\}/g, (_, key) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : `{{${key}}}`
    );
  }
  if (Array.isArray(node)) return node.map((item) => interpolate(item, vars));
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [k, interpolate(v, vars)])
    );
  }
  return node;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Checks that all required fields are present in vars.
 * @param {string[]} required
 * @param {Object} vars
 * @throws {Error} if a required field is missing
 */
function validate(required, vars) {
  const missing = required.filter((k) => !Object.prototype.hasOwnProperty.call(vars, k) || vars[k] === "");
  if (missing.length > 0) {
    throw new Error(`Payload missing required fields: ${missing.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Builds a ready-to-send Google Chat webhook payload object.
 *
 * @param {"text"|"card"|"button_card"|"image_card"|"thread"} type
 * @param {Object} vars   Variable values to fill placeholders
 * @returns {{ body: Object, meta: Object }}
 */
export function buildPayload(type, vars = {}) {
  const template = TEMPLATES[type];
  if (!template) {
    throw new Error(`Unknown payload type: "${type}". Valid types: ${Object.keys(TEMPLATES).join(", ")}`);
  }
  validate(template.required, vars);

  const enrichedVars = { ...vars, _timestamp: webhookTimestamp() };
  const body = interpolate(structuredClone(template.payload), enrichedVars);

  return {
    body,
    meta: {
      type,
      timestamp: enrichedVars._timestamp,
      source: "delta-notifier",
      encoding: "UTF-8",
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Sends a payload to a Google Chat webhook URL.
 *
 * @param {string} webhookUrl
 * @param {"text"|"card"|"button_card"|"image_card"|"thread"} type
 * @param {Object} vars
 * @returns {Promise<{ ok: boolean, status: number, meta: Object }>}
 */
export async function dispatch(webhookUrl, type, vars = {}) {
  if (!webhookUrl) throw new Error("webhookUrl is required");

  const { body, meta } = buildPayload(type, vars);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });

  return {
    ok: response.ok,
    status: response.status,
    meta,
  };
}

/**
 * Returns a list of all supported payload type names.
 * @returns {string[]}
 */
export function listTypes() {
  return Object.keys(TEMPLATES);
}

/**
 * Returns the required fields for a given payload type.
 * @param {string} type
 * @returns {string[]}
 */
export function requiredFields(type) {
  if (!TEMPLATES[type]) throw new Error(`Unknown payload type: "${type}"`);
  return [...TEMPLATES[type].required];
}
