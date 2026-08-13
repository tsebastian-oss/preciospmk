import { NextResponse } from "next/server";
export async function GET(){ return NextResponse.json({ source: "clickhouse", status: "initializing" }); }
