import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "El alta de cuentas es gestionada directamente por MGP." },
    { status: 403 }
  );
}
