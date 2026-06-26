"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { getUser } from "@/lib/db";

const links = [
  { href: "/dashboard",    label: "Dashboard" },
  { href: "/upload",       label: "Upload" },
  { href: "/transactions", label: "Transactions" },
  { href: "/chat",         label: "AI Chat" },
  { href: "/profile",      label: "Profile" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  // Centralized session protection for all pages rendering Nav
  useEffect(() => {
    getUser().then((u) => {
      if (!u) {
        router.replace("/signup");
      } else if (localStorage.getItem("fintrack_session") === "logged_out") {
        router.replace("/login");
      }
    });
  }, [router]);

  const handleLogout = () => {
    localStorage.setItem("fintrack_session", "logged_out");
    router.replace("/login");
  };

  return (
    <nav className="nav">
      <Link href="/dashboard" className="nav-logo">
        ◈ FINTRACK
      </Link>
      <ul className="nav-links">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className={pathname === l.href ? "active" : ""}
            >
              {l.label}
            </Link>
          </li>
        ))}
        <li>
          <button 
            onClick={handleLogout} 
            className="nav-logout-btn" 
            style={{
              background: "none",
              border: "none",
              color: "var(--danger)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "inherit",
              padding: 0,
              marginLeft: 8,
              transition: "opacity 0.15s",
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = "0.7"}
            onMouseOut={(e) => e.currentTarget.style.opacity = "1"}
          >
            Logout
          </button>
        </li>
      </ul>
    </nav>
  );
}
