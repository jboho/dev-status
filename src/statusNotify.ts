import { isTauri } from "@tauri-apps/api/core";
import type { IndicatorChange } from "./statusChange";

export async function notifyIndicatorChanges(
  changes: IndicatorChange[],
): Promise<void> {
  if (changes.length === 0 || !isTauri()) return;

  const { isPermissionGranted, requestPermission, sendNotification } =
    await import("@tauri-apps/plugin-notification");

  let permitted = await isPermissionGranted();
  if (!permitted) {
    const permission = await requestPermission();
    permitted = permission === "granted";
  }
  if (!permitted) return;

  const body = changes.map((c) => `${c.name}: ${c.from} → ${c.to}`).join("\n");

  sendNotification({ title: "DevStatus", body });
}
