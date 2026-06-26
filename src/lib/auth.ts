/**
 * Client-side auth utilities.
 * All operations run in the browser.
 * OTP requests are proxied through /api/otp so webhook URLs remain hidden.
 */

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// OTP
// ─────────────────────────────────────────────────────────────────────────────

export async function sendEmailOtp(
  email: string
): Promise<{
  ok: boolean;
  message?: string;
  otp?: string;
  expiresAt?: number;
}> {
  if (!isValidEmail(email)) {
    return {
      ok: false,
      message: "Please enter a valid email address.",
    };
  }

  try {
    const response = await fetch("/api/otp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
      }),
    });

    const data = await response.json().catch(() => null);

    const success =
      response.ok &&
      data &&
      (data.success === true ||
        data.status === "success" ||
        data.otp);

    return {
      ok: !!success,
      otp: data?.otp ? String(data.otp) : undefined,
      expiresAt: data?.expiresAt
        ? Number(data.expiresAt)
        : undefined,
      message: success
        ? undefined
        : data?.message ||
          "Unable to send OTP right now. Please try again.",
    };
  } catch (error) {
    console.error("OTP send failed:", error);

    return {
      ok: false,
      message: "Unable to send OTP right now. Please try again.",
    };
  }
}

export async function verifyEmailOtp(
  email: string,
  otp: string
): Promise<{
  ok: boolean;
  message?: string;
}> {
  if (!isValidEmail(email)) {
    return {
      ok: false,
      message: "Please enter a valid email address.",
    };
  }

  if (!/^\d{6}$/.test(otp.trim())) {
    return {
      ok: false,
      message: "Enter the 6-digit OTP.",
    };
  }

  try {
    const response = await fetch("/api/otp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
      }),
    });

    const data = await response.json().catch(() => null);

    const success =
      response.ok &&
      data &&
      (data.success === true ||
        data.verified === true);

    return {
      ok: success,
      message: success
        ? undefined
        : data?.message || "Invalid or expired OTP.",
    };
  } catch (error) {
    console.error("OTP verification failed:", error);

    return {
      ok: false,
      message: "Invalid or expired OTP.",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Password
// ─────────────────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);

  const buffer = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  const computed = await hashPassword(password);

  if (computed.length !== hash.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  }

  return diff === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Biometrics (WebAuthn)
// ─────────────────────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  if (!window.PublicKeyCredential) {
    return false;
  }

  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function registerBiometric(
  userId: string,
  userName: string
): Promise<string | null> {
  if (!window.PublicKeyCredential) {
    return null;
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const userIdBytes = new TextEncoder().encode(userId);

  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: "FinTrack AI",
          id: window.location.hostname,
        },
        user: {
          id: userIdBytes,
          name: userName,
          displayName: userName,
        },
        pubKeyCredParams: [
          {
            alg: -7,
            type: "public-key",
          },
          {
            alg: -257,
            type: "public-key",
          },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required",
        },
        timeout: 60000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;

    if (!credential) {
      return null;
    }

    return toBase64(new Uint8Array(credential.rawId));
  } catch (error) {
    console.error("Biometric registration failed:", error);

    return null;
  }
}

export async function verifyBiometric(
  credentialIdBase64: string
): Promise<boolean> {
  if (!window.PublicKeyCredential) {
    return false;
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credentialId = fromBase64(credentialIdBase64);

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id: credentialId as BufferSource,
            type: "public-key",
            transports: ["internal"],
          },
        ],
        userVerification: "required",
        timeout: 60000,
      },
    });

    return !!assertion;
  } catch (error) {
    console.error("Biometric verification failed:", error);

    return false;
  }
}
