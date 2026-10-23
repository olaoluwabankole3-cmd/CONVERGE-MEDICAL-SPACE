import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const allowedNext = new Set(["/accept-invite", "/reset-password", "/onboarding", "/overview"]);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const requestedType = url.searchParams.get("type") ?? "";
  const nextValue = url.searchParams.get("next") ?? "/overview";
  const next = allowedNext.has(nextValue) ? nextValue : "/overview";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.redirect(new URL("/login?error=configuration", url.origin));
  }

  if (!tokenHash || !["invite", "recovery", "email"].includes(requestedType)) {
    return NextResponse.redirect(new URL("/login?error=confirmation", url.origin));
  }

  const response = NextResponse.redirect(new URL(next, url.origin));
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: requestedType as EmailOtpType,
  });
  if (error) {
    return NextResponse.redirect(new URL("/login?error=confirmation", url.origin));
  }

  return response;
}
