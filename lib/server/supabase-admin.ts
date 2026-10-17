import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export function getAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type AuthenticatedAdminContext =
  | { user: User; admin: SupabaseClient }
  | { response: NextResponse };

export async function getAuthenticatedAdminContext(): Promise<AuthenticatedAdminContext> {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !publicKey || !serviceKey) {
    return {
      response: NextResponse.json(
        { error: "The secure request service is not configured." },
        { status: 503 },
      ),
    };
  }

  const session = createServerClient(url, publicKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: values => {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Cookies cannot be written from every server-rendering context.
        }
      },
    },
  });

  const { data, error } = await session.auth.getUser();
  if (error || !data.user) {
    return {
      response: NextResponse.json({ error: "Sign in to continue." }, { status: 401 }),
    };
  }

  const admin = getAdminClient();
  if (!admin) {
    return {
      response: NextResponse.json(
        { error: "The secure request service is not configured." },
        { status: 503 },
      ),
    };
  }

  return { user: data.user, admin };
}
