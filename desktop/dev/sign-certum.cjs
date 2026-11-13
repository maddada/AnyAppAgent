// electron-builder signing hook for the signed Windows installer (docs/RELEASING.md, "Windows code
// signing"). Only .github/workflows/windows-installer.yml uses it, through
// dev/electron-builder.signed.cjs, after SimplySign Desktop has mounted the Certum certificate and
// exported GHOSTEX_SIGNTOOL; a local `npm run dist` stays unsigned. Signs one file with SHA-256 and
// a time.certum.pl timestamp, keeps files a vendor already signed (Microsoft's DLLs), and throws
// unless the file comes out Valid, signed by CERTUM_CERT_SHA1 and timestamped, so the build fails
// instead of shipping an unsigned file.
const { spawnSync } = require("node:child_process");
const { basename } = require("node:path");

function signatureOf(file) {
  const script =
    "$s = Get-AuthenticodeSignature -LiteralPath $env:KIWIMAKE_SIGN_FILE; " +
    "[pscustomobject]@{ status = [string]$s.Status; thumbprint = [string]$s.SignerCertificate.Thumbprint; timestamped = [bool]$s.TimeStamperCertificate } | ConvertTo-Json -Compress";
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, KIWIMAKE_SIGN_FILE: file },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Get-AuthenticodeSignature failed for ${file}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

exports.default = async function sign(configuration) {
  const file = configuration.path;
  const signtool = process.env.GHOSTEX_SIGNTOOL;
  const thumbprint = (process.env.CERTUM_CERT_SHA1 || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (!signtool || thumbprint.length !== 40) {
    throw new Error("Windows signing needs GHOSTEX_SIGNTOOL (set by the SimplySign login) and CERTUM_CERT_SHA1");
  }
  if (signatureOf(file).status === "Valid") {
    console.log(`  • keeping the existing signature of ${basename(file)}`);
    return;
  }
  // The timestamp server and the SimplySign cloud are network calls: retry a few times.
  for (let attempt = 1; attempt <= 3; attempt++) {
    spawnSync(
      signtool,
      ["sign", "/sha1", thumbprint, "/fd", "sha256", "/tr", "http://time.certum.pl", "/td", "sha256",
        "/d", "Kiwimake", "/du", "https://github.com/maddada/AnyAppAgent", file],
      { stdio: "inherit" },
    );
    const after = signatureOf(file);
    if (after.status === "Valid" && after.thumbprint === thumbprint && after.timestamped) {
      console.log(`  • signed ${basename(file)} with Certum`);
      return;
    }
    if (attempt < 3) await new Promise((done) => setTimeout(done, 15000 * attempt));
  }
  throw new Error(`Certum signing failed for ${file}`);
};
