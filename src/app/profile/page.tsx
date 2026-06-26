"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { getUser, saveUser, clearAllData } from "@/lib/db";
import type { UserProfile, AIProvider } from "@/lib/db";

const FIELDS = [
  { name: "name", label: "Name", type: "text" },
  { name: "age", label: "Age", type: "number" },
  { name: "monthlyIncome", label: "Monthly Income (₹)", type: "number" },
  { name: "savingsGoal", label: "Savings Goal (₹)", type: "number" },
  { name: "investmentGoal", label: "Investment Goal (₹)", type: "number" },
];

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [settingUpBio, setSettingUpBio] = useState(false);
  const [bioSetupSuccess, setBioSetupSuccess] = useState<string | null>(null);

  useEffect(() => {
    getUser().then((u) => {
      if (!u) { router.replace("/signup"); return; }
      setUser(u);
      setForm({
        name: u.name,
        age: String(u.age),
        monthlyIncome: String(u.monthlyIncome),
        savingsGoal: String(u.savingsGoal),
        investmentGoal: String(u.investmentGoal),
        geminiKey: u.geminiKey,
        aiProvider: u.aiProvider || "groq",
        aiApiKey:
          u.aiApiKey ||
          (u.aiProvider === 'groq'
            ? process.env.NEXT_PUBLIC_GROQ_API_KEY
            : u.aiProvider === 'nvidia'
              ? process.env.NEXT_PUBLIC_NVIDIA_API_KEY
              : process.env.NEXT_PUBLIC_GEMINI_API_KEY) || "",
        aiBaseUrl: u.aiBaseUrl || "",
        aiModel:
          u.aiModel ||
          (u.aiProvider === 'groq'
            ? (process.env.NEXT_PUBLIC_GROQ_MODEL || 'llama-3.3-70b-versatile')
            : u.aiProvider === 'nvidia'
              ? (process.env.NEXT_PUBLIC_NVIDIA_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning')
              : '') || "",
        newPassword: "",
      });
      import("@/lib/auth").then(({ isBiometricAvailable }) => {
        isBiometricAvailable().then(setBiometricAvailable);
      });
      setLoading(false);
    });
  }, [router]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((p) => {
      const next = { ...p, [name]: value };
      if (name === 'aiProvider') {
        if (value === 'groq') {
          next.aiApiKey  = process.env.NEXT_PUBLIC_GROQ_API_KEY  ?? p.aiApiKey;
          next.aiModel   = process.env.NEXT_PUBLIC_GROQ_MODEL    ?? 'llama-3.3-70b-versatile';
          next.aiBaseUrl = '';
        } else if (value === 'nvidia') {
          next.aiApiKey  = process.env.NEXT_PUBLIC_NVIDIA_API_KEY  ?? p.aiApiKey;
          next.aiModel   = process.env.NEXT_PUBLIC_NVIDIA_MODEL    ?? 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
          next.aiBaseUrl = process.env.NEXT_PUBLIC_NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';
        } else {
          next.aiApiKey  = process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? p.aiApiKey;
          next.aiModel   = '';
          next.aiBaseUrl = '';
        }
      }
      return next;
    });
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    let newPasswordHash = user.passwordHash;
    if (form.newPassword) {
      const { hashPassword } = await import("@/lib/auth");
      newPasswordHash = await hashPassword(form.newPassword);
    }

    const updated: UserProfile = {
      ...user,
      name: form.name,
      age: Number(form.age),
      monthlyIncome: Number(form.monthlyIncome),
      savingsGoal: Number(form.savingsGoal),
      investmentGoal: Number(form.investmentGoal),
      geminiKey: form.geminiKey,
      aiProvider: (form.aiProvider as AIProvider) || "groq",
      aiApiKey: form.aiApiKey || "",
      aiBaseUrl: form.aiBaseUrl || "",
      aiModel: form.aiModel || "",
      passwordHash: newPasswordHash,
    };
    await saveUser(updated);
    setUser(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const confirmClearData = async () => {
    setShowConfirmModal(false);
    await clearAllData();
    localStorage.removeItem("fintrack_session");
    router.replace("/signup");
  };

  const onLogout = () => {
    localStorage.setItem("fintrack_session", "logged_out");
    router.replace("/login");
  };

  const handleSetupBiometrics = async () => {
    if (!user) return;
    setSettingUpBio(true);
    setBioSetupSuccess(null);
    try {
      const { registerBiometric } = await import("@/lib/auth");
      const credId = await registerBiometric(user.id, user.name);
      if (credId) {
        const updated = { ...user, biometricCredentialId: credId };
        await saveUser(updated);
        setUser(updated);
        setBioSetupSuccess("Biometrics setup successfully!");
      } else {
        setBioSetupSuccess("Setup was cancelled or failed.");
      }
    } catch (err) {
      console.error(err);
      setBioSetupSuccess("Failed to setup biometrics.");
    } finally {
      setSettingUpBio(false);
      setTimeout(() => setBioSetupSuccess(null), 3000);
    }
  };

  if (loading) {
    return (
      <>
        <Nav />
        <div style={{ padding: 48, textAlign: "center", color: "var(--muted)", fontFamily: "Space Mono, monospace" }}>Loading…</div>
      </>
    );
  }

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 560, margin: "48px auto", padding: "0 24px" }} className="fade-in">
        <p style={{ fontFamily: "Space Mono, monospace", fontSize: 12, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Settings
        </p>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 4, marginBottom: 24 }}>Your Profile</h1>

        {user && (
          <div className="card-flat" style={{ padding: "12px 16px", marginBottom: 24, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 40, height: 40, background: "var(--fg)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }}>
              {user.name[0].toUpperCase()}
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 16 }}>{user.name}</p>
              <p style={{ fontSize: 12, color: "var(--muted)", fontFamily: "Space Mono, monospace" }}>
                Member since {new Date(user.createdAt).toLocaleDateString("en-IN")}
              </p>
            </div>
          </div>
        )}

        <form onSubmit={onSave} className="card" style={{ padding: 28 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {FIELDS.map((f) => (
              <div key={f.name}>
                <label className="label">{f.label}</label>
                <input
                  className="input"
                  name={f.name}
                  type={f.type}
                  value={form[f.name] ?? ""}
                  onChange={onChange}
                  required
                />
              </div>
            ))}
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
              />
            </div>
            {/* Model field — Groq and NVIDIA */}
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
            {/* Base URL — NVIDIA only */}
            {form.aiProvider === "nvidia" && (
              <div>
                <label className="label">Base URL</label>
                <input className="input" name="aiBaseUrl" value={form.aiBaseUrl ?? ""} onChange={onChange} />
              </div>
            )}
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 24, padding: "14px 0" }}
          >
            {saved ? "✓ Saved!" : "Save Profile"}
          </button>
        </form>

        <div className="card" style={{ padding: 24, marginTop: 24 }}>
          <p className="label">Authentication</p>
          <div style={{ marginTop: 16 }}>
            <label className="label">Change Password</label>
            <input
              className="input"
              name="newPassword"
              type="password"
              placeholder="Enter a new password"
              value={form.newPassword ?? ""}
              onChange={onChange}
            />
            <button
               className="btn btn-primary"
               onClick={onSave}
               style={{ marginTop: 12, fontSize: 13, padding: "8px 16px" }}
               disabled={!form.newPassword}
            >
               Update Password
            </button>
          </div>
          
          {biometricAvailable && (
            <div style={{ marginTop: 24 }}>
              <label className="label">Biometric Login</label>
              <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
                Setup Touch ID, Face ID, or Windows Hello for faster, passwordless logins.
              </p>
              <button
                className="btn btn-outline"
                style={{ fontSize: 13, padding: "8px 16px" }}
                onClick={handleSetupBiometrics}
                disabled={settingUpBio}
              >
                {settingUpBio ? "Setting up..." : user?.biometricCredentialId ? "Re-register Biometrics" : "Setup Biometrics"}
              </button>
              {bioSetupSuccess && (
                <p style={{ fontSize: 12, color: user?.biometricCredentialId ? "var(--success)" : "var(--danger)", marginTop: 8 }}>
                  {bioSetupSuccess}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 24, marginTop: 24 }}>
          <p className="label">Account Actions</p>
          <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 8, marginBottom: 16 }}>
            Sign out of your active browser session. Your local transaction data will remain saved.
          </p>
          <button className="btn btn-outline" onClick={onLogout}>
            Logout Session
          </button>
        </div>

        <div className="card" style={{ padding: 24, marginTop: 24, borderColor: "var(--danger)", boxShadow: "4px 4px 0 var(--danger)" }}>
          <p className="label" style={{ color: "var(--danger)" }}>Danger Zone</p>
          <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 8, marginBottom: 16 }}>
            Permanently delete all your data, including your profile, all transactions, and insights.
          </p>
          <button className="btn btn-outline" style={{ borderColor: "var(--danger)", color: "var(--danger)" }} onClick={() => setShowConfirmModal(true)}>
            Delete All Data
          </button>
        </div>
      </main>

      {/* Custom Confirmation Modal */}
      {showConfirmModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2000,
        }} className="fade-in">
          <div className="card" style={{
            maxWidth: 400,
            padding: 32,
            background: "#fff",
            textAlign: "center",
            boxShadow: "8px 8px 0 var(--danger)",
            borderColor: "var(--danger)",
          }}>
            <p style={{ fontSize: 36 }}>⚠️</p>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 12, color: "var(--danger)" }}>
              Delete All Data?
            </h2>
            <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
              This will permanently delete all your transaction history, monthly insights, and user profile details. This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "center" }}>
              <button
                className="btn btn-outline"
                onClick={() => setShowConfirmModal(false)}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={confirmClearData}
                style={{ flex: 1, background: "var(--danger)", borderColor: "var(--danger)" }}
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
