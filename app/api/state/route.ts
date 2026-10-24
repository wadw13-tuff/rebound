import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/db";
import { getState, runAction, withUserLock } from "@/lib/service";
import { actionSchema, dateSchema } from "@/lib/validation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  try {
    const today = dateSchema.parse(
      req.nextUrl.searchParams.get("today") ??
        new Date().toISOString().slice(0, 10),
    );
    const user = await currentUser();
    const state = await withUserLock(user.id, () =>
      getState(user.id, today, true),
    );
    return NextResponse.json(state, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Your plan could not be loaded; please try again." },
      { status: 500 },
    );
  }
}
export async function POST(req: NextRequest) {
  try {
    const input = actionSchema.safeParse(await req.json());
    if (!input.success)
      return NextResponse.json(
        { error: input.error.issues[0]?.message ?? "Check your entries." },
        { status: 400 },
      );
    const user = await currentUser();
    const state = await withUserLock(user.id, () =>
      runAction(user.id, input.data),
    );
    return NextResponse.json(state, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "This change could not be saved; please try again.",
      },
      { status: 400 },
    );
  }
}
