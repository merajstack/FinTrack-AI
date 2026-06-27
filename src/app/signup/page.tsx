"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveUser, getUser } from "@/lib/db";
import { isValidEmail, sendEmailOtp, verifyEmailOtp } from "@/lib/auth";
import type { UserProfile, AIProvider } from "@/lib/db";

const FIELDS = [
  { name: "name",           label: "Your Name",               type: "text",     placeholder: "e.g. Alex Johnson" },
  { name: "age",            label: "Age",                     type: "number",   placeholder: "e.g. 28" },
  { name: "monthlyIncome",  label: "Monthly Income (₹)",      type: "number",   placeholder: "e.g. 75000" },
  { name: "savingsGoal",    label: "Monthly Savings Goal (₹)", type: "number",  placeholder: "e.g. 15000" },
  { name: "investmentGoal", label: "Monthly Investment Goal (₹)", type: "number", placeholder: "e.g. 10000" },
];

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>({
    name: "", age: "", monthlyIncome: "", savingsGoal: "", investmentGoal: "",
    geminiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? "",
    aiApiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY ?? "",
    aiBaseUrl: "",
    aiModel: process.env.NEXT_PUBLIC_GROQ_MODEL ?? "llama-3.3-70b-versatile",
    aiProvider: "groq",
    password: "",
    email: "",
  });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [otpMessage, setOtpMessage] = useState("");
  const [otpError, setOtpError] = useState("");
  const [resendTimer, setResendTimer] = useState(0);
  const [emailVerified, setEmailVerified] = useState(false);
  const isEmailValid = useMemo(() => isValidEmail(form.email || ""), [form.email]);

  useEffect(() => {
    getUser().then((u) => {
      if (u) {
        if (localStorage.getItem("fintrack_session") === "logged_out") {
          router.replace("/login");
        } else {
          router.replace("/dashboard");
        }
      } else {
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
        <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 13 }}>Checking session…</p>
      </div>
    );
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((p) => {
      const next = { ...p, [name]: value };
      // Auto-fill sensible defaults when the provider changes
      if (name === 'aiProvider') {
        if (value === 'groq') {
          next.aiApiKey = process.env.NEXT_PUBLIC_GROQ_API_KEY ?? p.aiApiKey;
          next.aiModel  = process.env.NEXT_PUBLIC_GROQ_MODEL  ?? 'llama-3.3-70b-versatile';
          next.aiBaseUrl = '';
        } else if (value === 'nvidia') {
          next.aiApiKey  = process.env.NEXT_PUBLIC_NVIDIA_API_KEY  ?? p.aiApiKey;
          next.aiModel   = process.env.NEXT_PUBLIC_NVIDIA_MODEL    ?? 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
          next.aiBaseUrl = process.env.NEXT_PUBLIC_NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';
        } else {
          // gemini
          next.aiApiKey  = process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? p.aiApiKey;
          next.aiModel   = '';
          next.aiBaseUrl = '';
        }
      }
      return next;
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailVerified) {
      setOtpError("Please verify your email before creating your profile.");
      return;
    }

    setLoading(true);

    const { hashPassword } = await import("@/lib/auth");
    const passwordHash = await hashPassword(form.password);

    const profile: UserProfile = {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      age: Number(form.age),
      monthlyIncome: Number(form.monthlyIncome),
      savingsGoal: Number(form.savingsGoal),
      investmentGoal: Number(form.investmentGoal),
      geminiKey: form.geminiKey.trim() || (process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? ""),
      aiProvider: (form.aiProvider as AIProvider) || "groq",
      aiApiKey: form.aiApiKey.trim(),
      aiBaseUrl: form.aiBaseUrl.trim(),
      aiModel: form.aiModel.trim(),
      createdAt: new Date().toISOString(),
      email: form.email.trim().toLowerCase(),
      emailVerified: true,
      passwordHash,
    };
    await saveUser(profile);
    localStorage.setItem("fintrack_session", "logged_in");
    router.push("/dashboard");
  };

  const handleSendOtp = async () => {
    setOtpError("");
    setOtpMessage("");
    if (!isEmailValid) {
      setOtpError("Please enter a valid email address.");
      return;
    }

    setOtpLoading(true);
    const result = await sendEmailOtp(form.email);
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
    const result = await verifyEmailOtp(form.email, otp);
    setVerifyLoading(false);

    if (result.ok) {
      setEmailVerified(true);
      setOtpMessage("Email verified successfully.");
    } else {
      setOtpError(result.message || "Invalid OTP");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ width: "100%", maxWidth: 500 }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 12, color: "var(--accent)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            ◈ FINTRACK
          </p>
          <h1 style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.1, marginTop: 8 }}>
            Set up your<br />finance profile.
          </h1>
          <p style={{ color: "var(--muted)", marginTop: 10, fontSize: 15, lineHeight: 1.5 }}>
            Your data stays 100% in your browser — nothing sent to any server.
          </p>
        </div>

        <form onSubmit={onSubmit} className="card" style={{ padding: 32 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {FIELDS.map((f) => (
              <div key={f.name}>
                <label className="label">{f.label}</label>
                <input
                  className="input"
                  name={f.name}
                  type={f.type}
                  placeholder={f.placeholder}
                  value={form[f.name] ?? ""}
                  onChange={onChange}
                  required
                  min={f.type === "number" ? 0 : undefined}
                />
              </div>
            ))}
            <div>
              <label className="label">Email</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  value={form.email ?? ""}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, email: event.target.value }));
                    setOtpError("");
                    setOtpMessage("");
                    setOtpSent(false);
                    setEmailVerified(false);
                    setOtp("");
                  }}
                  required
                  disabled={otpLoading || verifyLoading}
                  autoComplete="email"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleSendOtp}
                  disabled={otpLoading || !isEmailValid || loading}
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
                      disabled={verifyLoading || otp.length !== 6 || loading}
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
                      disabled={resendTimer > 0 || otpLoading || loading}
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
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                name="password"
                type="password"
                placeholder="Set a secure password"
                value={form.password ?? ""}
                onChange={onChange}
                required
              />
            </div>
            <div>
              <label className="label">AI Provider</label>
              <select className="input" name="aiProvider" value={form.aiProvider ?? "groq"} onChange={onChange}>
                <option value="groq">Groq (Llama · Fast ⚡)</option>
                <option value="gemini">Google Gemini</option>
                <option value="nvidia">NVIDIA NIM</option>
              </select>
            </div>
            <div>
              <label className="label">
                {form.aiProvider === "nvidia" ? "NVIDIA API Key" :
                 form.aiProvider === "groq"   ? "Groq API Key" :
                 "Gemini API Key"}
              </label>
              <input
                className="input"
                name="aiApiKey"
                type="password"
                placeholder={
                  form.aiProvider === "nvidia" ? "nvapi-..." :
                  form.aiProvider === "groq"   ? "gsk_..." :
                  "AIzaSy…"
                }
                value={form.aiApiKey ?? ""}
                onChange={onChange}
                required
                autoComplete="off"
              />
            </div>
            {/* Model field — shown for Groq and NVIDIA */}
            {(form.aiProvider === "groq" || form.aiProvider === "nvidia") && (
              <div>
                <label className="label">Model</label>
                <input
                  className="input"
                  name="aiModel"
                  placeholder={
                    form.aiProvider === "groq"
                      ? "llama-3.3-70b-versatile"
                      : "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
                  }
                  value={form.aiModel ?? ""}
                  onChange={onChange}
                />
              </div>
            )}
            {/* Base URL — only for NVIDIA (Groq URL is fixed) */}
            {form.aiProvider === "nvidia" && (
              <div>
                <label className="label">Base URL</label>
                <input className="input" name="aiBaseUrl" value={form.aiBaseUrl ?? ""} onChange={onChange} />
              </div>
            )}
            {process.env.NEXT_PUBLIC_GEMINI_API_KEY && (
              <p style={{ fontSize: 12, color: "var(--success)", fontFamily: "var(--font-space-mono), monospace" }}>
                ✓ Gemini API key pre-loaded from environment
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 28, fontSize: 15, padding: "14px 0" }}
          >
            {loading ? "Saving…" : "Create Profile →"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "var(--muted)" }}>
          Already have a profile?{" "}
          <a href="/login" style={{ color: "var(--fg)", fontWeight: 600 }}>Sign in</a>
        </p>
      </div>
    </div>
  );
}
