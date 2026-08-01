// Typed wrapper around the Docker tool's read-only command surface.
import { invoke } from "@tauri-apps/api/core";
import type { ContainerInfo } from "../bindings/ContainerInfo";

export const dockerApi = {
  /**
   * Every container the daemon knows about, running or not.
   *
   * An empty list when there is no Docker, no daemon or no permission — none of which is an error
   * for a tool that many projects will never open.
   */
  containers: () => invoke<ContainerInfo[]>("list_containers"),

  /**
   * The last `lines` of a container's log.
   *
   * Bounded, and clamped again by the backend: a week-old container's whole log has no business
   * crossing this boundary to fill a panel.
   */
  logs: (id: string, lines: number) => invoke<string>("container_logs", { id, lines }),
};
