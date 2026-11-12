// Sign in: Google, or a 6-digit code by email (Resend). docs/CLOUD.md, section 3 and Q10.
import Google from '@auth/core/providers/google';
import Resend from '@auth/core/providers/resend';
import { Anonymous } from '@convex-dev/auth/providers/Anonymous';
import { convexAuth } from '@convex-dev/auth/server';

/** The phone app's deep link scheme (app/app.json "scheme"); sign-in returns there. */
const APP_SCHEMES = ['anyappagent://'];

function sixDigits(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, '0');
}

const ResendOTP = Resend({
  id: 'resend-otp',
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 10 * 60,
  async generateVerificationToken() {
    return sixDigits();
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AnyAppAgent <onboarding@resend.dev>',
        to: [email],
        subject: `Your AnyAppAgent code: ${token}`,
        text: `Your sign-in code is ${token}. It works for 10 minutes. If you did not ask for it, ignore this email.`,
      }),
    });
    if (!res.ok) {
      // Never log the code; Resend's error says why (for example an address it may not send to).
      const why = await res.text();
      throw new Error(`Could not send the code (${res.status}): ${why.slice(0, 200)}`);
    }
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google,
    ResendOTP,
    // Dev only (SPIKE_ANONYMOUS=1 on the dev deployment): lets the spike's round trip run on the
    // emulator without a person's Google account or inbox. Never set on production.
    ...(process.env.SPIKE_ANONYMOUS === '1' ? [Anonymous] : []),
  ],
  callbacks: {
    async redirect({ redirectTo }) {
      if (APP_SCHEMES.some((s) => redirectTo.startsWith(s))) return redirectTo;
      const site = process.env.SITE_URL ?? '';
      if (site && redirectTo.startsWith(site)) return redirectTo;
      if (redirectTo.startsWith('/')) return `${site}${redirectTo}`;
      throw new Error(`Invalid redirectTo ${redirectTo}`);
    },
  },
});
