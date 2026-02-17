"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/portal", label: "Dashboard" },
  { href: "/portal/approvals", label: "Approvals" },
  { href: "/portal/activity", label: "Activity" },
  { href: "/portal/playbooks", label: "Playbooks" },
  { href: "/portal/watchers", label: "Watchers" },
  { href: "/portal/canvas", label: "Canvas" },
  { href: "/portal/settings", label: "Settings" },
];

export function PortalNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Portal navigation"
      role="navigation"
      className="portal-nav"
    >
      <ul className="portal-nav__list">
        {NAV_ITEMS.map((item) => (
          <li key={item.href} className="portal-nav__item">
            <Link
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={
                pathname === item.href
                  ? "portal-nav__link portal-nav__link--active"
                  : "portal-nav__link"
              }
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
