import { NextResponse } from "next/server";
import { currentUser } from "@/lib/db";
import { createCheckout } from "@/lib/billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    const url = await createCheckout(user.id, user.name, request);
    return NextResponse.json(
      { url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Checkout could not be started.",
      },
      { status: 400 },
    );
  }
}
