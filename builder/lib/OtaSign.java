// Signs a quick update's manifest (ota.json) with the app's own signing key, so the app can check
// it with the certificate it is signed with (com.anyapp.updates.Ota). Run by lib/fastlane.mjs as a
// single-file Java program: java OtaSign.java <keystore.p12> <alias> <file>. The keystore password
// comes from the environment (ANYAPP_KS_PASS), never the command line. Prints the base64 SHA256withRSA
// signature, then the SHA-256 of the signing certificate.
import java.io.FileInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.util.Base64;
import java.util.HexFormat;

public class OtaSign {
  public static void main(String[] args) throws Exception {
    String pass = System.getenv("ANYAPP_KS_PASS");
    if (args.length != 3 || pass == null) {
      System.err.println("usage: ANYAPP_KS_PASS=... java OtaSign.java <keystore.p12> <alias> <file>");
      System.exit(2);
    }
    KeyStore ks = KeyStore.getInstance("PKCS12");
    try (FileInputStream in = new FileInputStream(args[0])) {
      ks.load(in, pass.toCharArray());
    }
    PrivateKey key = (PrivateKey) ks.getKey(args[1], pass.toCharArray());
    Certificate cert = ks.getCertificate(args[1]);
    Signature s = Signature.getInstance("SHA256withRSA");
    s.initSign(key);
    s.update(Files.readAllBytes(Path.of(args[2])));
    System.out.println(Base64.getEncoder().encodeToString(s.sign()));
    System.out.println(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(cert.getEncoded())));
  }
}
