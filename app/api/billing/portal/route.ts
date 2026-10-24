import { NextResponse } from "next/server";
import { currentUser } from "@/lib/db";
import { createPortal } from "@/lib/billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST() {
  try {
    const user = await currentUser();
    const url = await createPortal(user.id);
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
            : "Billing management could not be opened.",
      },
      { status: 400 },
    );
  }
}
