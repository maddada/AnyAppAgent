// Sign in: Google, or a 6-digit code by email (Resend). docs/CLOUD.md, section 3 and Q10.
import Google from '@auth/core/providers/google';
import Resend from '@auth/core/providers/resend';
import { Anonymous } from '@convex-dev/auth/providers/Anonymous';
import { ConvexCredentials } from '@convex-dev/auth/providers/ConvexCredentials';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { sha256Hex } from './lib/crypto';
import { convexAuth } from '@convex-dev/auth/server';

/** The phone app's deep link scheme (app/app.json "scheme"); sign-in returns there. */
const APP_SCHEMES = ['anyappagent://'];

function sixDigits(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, '0');
}

/**
 * The PC hands its sign-in to its paired phone (milestone 7, pclinks.ts): the companion asks Convex
 * for a one-time code with its PC link and gives it to the phone over pairing; the phone signs in
 * with it. Works once, for two minutes, only while the link lives.
 */
const PcHandoff = ConvexCredentials({
  id: 'pc-handoff',
  async authorize(params, ctx) {
    const code = typeof params.code === 'string' ? params.code : '';
    if (code.length < 20) return null;
    const userId = (await ctx.runMutation(internal.pclinks.useHandoff, { codeHash: await sha256Hex(code) })) as Id<'users'> | null;
    return userId ? { userId } : null;
  },
});

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
        from: 'Kiwimake <onboarding@resend.dev>',
        to: [email],
        subject: `Your Kiwimake code: ${token}`,
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
    PcHandoff,
    // Dev only (SPIKE_ANONYMOUS=1 on the dev deployment): lets the spike's round trip run on the
    // emulator without a person's Google account or inbox. Never set on production.
    ...(process.env.SPIKE_ANONYMOUS === '1' ? [Anonymous] : []),
  ],
  callbacks: {
    async redirect({ redirectTo }) {
      if (APP_SCHEMES.some((s) => redirectTo.startsWith(s))) return redirectTo;
      const site = process.env.SITE_URL ?? '';
      if (site && redirectTo.startsWith(site)) return redirectTo;
      // The desktop's browser sign-in page (pclinks.ts) returns to itself after Google.
      const own = process.env.CONVEX_SITE_URL ?? '';
      if (own && redirectTo.startsWith(`${own}/pc/link?`)) return redirectTo;
      if (redirectTo.startsWith('/')) return `${site}${redirectTo}`;
      throw new Error(`Invalid redirectTo ${redirectTo}`);
    },
  },
});
