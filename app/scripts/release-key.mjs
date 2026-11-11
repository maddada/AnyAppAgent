// The AnyAppAgent phone app's own release signing key (docs/RELEASING.md). It lives on this PC
// only, never in Git:
//
//   %USERPROFILE%\.anyappagent-release\anyappagent-release.p12      the key (PKCS12)
//   %USERPROFILE%\.anyappagent-release\anyappagent-release.backup   an encrypted copy of it
//   Windows Credential Manager, "AnyAppAgent/phone-release-key"     its password
//
// The folder is readable by the current Windows user only. The backup is AES-256-GCM encrypted
// with a key derived from the same password by scrypt: copy it somewhere off this PC and keep the
// password in a password manager, or a lost PC means AnyAppAgent can never update in place again.
//
//   node scripts/release-key.mjs create      makes the key, the backup and stores the password (once)
//   node scripts/release-key.mjs status      where the key is and its certificate SHA-256
//   node scripts/release-key.mjs password    prints the password (to save it in a password manager)
//   node scripts/release-key.mjs restore <backup file>   puts the key back from a backup (on a new
//                                            PC: set ANYAPP_RELEASE_PASSWORD for that one command; it
//                                            is then stored in Credential Manager)
//
// build-apk.mjs --release imports releaseSigning() from here.
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_DIR = process.env.ANYAPP_RELEASE_DIR ?? join(homedir(), ".anyappagent-release");
export const STORE_FILE = join(RELEASE_DIR, "anyappagent-release.p12");
export const BACKUP_FILE = join(RELEASE_DIR, "anyappagent-release.backup");
export const KEY_ALIAS = "anyappagent";
const CRED_TARGET = process.env.ANYAPP_RELEASE_CRED ?? "AnyAppAgent/phone-release-key";
const BACKUP_FORMAT = "anyappagent-phone-release-key";
const SCRYPT = { N: 2 ** 16, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

const JAVA_HOME = process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME) ? process.env.JAVA_HOME : String.raw`D:\tools\android\jdk`;
const keytool = join(JAVA_HOME, "bin", process.platform === "win32" ? "keytool.exe" : "keytool");

