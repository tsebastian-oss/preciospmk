import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "Endpoint deshabilitado" }, { status: 410 });
}
