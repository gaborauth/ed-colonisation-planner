import { useEffect, useState } from "react";
import { checkSpanshProxyHealth } from "../spansh/api";

export type ProxyHealthStatus = "checking" | "healthy" | "unhealthy";

const POLL_INTERVAL_MS = 60_000;

/** Polls the Spansh CORS proxy's `/health` endpoint for the footer's status dot. Runs regardless
 * of whether the Spansh import tab is currently open — the footer is global. */
export function useSpanshProxyHealth(): ProxyHealthStatus {
  const [status, setStatus] = useState<ProxyHealthStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const healthy = await checkSpanshProxyHealth();
      if (!cancelled) setStatus(healthy ? "healthy" : "unhealthy");
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return status;
}
