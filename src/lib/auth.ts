/**
 * Client-side auth utilities.
 * All operations run in the browser — no server involved.
 */

const OTP_WEBHOOK_URL = process.env.NEXT_PUBLIC_OTP_WEBHOOK_URL || 'https://hooks.zapier.com/hooks/catch/24767194/42iy2jm/';

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function sendEmailOtp(email: string): Promise<{ ok: boolean; message?: string; otp?: string; expiresAt?: number }> {
  if (!isValidEmail(email)) {
    return { ok: false, message: 'Please enter a valid email address.' };
  }

  try {
    const webhookUrl = (process.env.NEXT_PUBLIC_OTP_WEBHOOK_URL || '').trim().replace(/^["']|["']$/g, "");
    if (!webhookUrl) {
      return { ok: false, message: 'OTP webhook URL is not configured.' };
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });

    const data = await response.json().catch(() => null);
    
    // Check if the webhook responded successfully and returned otp/expiresAt.
    const success = response.ok && data && (data.success === true || data.status === 'success' || data.otp);

    return {
      ok: !!success,
      otp: data?.otp ? String(data.otp) : undefined,
      expiresAt: data?.expiresAt ? Number(data.expiresAt) : undefined,
      message: success ? undefined : (data?.message || 'Unable to send OTP right now. Please try again.'),
    };
  } catch (error) {
    console.error('OTP send failed:', error);
    return { ok: false, message: 'Unable to send OTP right now. Please try again.' };
  }
}

export async function verifyEmailOtp(email: string, otp: string): Promise<{ ok: boolean; message?: string }> {
  if (!isValidEmail(email)) {
    return { ok: false, message: 'Please enter a valid email address.' };
  }

  if (!/^\d{6}$/.test(otp.trim())) {
    return { ok: false, message: 'Enter the 6-digit OTP.' };
  }

  try {
    const response = await fetch('/api/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), otp: otp.trim() }),
    });

    const data = await response.json().catch(() => null);
    
    // Email is verified only if the webhook responds with success/verified as true
    const success = response.ok && data && (data.success === true || data.verified === true);

    return {
      ok: success,
      message: success ? undefined : (data?.message || 'Invalid or expired OTP.'),
    };
  } catch (error) {
    console.error('OTP verification failed:', error);
    return { ok: false, message: 'Invalid or expired OTP.' };
  }
}

// ── Password ─────────────────────────────────────────────────────────────────

/**
 * Hash a password using SHA-256 via the Web Crypto API.
 * Returns a hex string.
 */
export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time comparison of a plaintext password against a stored hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(password);
  // Compare character-by-character to avoid timing leaks (browser context)
  if (computed.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}

// ── WebAuthn / Biometrics ─────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Returns true if the current device has a platform authenticator
 * (TouchID, FaceID, Windows Hello, Android biometric, etc.).
 */
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Register a new biometric credential for the given user.
 * Returns a base64-encoded credential ID to persist in the user profile,
 * or null if registration was cancelled / failed.
 */
export async function registerBiometric(
  userId: string,
  userName: string
): Promise<string | null> {
  if (!window.PublicKeyCredential) return null;

  const challenge    = crypto.getRandomValues(new Uint8Array(32));
  const userIdBytes  = new TextEncoder().encode(userId);

  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'FinTrack',
          id: window.location.hostname,
        },
        user: {
          id:          userIdBytes,
          name:        userName,
          displayName: userName,
        },
        pubKeyCredParams: [
          { alg: -7,   type: 'public-key' }, // ES256
          { alg: -257, type: 'public-key' }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification:        'required',
          residentKey:             'preferred',
        },
        timeout:     60_000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    if (!cred) return null;
    return toBase64(new Uint8Array(cred.rawId));
  } catch (err) {
    console.error('Biometric registration failed:', err);
    return null;
  }
}

/**
 * Authenticate using a previously registered biometric credential.
 * Returns true if the user verified successfully.
 */
export async function verifyBiometric(credentialIdBase64: string): Promise<boolean> {
  if (!window.PublicKeyCredential) return false;

  const challenge    = crypto.getRandomValues(new Uint8Array(32));
  const credentialId = fromBase64(credentialIdBase64);

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id:         credentialId as unknown as BufferSource,
            type:       'public-key',
            transports: ['internal' as AuthenticatorTransport],
          },
        ],
        userVerification: 'required',
        timeout:          60_000,
      },
    });
    return !!assertion;
  } catch (err) {
    console.error('Biometric verification failed:', err);
    return false;
  }
}
