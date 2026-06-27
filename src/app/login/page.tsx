"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser, saveUser } from "@/lib/db";
import { verifyPassword, isBiometricAvailable, verifyBiometric, isValidEmail, sendEmailOtp, verifyEmailOtp } from "@/lib/auth";
import type { UserProfile } from "@/lib/db";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [otpMessage, setOtpMessage] = useState("");
  const [otpError, setOtpError] = useState("");
  const [resendTimer, setResendTimer] = useState(0);
  const [emailVerified, setEmailVerified] = useState(false);
  const isEmailValid = useMemo(() => isValidEmail(email), [email]);

  useEffect(() => {
    getUser().then(async (u) => {
      if (!u) {
        router.replace("/signup");
      } else if (localStorage.getItem("fintrack_session") === "logged_in") {
        router.replace("/dashboard");
      } else {
        setUser(u);
        setEmail(u.email || "");
        setEmailVerified(Boolean(u.emailVerified));
        const bioAvail = await isBiometricAvailable();
        setBiometricAvailable(bioAvail);
        setChecking(false);
      }
    });
  }, [router]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const timer = window.setTimeout(() => setResendTimer((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendTimer]);

  if (checking) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <p style={{ fontFamily: "Space Mono, monospace", fontSize: 13 }}>Checking session…</p>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setAuthenticating(true);
    setError("");

    if (!emailVerified) {
      setError("Please verify your email before signing in.");
      setAuthenticating(false);
      return;
    }

    if (user.passwordHash) {
      const isValid = await verifyPassword(password, user.passwordHash);
      if (isValid) {
        localStorage.setItem("fintrack_session", "logged_in");
        router.push("/dashboard");
      } else {
        setError("Incorrect password. Try again.");
        setAuthenticating(false);
      }
    } else {
      // Backwards compatibility for users without a password hash (name-based login)
      if (password.trim().toLowerCase() === user.name.toLowerCase()) {
        localStorage.setItem("fintrack_session", "logged_in");
        router.push("/dashboard");
      } else {
        setError("Incorrect name/password. Try again.");
        setAuthenticating(false);
      }
    }
  };

  const handleSendOtp = async () => {
    setOtpError("");
    setOtpMessage("");
    if (!isEmailValid) {
      setOtpError("Please enter a valid email address.");
      return;
    }

    setOtpLoading(true);
    const result = await sendEmailOtp(email);
    setOtpLoading(false);

    if (result.ok) {
      setOtpSent(true);
      setEmailVerified(false);
      setOtp("");
      setResendTimer(60);
      setOtpMessage("OTP sent to your email.");
    } else {
      setOtpError(result.message || "Unable to send OTP right now.");
    }
  };

  const handleVerifyOtp = async () => {
    setOtpError("");
    setOtpMessage("");
    if (!otp) {
      setOtpError("Enter the 6-digit OTP.");
      return;
    }

    setVerifyLoading(true);
    const result = await verifyEmailOtp(email, otp);
    setVerifyLoading(false);

    if (result.ok) {
      setEmailVerified(true);
      setOtpMessage("Email verified successfully.");
      if (user) {
        await saveUser({ ...user, email: email.trim().toLowerCase(), emailVerified: true });
      }
    } else {
      setOtpError(result.message || "Invalid OTP");
    }
  };

  const onBiometricLogin = async () => {
    if (!user || !user.biometricCredentialId) return;
    setAuthenticating(true);
    setError("");

    const success = await verifyBiometric(user.biometricCredentialId);
    if (success) {
      localStorage.setItem("fintrack_session", "logged_in");
      router.push("/dashboard");
    } else {
      setError("Biometric verification failed.");
      setAuthenticating(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontFamily: "Space Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            ◈ FINTRACK
          </p>
          <h1 style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.1, marginTop: 8 }}>
            Welcome back, {user?.name.split(" ")[0]}.
          </h1>
          <p style={{ color: "var(--muted)", marginTop: 10, fontSize: 15 }}>
            Enter your password to continue to your dashboard.
          </p>
        </div>

        <form onSubmit={onSubmit} className="card" style={{ padding: 32 }}>
          <div>
            <label className="label">Email</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setOtpError("");
                  setOtpMessage("");
                  setOtpSent(false);
                  setEmailVerified(false);
                  setOtp("");
                }}
                required
                disabled={otpLoading || verifyLoading || authenticating}
                autoComplete="email"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-outline"
                onClick={handleSendOtp}
                disabled={otpLoading || !isEmailValid || authenticating}
                style={{ minWidth: 118, whiteSpace: "nowrap" }}
              >
                {otpLoading ? "Sending…" : otpSent ? "Resend OTP" : "Get OTP"}
              </button>
            </div>
            {otpSent && !emailVerified && (
              <div style={{ marginTop: 12 }}>
                <label className="label">Enter OTP</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="input"
                    inputMode="numeric"
                    pattern="\\d{6}"
                    maxLength={6}
                    placeholder="123456"
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
                    disabled={verifyLoading}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleVerifyOtp}
                    disabled={verifyLoading || otp.length !== 6 || authenticating}
                    style={{ minWidth: 108 }}
                  >
                    {verifyLoading ? "Verifying…" : "Verify OTP"}
                  </button>
                </div>
                <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: otpError ? "var(--danger)" : "var(--success)" }}>
                    {otpError || otpMessage || (resendTimer > 0 ? `Resend available in ${resendTimer}s` : "")}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={handleSendOtp}
                    disabled={resendTimer > 0 || otpLoading || authenticating}
                    style={{ fontSize: 12, padding: "8px 10px" }}
                  >
                    {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Resend OTP"}
                  </button>
                </div>
              </div>
            )}
            {emailVerified && (
              <p style={{ color: "var(--success)", fontSize: 12, marginTop: 8 }}>✓ Email verified</p>
            )}
          </div>
          <label className="label" style={{ marginTop: 16 }}>Password</label>
          <input
            className="input"
            type="password"
            placeholder={user?.passwordHash ? "••••••••" : "Enter your name (legacy login)"}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            required
            disabled={authenticating}
          />
          {error && (
            <p style={{ color: "var(--danger)", fontFamily: "Space Mono, monospace", fontSize: 12, marginTop: 8 }}>
              ✕ {error}
            </p>
          )}
          
          <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: 24, padding: "14px 0", fontSize: 15 }} disabled={authenticating}>
            {authenticating ? "Authenticating…" : "Sign In →"}
          </button>
          
          {biometricAvailable && user?.biometricCredentialId && (
             <div style={{ marginTop: 16, textAlign: "center" }}>
                <div style={{ display: "flex", alignItems: "center", margin: "16px 0", color: "var(--muted)" }}>
                  <hr style={{ flex: 1, borderColor: "var(--border)" }} />
                  <span style={{ padding: "0 12px", fontSize: 12, fontFamily: "Space Mono, monospace" }}>OR</span>
                  <hr style={{ flex: 1, borderColor: "var(--border)" }} />
                </div>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ width: "100%", padding: "12px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                  onClick={onBiometricLogin}
                  disabled={authenticating}
                >
                  <span style={{ fontSize: 20 }}>👆</span> Use Biometrics
                </button>
             </div>
          )}
        </form>

        <p style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "var(--muted)" }}>
          New here?{" "}
          <a href="/signup" style={{ color: "var(--fg)", fontWeight: 600 }}>
            Create a profile
          </a>
        </p>
      </div>
    </div>
  );
}
