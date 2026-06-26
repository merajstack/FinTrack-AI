"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getUser } from "@/lib/db";

/**
 * Root page — redirects to:
 *   /signup  → if no user profile exists (first time)
 *   /login   → if profile exists but session is logged out
 *   /dashboard → if already logged in
 */
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    getUser().then((u) => {
      if (!u) {
        // No profile created yet → always go to signup first
        router.replace("/signup");
      } else {
        const session = localStorage.getItem("fintrack_session");
        if (session === "logged_in") {
          router.replace("/dashboard");
        } else {
          // Profile exists but not logged in → login page
          router.replace("/login");
        }
      }
    });
  }, [router]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Space Mono, monospace",
      }}
    >
      <p style={{ color: "var(--muted)", fontSize: 14 }}>Loading…</p>
    </div>
  );
}
