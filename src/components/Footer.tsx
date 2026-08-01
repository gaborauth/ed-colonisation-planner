import pkg from "../../package.json";
import { useSpanshProxyHealth } from "../hooks/useSpanshProxyHealth";
import type { ConsentChoice } from "../persistence/consent";

const PROXY_HEALTH_LABEL = {
  checking: "checking…",
  healthy: "reachable",
  unhealthy: "unreachable",
};

export function Footer({
  cookieChoice,
  onOpenCookieSettings,
}: {
  cookieChoice: ConsentChoice | null;
  onOpenCookieSettings: () => void;
}) {
  const proxyHealth = useSpanshProxyHealth();

  return (
    <footer className="app-footer">
      <span>v{pkg.version}</span>
      <a href="https://github.com/gaborauth/ed-colonisation-planner" target="_blank" rel="noreferrer">
        GitHub
      </a>
      <a href="https://buymeacoffee.com/gabor.auth" target="_blank" rel="noreferrer">
        Buy me a coffee
      </a>
      <a href="https://inara.cz/elite/cmdr/332843/" target="_blank" rel="noreferrer">
        CMDR Frank O'Yanko
      </a>
      <button type="button" className="app-footer-link" onClick={onOpenCookieSettings}>
        Cookie settings{cookieChoice ? ` (${cookieChoice})` : ""}
      </button>
      <span
        className={`app-footer-proxy-status app-footer-proxy-status--${proxyHealth}`}
        title={`Spansh CORS proxy: ${PROXY_HEALTH_LABEL[proxyHealth]}`}
        aria-label={`Spansh CORS proxy: ${PROXY_HEALTH_LABEL[proxyHealth]}`}
        role="img"
      />
    </footer>
  );
}
