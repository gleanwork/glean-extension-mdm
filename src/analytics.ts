import * as vscode from "vscode";
import * as crypto from "crypto";
import * as log from "./log";

const GA_ENDPOINT = "https://www.google-analytics.com/mp/collect";
const CLIENT_ID_KEY = "glean-mdm.analytics.clientId";

let clientId: string | null = null;
let sessionId: string | null = null;
let measurementId: string | null = null;
let apiSecret: string | null = null;

export function initAnalytics(
  context: vscode.ExtensionContext,
  gaMeasurementId?: string,
  gaApiSecret?: string,
) {
  measurementId = gaMeasurementId ?? null;
  apiSecret = gaApiSecret ?? null;

  if (!measurementId || !apiSecret) {
    log.info("Analytics disabled: gaMeasurementId or gaApiSecret not configured");
    return;
  }

  clientId = context.globalState.get<string>(CLIENT_ID_KEY) ?? null;
  if (!clientId) {
    clientId = crypto.randomUUID();
    context.globalState.update(CLIENT_ID_KEY, clientId);
    log.info("Generated new analytics client ID");
  }

  sessionId = String(Date.now());
}

export function trackEvent(
  name: string,
  params?: Record<string, string>,
) {
  if (!vscode.env.isTelemetryEnabled) {
    return;
  }

  if (!measurementId || !apiSecret) {
    return;
  }

  if (!clientId) {
    log.warn("Analytics not initialized, skipping event:", name);
    return;
  }

  const url = `${GA_ENDPOINT}?measurement_id=${measurementId}&api_secret=${apiSecret}`;
  const body = JSON.stringify({
    client_id: clientId,
    events: [
      {
        name,
        params: {
          ...params,
          session_id: sessionId,
          engagement_time_msec: "100",
          extension_version:
            vscode.extensions.getExtension("glean.glean-mdm")?.packageJSON
              ?.version ?? "unknown",
        },
      },
    ],
  });

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch((err) => {
    log.warn("Failed to send analytics event:", name, err);
  });
}
