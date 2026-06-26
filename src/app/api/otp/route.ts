import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Choose the webhook URL based on whether an OTP is being verified or sent
    const isVerification = !!body.otp;
    const defaultSendUrl = process.env.OTP_WEBHOOK_URL || "https://hooks.zapier.com/hooks/catch/24767194/42iy2jm/";
    const webhookUrl = isVerification
      ? (process.env.NEXT_PUBLIC_VERIFY_OTP_WEBHOOK_URL || defaultSendUrl)
      : (process.env.NEXT_PUBLIC_OTP_WEBHOOK_URL || defaultSendUrl);
    
    if (!webhookUrl) {
      return NextResponse.json(
        { success: false, message: "OTP Webhook URL is not configured." },
        { status: 500 }
      );
    }

    // Strip double or single quotes from the webhook URL (safety for .env.local values)
    const cleanedUrl = webhookUrl.trim().replace(/^["']|["']$/g, "");

    const response = await fetch(cleanedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(`Webhook responded with status: ${response.status}`);
      let errorMessage = "Webhook rejected the request.";
      try {
        const errText = await response.text();
        const errData = JSON.parse(errText);
        if (errData && errData.message) {
          errorMessage = errData.message;
        } else if (typeof errData === "string") {
          errorMessage = errData;
        }
      } catch {
        // Fallback for parsing errors
      }
      return NextResponse.json(
        { success: false, message: errorMessage },
        { status: response.status }
      );
    }

    const rawText = await response.text();
    let data: any = {};
    
    try {
      data = JSON.parse(rawText);
    } catch {
      // Handle potential n8n NDJSON / stream format response
      const lines = rawText.split("\n").filter(line => line.trim());
      for (const line of lines) {
        try {
          const parsedLine = JSON.parse(line);
          if (parsedLine.type === "item" && parsedLine.content) {
            try {
              data = JSON.parse(parsedLine.content);
              break;
            } catch {
              data = { message: parsedLine.content };
            }
          }
        } catch {
          // ignore individual line parse errors
        }
      }
    }

    // For verification, ensure we only succeed if the webhook explicitly confirmed success
    if (isVerification) {
      const isOk = data && (data.success === true || data.verified === true);
      if (!isOk) {
        return NextResponse.json(
          { success: false, message: "Invalid or expired OTP" },
          { status: 400 }
        );
      }
    }

    // Return raw webhook parsed response data
    return NextResponse.json({ ...data });
    
  } catch (error) {
    console.error("API OTP Error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to process the request." },
      { status: 500 }
    );
  }
}

