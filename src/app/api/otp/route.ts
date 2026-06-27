import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const cleanValue = (value: string | undefined) =>
  !value
    ? undefined
    : value.trim().replace(/^['"]|['"]$/g, "") || undefined;

const normalizeUrl = (value: string | undefined, name: string) => {
  const cleaned = cleanValue(value);
  if (!cleaned) return undefined;

  try {
    const url = new URL(cleaned);
    const isLocalUrl =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "0.0.0.0" ||
      url.hostname.endsWith(".local");

    if (process.env.VERCEL && isLocalUrl) {
      throw new Error(`${name} must be a public HTTPS webhook URL in Vercel.`);
    }

    if (process.env.VERCEL && url.protocol !== "https:") {
      throw new Error(`${name} must use HTTPS in Vercel.`);
    }

    return url.toString();
  } catch {
    throw new Error(`${name} is not a valid webhook URL.`);
  }
};

const getWebhookUrl = (isVerification: boolean) => {
  const urls: Array<[string, string | undefined]> = isVerification
    ? [
        ["VERIFY_OTP_WEBHOOK_URL", process.env.VERIFY_OTP_WEBHOOK_URL],
        ["OTP_WEBHOOK_URL", process.env.OTP_WEBHOOK_URL],
        [
          "NEXT_PUBLIC_VERIFY_OTP_WEBHOOK_URL",
          process.env.NEXT_PUBLIC_VERIFY_OTP_WEBHOOK_URL,
        ],
        ["NEXT_PUBLIC_OTP_WEBHOOK_URL", process.env.NEXT_PUBLIC_OTP_WEBHOOK_URL],
      ]
    : [
        ["OTP_WEBHOOK_URL", process.env.OTP_WEBHOOK_URL],
        ["VERIFY_OTP_WEBHOOK_URL", process.env.VERIFY_OTP_WEBHOOK_URL],
        ["NEXT_PUBLIC_OTP_WEBHOOK_URL", process.env.NEXT_PUBLIC_OTP_WEBHOOK_URL],
        [
          "NEXT_PUBLIC_VERIFY_OTP_WEBHOOK_URL",
          process.env.NEXT_PUBLIC_VERIFY_OTP_WEBHOOK_URL,
        ],
      ];

  const configured = urls.find(([, value]) => cleanValue(value));
  if (!configured) return undefined;

  const [name, value] = configured;
  return normalizeUrl(value, name);
};

const parseWebhookResponse = (rawText: string) => {
  if (!rawText) return {};

  try {
    return JSON.parse(rawText);
  } catch {
    const lines = rawText.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed?.type === "item" && parsed?.content) {
          try {
            return JSON.parse(parsed.content);
          } catch {
            return { message: parsed.content };
          }
        }
      } catch {
        continue;
      }
    }
  }

  return { message: rawText };
};

const errorResponse = (message: string, status = 500) =>
  NextResponse.json({ success: false, message }, { status });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Check if this is OTP verification or OTP send
    const isVerification = !!body.otp;

    const webhookUrl = getWebhookUrl(isVerification);

    if (!webhookUrl) {
      return errorResponse(
        "OTP webhook URL is not configured. Add OTP_WEBHOOK_URL or NEXT_PUBLIC_OTP_WEBHOOK_URL to Vercel Production environment variables.",
        500
      );
    }

    const email = String(body?.email ?? "").trim().toLowerCase();
    const otp = String(body?.otp ?? "").trim();
    if (!email) {
      return errorResponse("Email is required.", 400);
    }
    if (isVerification && !/^\d{6}$/.test(otp)) {
      return errorResponse("OTP must be a 6-digit code.", 400);
    }

    const payload: Record<string, unknown> = { email };
    if (isVerification) payload.otp = otp;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let response: Response;

    try {
      response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "OTP webhook timed out from Vercel. Check that the webhook is active and responds within 25 seconds."
          : "Vercel could not reach the OTP webhook. Check the production webhook URL and provider access rules.";

      console.error("OTP webhook fetch failed:", {
        webhookUrl,
        message,
        error,
      });

      return errorResponse(message, 502);
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await response.text();
    const data = parseWebhookResponse(rawText);

    if (!response.ok) {
      const message =
        data?.message ||
        data?.error ||
        `Webhook rejected the request with status ${response.status}.`;

      console.error("OTP webhook response error:", {
        status: response.status,
        webhookUrl,
        payload,
        message,
        rawText,
      });

      return errorResponse(message, response.status);
    }

    if (isVerification) {
      const verified = data?.success === true || data?.verified === true;
      if (!verified) {
        return errorResponse(data?.message || "Invalid or expired OTP", 400);
      }
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("OTP API Error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to process the request.",
      },
      { status: 500 }
    );
  }
}
