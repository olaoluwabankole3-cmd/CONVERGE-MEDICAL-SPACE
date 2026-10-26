# Converge single sign-on setup

This change adds a feature-flagged **Continue with Converge** option to the Medical Intelligence staff and patient sign-in screens and adds the central Converge OAuth consent page. The existing email/password sign-in paths remain available.

**Do not enable the feature flag until the two Supabase dashboards are configured and the flow has passed a synthetic-account test.** The applications continue to use separate Supabase projects. SSO links identity; it does not merge databases or grant hospital permissions.

## 1. Configure the central Converge identity project

Open the Supabase project used by the main Converge app (project ref: `voinobmxpoxqlygswyui`).

1. In **Authentication → URL Configuration**, check that the Site URL is `https://ai-native-research-qfeh.vercel.app`.
2. In **Authentication → OAuth Server**, enable OAuth 2.1 Server and set the Authorization Path to `/oauth/consent`.
3. Check **Authentication → JWT signing keys**. OIDC ID tokens require an asymmetric signing algorithm such as RS256 or ES256. Do not rotate or replace signing keys casually; verify the current configuration and plan a migration before changing signing keys if needed.
4. In **Authentication → OAuth Apps**, create a client named **Converge Medical Intelligence**. Choose **Confidential** because the client secret will be stored in the Medical Supabase Auth provider configuration, not in frontend code.
5. When Medical Supabase's custom OIDC provider is created in step 2 below, copy its displayed **Callback URL** into the new OAuth client's Redirect URIs exactly. It should be:
   `https://jgscdxvgbogysiyftfrm.supabase.co/auth/v1/callback`
6. Save the OAuth app and store its client ID and client secret securely. Do not put the secret in GitHub or a `NEXT_PUBLIC_*` environment variable.

The main app's authorization UI is the deployed route `/oauth/consent`. It asks the signed-in user to approve the identity-only request and explains the requested scopes.

## 2. Configure Medical Intelligence to trust Converge

Open the Supabase project used by Medical Intelligence (project ref: `jgscdxvgbogysiyftfrm`).

1. Go to **Authentication → Sign In / Providers** and add a **Custom OIDC** provider.
2. Use identifier `custom:converge`.
3. Set the issuer URL to `https://voinobmxpoxqlygswyui.supabase.co/auth/v1`.
4. Enter the client ID and client secret created in step 1; enable the provider and save.
5. In **Authentication → URL Configuration**, confirm the redirect URL `https://converge-medical-space.vercel.app/auth/callback` is allowed. Keep any existing redirect entries that are needed for password reset, email confirmation and previews.

## 3. Enable the UI

In Vercel, open the **CONVERGE-MEDICAL-SPACE** project and add this environment variable for **Production**:

- Key: `NEXT_PUBLIC_CONVERGE_SSO_ENABLED`
- Value: `true`

Save and redeploy the project. Leave Preview disabled until a separate OAuth client and exact preview callback have been configured.

## 4. Validate before relying on SSO

Use synthetic test accounts and synthetic records only:

1. Sign in to the main Converge app and open **Workspaces → Medical Intelligence**.
2. On both the staff sign-in and patient sign-in screens, test **Continue with Converge**.
3. Confirm sign-in returns to the correct destination: `/overview` for staff or `/care/requests` for patients.
4. Test an existing local Medical account whose email is already verified in both systems. Supabase can automatically link OAuth identities with the same verified email; this should preserve the existing local user ID and any existing patient/staff records.
5. Test an account with no hospital membership. It must not gain access to a hospital workspace just because it can sign in. Hospital membership status, patient-level authorization, RLS, and audit logging remain enforced by Medical Intelligence.
6. Confirm the original email/password paths still work and that a denied or expired authorization request fails closed.

If an existing account has an unverified email, duplicate accounts, or a different email in the two systems, stop and reconcile that account deliberately before using SSO. Do not work around a mismatch by weakening RLS or hospital membership checks.

## What this does and does not do

- **Does:** lets the Medical Supabase Auth flow use the central Converge OIDC identity and adds a user-approved consent screen.
- **Does not:** merge databases, copy patient data to Converge, grant patient or hospital roles, or replace Medical Intelligence's own authorization rules.
- **Feature flag:** the SSO buttons remain hidden until `NEXT_PUBLIC_CONVERGE_SSO_ENABLED=true`, so adding the code alone does not change current login behavior.
