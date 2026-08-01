import { useQuery } from "@tanstack/react-query";
import { api } from "../api/commands";

/**
 * How often the load is re-read.
 *
 * Five seconds, matched to what the number IS: a load average over one minute barely moves faster
 * than that, so polling harder would spend wake-ups to redraw the same digits. Slower and a build
 * starting would take too long to show.
 */
const REFRESH_MS = 5000;

/** How busy the machine is, or `null` where the platform has no load average. */
export function useSystemLoad() {
  return useQuery({
    queryKey: ["system-load"],
    queryFn: () => api.systemLoad(),
    refetchInterval: REFRESH_MS,
    // A machine that is briefly too busy to answer is not an error worth a retry storm — the next
    // tick is five seconds away.
    retry: false,
  });
}
