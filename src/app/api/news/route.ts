import { NextResponse } from "next/server";
import { CommunityStorageConfigError, getCommunityStore } from "@/lib/community/store";
import { NewsQueryError, NewsStatsUnavailable, parseNewsParams, queryNews } from "@/lib/news/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const result = await queryNews(parseNewsParams(new URL(req.url).searchParams), getCommunityStore());
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof NewsQueryError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    if (error instanceof NewsStatsUnavailable) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    const status = error instanceof CommunityStorageConfigError ? 503 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "News is unavailable.", code: "news_unavailable" }, { status });
  }
}
