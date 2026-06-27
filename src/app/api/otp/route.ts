import { NextRequest, NextResponse } from "next/server";

const cleanValue = (value: string | undefined) =>
  !value
    ? undefined
    : value.trim().replace(/^['"]|['"]$/g, "") || undefined;

const normalizeUrl = (value: string | undefined) => {
  const cleaned = cleanValue(value);
  if (!cleaned) return undefined;

  try {
    return new URL(cleaned).toString();
  } catch {
    return undefined;
  }
};

const getWebhookUrl = (names: string[]) => {
  for (const name of names) {
    const normalized = normalizeUrl(process.env[name]);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
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

    const fallbackSendUrl =
      process.env.OTP_WEBHOOK_URL || process.env.NEXT_PUBLIC_OTP_WEBHOOK_URL;
    const fallbackVerifyUrl =
      process.env.VERIFY_OTP_WEBHOOK_URL ||
      process.env.NEXT_PUBLIC_VERIFY_OTP_WEBHOOK_URL ||
      fallbackSendUrl;

    const webhookUrl = getWebhookUrl(
      isVerification
        ? [
            "VERIFY_OTP_WEBHOOK_URL",
            "OTP_WEBHOOK_URL",
            "NEXT_PUBLIC_VERIFY_OTP_WEBHOOK_URL",
            "NEXT_PUBLIC_OTP_WEBHOOK_URL",
          ]
        : [
            "OTP_WEBHOOK_URL",
            "VERIFY_OTP_WEBHOOK_URL",
            "NEXT_PUBLIC_OTP_WEBHOOK_URL",
            "NEXT_PUBLIC_VERIFY_OTP_WEBHOOK_URL",
          ]
    );

    if (!webhookUrl) {
      return errorResponse("OTP webhook URL is not configured.", 500);
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

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

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
        message: "Failed to process the request.",
      },
      { status: 500 }
    );
  }
}