import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Check if this is OTP verification or OTP send
    const isVerification = !!body.otp;

    // Read webhook URLs from server-side environment variables
    const webhookUrl = isVerification
      ? process.env.VERIFY_OTP_WEBHOOK_URL
      : process.env.OTP_WEBHOOK_URL;

    if (!webhookUrl) {
      return NextResponse.json(
        {
          success: false,
          message: "Webhook URL is not configured.",
        },
        { status: 500 }
      );
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          message: "Webhook rejected the request.",
        },
        { status: response.status }
      );
    }

    const rawText = await response.text();
    let data: any = {};

    try {
      data = JSON.parse(rawText);
    } catch {
      const lines = rawText.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);

          if (parsed.type === "item" && parsed.content) {
            try {
              data = JSON.parse(parsed.content);
            } catch {
              data = { message: parsed.content };
            }
            break;
          }
        } catch {}
      }
    }

    if (isVerification) {
      const verified =
        data?.success === true || data?.verified === true;

      if (!verified) {
        return NextResponse.json(
          {
            success: false,
            message: "Invalid or expired OTP",
          },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(data);
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