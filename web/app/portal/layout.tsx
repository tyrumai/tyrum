import type { ReactNode } from "react";
import { ExposedBanner } from "../../components/exposed-banner";
import { PortalNav } from "../../components/portal-nav";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="portal-shell">
      <ExposedBanner />
      <aside className="portal-shell__sidebar">
        <h2 className="portal-shell__title">Tyrum Portal</h2>
        <PortalNav />
      </aside>
      <div className="portal-shell__content">{children}</div>
    </div>
  );
}
