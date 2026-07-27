import pkg from "../../package.json";
import type { ConsentChoice } from "../persistence/consent";

export function Footer({
  cookieChoice,
  onOpenCookieSettings,
}: {
  cookieChoice: ConsentChoice | null;
  onOpenCookieSettings: () => void;
}) {
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
    </footer>
  );
}
