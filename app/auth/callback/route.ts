import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next") ?? "/onboarding";
  let next = "/onboarding";
  if (requestedNext.startsWith("/") && !requestedNext.startsWith("//")) {
    const candidate = new URL(requestedNext, url.origin);
    // Check the resolved origin too: URL parsers treat backslashes like slashes
    // for HTTPS URLs, so a value such as /\\evil.example could escape the site.
    if (candidate.origin === url.origin) {
      next = `${candidate.pathname}${candidate.search}${candidate.hash}`;
    }
  }

  if (code) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.redirect(new URL("/login?error=configuration", url.origin));
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

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
  }

  return NextResponse.redirect(new URL("/login?error=confirmation", url.origin));
}
