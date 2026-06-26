"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { getUser, saveTransactions, saveInsight } from "@/lib/db";
import { extractText } from "@/lib/ocr";
import { analyzeStatement } from "@/lib/gemini";
import type { UserProfile } from "@/lib/db";

type Step = "idle" | "extracting" | "analyzing" | "done" | "error";

export default function UploadPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState("");
  const [extractedText, setExtractedText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getUser().then((u) => {
      if (!u) router.replace("/signup");
      else setUser(u);
    });
  }, [router]);

  const processFile = useCallback(
    async (file: File) => {
      if (!user) return;
      setErrorMsg("");
      setExtractedText("");

      // Validate file size (20 MB max)
      if (file.size > 20 * 1024 * 1024) {
        setStep("error");
        setErrorMsg("File is too large. Please upload a file under 20 MB.");
        return;
      }

      // Validate file type
      const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
      if (!allowed.includes(file.type)) {
        setStep("error");
        setErrorMsg("Unsupported file type. Please upload a PDF, PNG, JPEG, or WEBP.");
        return;
      }

      try {
        // ── Step 1: Extract text ──────────────────────────────────────────────
        setStep("extracting");
        setProgress(
          file.type === "application/pdf"
            ? `📄 Reading PDF pages from "${file.name}"…`
            : `🔍 Running OCR on "${file.name}"…`
        );

        const rawText = await extractText(file);

        if (!rawText.trim()) {
          throw new Error(
            file.type === "application/pdf"
              ? "No text was found in this PDF. It may be a scanned image-only PDF. Try uploading a screenshot or image instead."
              : "Could not extract any text from this image. Try a clearer scan or higher resolution."
          );
        }

        setExtractedText(rawText);
        setProgress(`✓ Extracted ${rawText.length.toLocaleString()} characters of text. Sending to AI…`);

        // ── Step 2: Analyze with AI ───────────────────────────────────────────
        setStep("analyzing");
        const providerLabel =
          (user.aiProvider || "gemini") === "nvidia" ? "NVIDIA AI" : "Gemini AI";
        setProgress(`🤖 ${providerLabel} is analyzing your statement…`);

        const userContext = `Name: ${user.name}, Age: ${user.age}, Monthly Income: ₹${user.monthlyIncome}, Savings Goal: ₹${user.savingsGoal}, Investment Goal: ₹${user.investmentGoal}`;
        const result = await analyzeStatement(
          rawText,
          user.aiApiKey || user.geminiKey,
          userContext,
          user.aiProvider || "gemini",
          user.aiBaseUrl,
          user.aiModel
        );

        // ── Step 3: Save results ──────────────────────────────────────────────
        await saveTransactions(result.transactions);
        await saveInsight(result.insight);

        setStep("done");
        setProgress(`✅ Found ${result.transactions.length} transactions. Redirecting to dashboard…`);
        setTimeout(() => router.push("/dashboard"), 2000);
      } catch (err: any) {
        setStep("error");
        let msg: string = err?.message ?? "Something went wrong.";

        // Friendly error messages for common failures
        if (msg.includes("503") || msg.includes("demand") || msg.includes("UNAVAILABLE")) {
          msg =
            "The AI model is under high demand right now. Please wait a moment and try again.";
        } else if (
          msg.includes("API_KEY_INVALID") ||
          msg.toLowerCase().includes("expired") ||
          msg.toLowerCase().includes("api key not valid") ||
          msg.toLowerCase().includes("billing") ||
          msg.toLowerCase().includes("quota")
        ) {
          msg =
            "Your API key has expired or hit its quota limit. Please update your key in the Profile settings.";
        } else if (
          msg.toLowerCase().includes("failed to load pdf") ||
          msg.toLowerCase().includes("invalid pdf") ||
          msg.toLowerCase().includes("password")
        ) {
          msg = msg; // Already user-friendly from our extractor
        } else if (msg.toLowerCase().includes("no json")) {
          msg =
            "The AI returned an unexpected response. The statement text may be too short or unclear. Try a different file.";
        }

        setErrorMsg(msg);
      }
    },
    [user, router]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input so the same file can be re-uploaded after an error
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const reset = () => {
    setStep("idle");
    setProgress("");
    setErrorMsg("");
    setExtractedText("");
  };

  const busy = step === "extracting" || step === "analyzing";

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 640, margin: "48px auto", padding: "0 24px" }} className="fade-in">
        <p
          style={{
            fontFamily: "Space Mono, monospace",
            fontSize: 12,
            color: "var(--accent)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Upload
        </p>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 4, marginBottom: 8 }}>
          Upload Bank Statement
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 15, marginBottom: 32, lineHeight: 1.6 }}>
          Drop a PDF or screenshot of your bank statement. Text is extracted locally (PDF.js / Tesseract),
          then sent to your AI for categorization.
        </p>

        {/* Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !busy && inputRef.current?.click()}
          className="card"
          style={{
            padding: "64px 24px",
            textAlign: "center",
            cursor: busy ? "not-allowed" : "pointer",
            borderStyle: "dashed",
            borderWidth: 3,
            background: dragging ? "var(--hover)" : undefined,
            transition: "background 0.15s",
            userSelect: "none",
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={onFileChange}
            disabled={busy}
          />
          <p style={{ fontSize: 48 }}>
            {step === "done" ? "✅" : step === "error" ? "❌" : busy ? "⏳" : "📤"}
          </p>
          <p
            style={{
              fontFamily: "Space Mono, monospace",
              fontSize: 15,
              fontWeight: 700,
              marginTop: 16,
            }}
          >
            {busy ? "Processing…" : step === "done" ? "Done!" : "Click or drop file here"}
          </p>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
            Supports PDF, PNG, JPEG, WEBP · Max 20 MB
          </p>
        </div>

        {/* Progress */}
        {progress && (
          <div
            className="card-flat fade-in"
            style={{
              marginTop: 20,
              padding: "16px 20px",
              fontFamily: "Space Mono, monospace",
              fontSize: 13,
              color: step === "done" ? "var(--success)" : "var(--fg)",
            }}
          >
            {progress}
          </div>
        )}

        {/* Error */}
        {step === "error" && errorMsg && (
          <div
            className="card-flat fade-in"
            style={{
              marginTop: 16,
              padding: "16px 20px",
              borderColor: "var(--danger)",
              background: "rgba(239,68,68,0.07)",
            }}
          >
            <p
              style={{
                fontFamily: "Space Mono, monospace",
                fontSize: 13,
                color: "var(--danger)",
                fontWeight: 700,
              }}
            >
              ✕ Error
            </p>
            <p style={{ fontSize: 13, color: "var(--fg)", marginTop: 6, lineHeight: 1.5 }}>
              {errorMsg}
            </p>
            <button
              className="btn btn-outline"
              style={{ marginTop: 12, fontSize: 13 }}
              onClick={reset}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Extracted text preview (debug help) */}
        {extractedText && step === "analyzing" && (
          <details style={{ marginTop: 16 }}>
            <summary
              style={{
                fontFamily: "Space Mono, monospace",
                fontSize: 12,
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              Preview extracted text ({extractedText.length.toLocaleString()} chars)
            </summary>
            <pre
              style={{
                marginTop: 8,
                padding: "12px 16px",
                background: "var(--surface)",
                borderRadius: 8,
                fontSize: 11,
                lineHeight: 1.6,
                overflow: "auto",
                maxHeight: 200,
                whiteSpace: "pre-wrap",
                color: "var(--muted)",
              }}
            >
              {extractedText.slice(0, 1500)}
              {extractedText.length > 1500 ? "\n…" : ""}
            </pre>
          </details>
        )}

        {/* How it works */}
        <div className="card" style={{ padding: 24, marginTop: 32 }}>
          <p className="label" style={{ marginBottom: 12 }}>
            How it works
          </p>
          {[
            ["1", "Upload PDF or image of your bank statement"],
            ["2", "PDF.js reads the text layer · Tesseract runs OCR on images"],
            ["3", "Extracted text is sent to your AI (Gemini / NVIDIA) for analysis"],
            ["4", "Transactions are categorized and saved locally in your browser"],
          ].map(([n, text]) => (
            <div key={n} style={{ display: "flex", gap: 12, marginBottom: 10 }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  background: "var(--fg)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontFamily: "Space Mono, monospace",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {n}
              </span>
              <span style={{ fontSize: 14, paddingTop: 3 }}>{text}</span>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
