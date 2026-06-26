import { NextRequest, NextResponse } from 'next/server';

const NVIDIA_BASE_URL = process.env.NEXT_PUBLIC_NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const NVIDIA_API_KEY  = process.env.NEXT_PUBLIC_NVIDIA_API_KEY  || '';

const GROQ_BASE_URL   = 'https://api.groq.com/openai/v1';
const GROQ_API_KEY    = process.env.NEXT_PUBLIC_GROQ_API_KEY    || '';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Determine provider — defaults to 'nvidia' for backwards compat
    const provider: 'nvidia' | 'groq' = body?.provider === 'groq' ? 'groq' : 'nvidia';

    // Use caller-supplied key first, fall back to env
    const apiKey =
      (typeof body?.apiKey === 'string' && body.apiKey.trim()
        ? body.apiKey.trim()
        : provider === 'groq'
          ? GROQ_API_KEY
          : NVIDIA_API_KEY);

    if (!apiKey) {
      return NextResponse.json(
        { error: `${provider === 'groq' ? 'Groq' : 'NVIDIA'} API key is not configured.` },
        { status: 500 }
      );
    }

    const baseUrl = provider === 'groq' ? GROQ_BASE_URL : NVIDIA_BASE_URL;

    // Strip internal-only fields before forwarding
    const { provider: _p, apiKey: _k, ...forwardBody } = body;

    // Pick the model — use what was sent or env defaults
    const model =
      typeof forwardBody?.model === 'string' && forwardBody.model.trim()
        ? forwardBody.model.trim()
        : provider === 'groq'
          ? (process.env.NEXT_PUBLIC_GROQ_MODEL || 'llama-3.3-70b-versatile')
          : (process.env.NEXT_PUBLIC_NVIDIA_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({ ...forwardBody, model }),
      });

      const data = await res.text();
      return new NextResponse(data, {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: any) {
    console.error('AI proxy request failed', error);
    return NextResponse.json(
      {
        error:
          error?.name === 'AbortError'
            ? 'AI request timed out.'
            : (error?.message || 'Failed to process AI request.'),
      },
      { status: 502 }
    );
  }
}
