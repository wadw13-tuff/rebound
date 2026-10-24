import { NextResponse } from "next/server";
import { currentUser } from "@/lib/db";
import { billingSummary } from "@/lib/billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await currentUser();
    return NextResponse.json(await billingSummary(user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Billing could not be loaded.",
      },
      { status: 500 },
    );
  }
}