// Credential Manager through advapi32 (CredWrite/CredRead). The secret goes through stdin/stdout,
// never on a command line.
const CRED_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -Namespace AnyApp -Name Cred -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CREDENTIAL {
  public int Flags; public int Type; public string TargetName; public string Comment;
  public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
  public int Persist; public int AttributeCount; public IntPtr Attributes;
  public string TargetAlias; public string UserName;
}
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredWrite(ref CREDENTIAL c, int flags);
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredRead(string target, int type, int flags, out IntPtr c);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr c);
'@
$target = $env:ANYAPP_CRED_TARGET
if ($env:ANYAPP_CRED_OP -eq 'write') {
  $secret = [Console]::In.ReadToEnd()
  $bytes = [Text.Encoding]::Unicode.GetBytes($secret)
  $c = New-Object AnyApp.Cred+CREDENTIAL
  $c.Type = 1; $c.TargetName = $target; $c.Persist = 2; $c.UserName = 'release'
  $c.Comment = 'Password of the AnyAppAgent phone app release key (docs/RELEASING.md)'
  $c.CredentialBlobSize = $bytes.Length
  $c.CredentialBlob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $c.CredentialBlob, $bytes.Length)
  try {
    if (-not [AnyApp.Cred]::CredWrite([ref]$c, 0)) { throw "CredWrite failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($c.CredentialBlob) }
} else {
  $p = [IntPtr]::Zero
  if (-not [AnyApp.Cred]::CredRead($target, 1, 0, [ref]$p)) { exit 3 }
  try {
    $c = [Runtime.InteropServices.Marshal]::PtrToStructure($p, [type][AnyApp.Cred+CREDENTIAL])
    [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringUni($c.CredentialBlob, $c.CredentialBlobSize / 2))
  } finally { [AnyApp.Cred]::CredFree($p) }
}
`;

function credman(op, secret) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(CRED_PS, "utf16le").toString("base64")], {
    input: secret ?? "",
    env: { ...process.env, ANYAPP_CRED_OP: op, ANYAPP_CRED_TARGET: CRED_TARGET },
    encoding: "utf8",
    windowsHide: true,
  });
  if (op === "read" && r.status === 3) return null;
  if (r.status !== 0) throw new Error(`Windows Credential Manager (${op}) failed: ${(r.stderr || "").trim().split("\n")[0]}`);
  return op === "read" ? r.stdout : undefined;
}

export function readPassword() {
  if (process.env.ANYAPP_RELEASE_PASSWORD) return process.env.ANYAPP_RELEASE_PASSWORD;
  const pw = credman("read");
  if (!pw) throw new Error(`No password for the release key in Windows Credential Manager ("${CRED_TARGET}"). See docs/RELEASING.md.`);
  return pw;
}

function keytoolRun(args, password) {
  const r = spawnSync(keytool, args, { env: { ...process.env, ANYAPP_KS_PASS: password }, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`keytool ${args[0]} failed: ${(r.stderr || r.stdout || "").trim()}`);
  return r.stdout;
}

export function certSha256(password) {
  const out = keytoolRun(["-list", "-v", "-keystore", STORE_FILE, "-storetype", "PKCS12", "-alias", KEY_ALIAS, "-storepass:env", "ANYAPP_KS_PASS"], password);
  const m = out.match(/SHA256:\s*([0-9A-F:]+)/i);
  return m ? m[1].replace(/:/g, "").toLowerCase() : null;
}

/** Only the current Windows user (and SYSTEM, which can read everything anyway) may open the folder. */
function restrictFolder() {
  if (process.platform !== "win32") return;
  const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  const r = spawnSync("icacls", [RELEASE_DIR, "/inheritance:r", "/grant:r", `${user}:(OI)(CI)F`, "/grant:r", "SYSTEM:(OI)(CI)F"], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`icacls failed: ${(r.stderr || r.stdout).trim()}`);
}

function writeBackup(password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const header = { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), alias: KEY_ALIAS, certSha256: certSha256(password) };
  const key = crypto.scryptSync(password.normalize("NFC"), salt, 32, SCRYPT);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(header), "utf8"));
  const data = Buffer.concat([cipher.update(readFileSync(STORE_FILE)), cipher.final()]);
  const file = { header, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
  writeFileSync(BACKUP_FILE, JSON.stringify(file, null, 2));
}

function restoreBackup(from, password) {
  const file = JSON.parse(readFileSync(from, "utf8"));
  if (file.header?.format !== BACKUP_FORMAT) throw new Error("That file is not a backup of the AnyAppAgent phone release key.");
  const key = crypto.scryptSync(password.normalize("NFC"), Buffer.from(file.salt, "base64"), 32, SCRYPT);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(file.iv, "base64"));
  decipher.setAAD(Buffer.from(JSON.stringify(file.header), "utf8"));
  decipher.setAuthTag(Buffer.from(file.tag, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(file.data, "base64")), decipher.final()]);
  } catch {
    throw new Error("Wrong password, or the backup file was changed.");
  }
}

/** What build-apk.mjs --release needs. Throws with a plain message when the key is missing. */
export function releaseSigning() {
  if (!existsSync(STORE_FILE)) throw new Error(`The release key is missing (${STORE_FILE}). Run: node scripts/release-key.mjs create (first time) or restore. See docs/RELEASING.md.`);
  const password = readPassword();
  return { storeFile: STORE_FILE, storePassword: password, keyAlias: KEY_ALIAS, keyPassword: password, certSha256: certSha256(password) };
}

function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "create") {
    if (existsSync(STORE_FILE)) throw new Error(`A release key already exists (${STORE_FILE}). Never replace it: phones could no longer update AnyAppAgent.`);
    if (credman("read")) throw new Error(`Credential Manager already holds "${CRED_TARGET}" without a key file. Restore the key from its backup instead.`);
    mkdirSync(RELEASE_DIR, { recursive: true });
    restrictFolder();
    const password = crypto.randomBytes(24).toString("base64url");
    keytoolRun(["-genkeypair", "-keystore", STORE_FILE, "-storetype", "PKCS12", "-alias", KEY_ALIAS, "-keyalg", "RSA", "-keysize", "4096", "-validity", "36500",
      "-dname", "CN=AnyAppAgent, O=AnyAppAgent", "-storepass:env", "ANYAPP_KS_PASS", "-keypass:env", "ANYAPP_KS_PASS"], password);
    credman("write", password);
    if (readPassword() !== password) throw new Error("The password read back from Credential Manager does not match.");
    writeBackup(password);
    const back = restoreBackup(BACKUP_FILE, password);
    if (!back.equals(readFileSync(STORE_FILE))) throw new Error("The backup does not decrypt to the key.");
    console.log(`Release key: ${STORE_FILE}\nBackup:      ${BACKUP_FILE}\nPassword:    Windows Credential Manager, "${CRED_TARGET}"\nCertificate SHA-256: ${certSha256(password)}`);
  } else if (cmd === "status") {
    const s = releaseSigning();
    console.log(`Release key: ${s.storeFile}\nBackup:      ${existsSync(BACKUP_FILE) ? BACKUP_FILE : "missing"}\nPassword:    Windows Credential Manager, "${CRED_TARGET}"\nCertificate SHA-256: ${s.certSha256}`);
  } else if (cmd === "password") {
    process.stdout.write(readPassword() + "\n");
  } else if (cmd === "restore") {
    if (!arg) throw new Error("Usage: node scripts/release-key.mjs restore <backup file>");
    if (existsSync(STORE_FILE)) throw new Error(`A release key already exists (${STORE_FILE}); not replacing it.`);
    const password = readPassword();
    const store = restoreBackup(arg, password);
    mkdirSync(RELEASE_DIR, { recursive: true });
    restrictFolder();
    writeFileSync(STORE_FILE, store);
    if (!credman("read")) credman("write", password);
    console.log(`Restored ${STORE_FILE} (certificate SHA-256 ${certSha256(password)}).`);
  } else {
    console.log("Usage: node scripts/release-key.mjs create | status | password | restore <backup file>");
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
