// Typed wrapper around the Docker tool's read-only command surface.
import { invoke } from "@tauri-apps/api/core";
import type { ContainerInfo } from "../bindings/ContainerInfo";
import type { ContainerStats } from "../bindings/ContainerStats";

export const dockerApi = {
  /**
   * Every container the daemon knows about, running or not.
   *
   * An empty list when there is no Docker, no daemon or no permission — none of which is an error
   * for a tool that many projects will never open.
   */
  containers: () => invoke<ContainerInfo[]>("list_containers"),

  /**
   * What the running containers are consuming right now.
   *
   * **Takes ~2 s** — `docker stats` samples twice to compute a CPU delta, and that is per call, not
   * per container (measured on six). Fetch it separately from the listing and only while somebody is
   * looking at it.
   */
  stats: () => invoke<ContainerStats[]>("container_stats"),

  /**
   * The last `lines` of a container's log.
   *
   * Bounded, and clamped again by the backend: a week-old container's whole log has no business
   * crossing this boundary to fill a panel.
   */
  logs: (id: string, lines: number) => invoke<string>("container_logs", { id, lines }),
};
