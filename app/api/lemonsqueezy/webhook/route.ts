import { NextResponse } from "next/server";
import { processLemonEvent, verifyLemonSignature } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim();
  const signature = request.headers.get("x-signature")?.trim();
  if (!secret || !signature)
    return new Response("Webhook is not configured.", { status: 400 });
  try {
    const body = await request.text();
    if (!body || !verifyLemonSignature(body, signature, secret))
      return new Response("Invalid signature.", { status: 400 });
    await processLemonEvent(JSON.parse(body));
    return new Response("ok", { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Webhook processing failed." },
      { status: 500 },
    );
  }
}
