// Finds things that must never go public (docs/DISTRIBUTION.md, "Before anything goes public"):
// API keys, tokens and private keys, in text that is about to be published (a README, release
// notes, the text inside an APK). It reports where and what kind, never the secret itself.

export interface SecretHit {
  kind: string; // "Anthropic API key"
  where: string; // "README.md", "assets/index.android.bundle"
  preview: string; // the first characters and the length, e.g. "sk-ant-api0… (108 characters)"
}

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "OpenRouter API key", re: /sk-or-v1-[A-Za-z0-9]{32,}/g },
  { kind: "OpenAI API key", re: /sk-(?:proj-)?[A-Za-z0-9]{32,}/g },
  { kind: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/g },
  { kind: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "Stripe secret key", re: /\b[sr]k_live_[0-9A-Za-z]{20,}/g },
  { kind: "Private key", re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g },
];

export function findSecrets(text: string, where: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const seen = new Set<string>();
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      hits.push({ kind, where, preview: `${m[0].slice(0, 10)}… (${m[0].length} characters)` });
      if (hits.length >= 20) return hits;
    }
  }
  return hits;
}

/** One plain sentence for the chat and the desktop: what was found and where. */
export function describeSecrets(hits: SecretHit[]): string {
  const first = hits.slice(0, 3).map((h) => `${h.kind} in ${h.where}`);
  const more = hits.length > 3 ? ` and ${hits.length - 3} more` : "";
  return `Not shared: found what looks like a secret (${first.join("; ")}${more}). Take it out of the app first, then try again.`;
}
