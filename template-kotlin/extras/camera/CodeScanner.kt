package com.anyapp.camera

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.google.android.gms.common.api.OptionalModuleApi
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/** A code the camera read: [value] is its text, [format] "qr", "ean13", ..., [kind] "url", "text", "product", ... */
data class ScannedCode(val value: String, val format: String, val kind: String)

/**
 * Scans one barcode or QR code with Google's code scanner: a full-screen camera view that comes
 * with Google Play services, so the app needs no camera permission and stays small. Camera
 * smarts core (com.anyapp.camera), the same in both templates.
 */
object CodeScanner {
  const val ON = true

  /** Opens the scanner; [done] gets the code, null when the person closed it, or a failure. */
  fun scan(activity: Activity, done: (Result<ScannedCode?>) -> Unit) {
    val options = GmsBarcodeScannerOptions.Builder().enableAutoZoom().build()
    val scanner = GmsBarcodeScanning.getClient(activity, options)
    val start = {
      scanner.startScan()
        .addOnSuccessListener { b -> done(Result.success(ScannedCode(b.rawValue ?: b.displayValue ?: "", format(b.format), kind(b.valueType)))) }
        .addOnCanceledListener { done(Result.success(null)) }
        .addOnFailureListener { e ->
          if (e is MlKitException && e.errorCode == CommonStatusCodes.CANCELED) done(Result.success(null)) else done(Result.failure(e))
        }
    }
    // The scanner screen is a Google Play services part: fetch it first if this phone has not got it yet.
    val installer = ModuleInstall.getClient(activity)
    installer.areModulesAvailable(scanner)
      .addOnSuccessListener { r ->
        if (r.areModulesAvailable()) start()
        else installer.installModules(ModuleInstallRequest.newBuilder().addApi(scanner).build())
          .addOnSuccessListener { start() }
          .addOnFailureListener { e -> done(Result.failure(e)) }
      }
      .addOnFailureListener { start() }
  }

  private val main = Handler(Looper.getMainLooper())

  /** Finds every code in the picture at [uri] (file:// or content://), for example a screenshot. */
  fun read(context: Context, uri: Uri, done: (Result<List<ScannedCode>>) -> Unit) {
    val image = try {
      InputImage.fromFilePath(context, uri)
    } catch (e: Throwable) {
      done(Result.failure(e))
      return
    }
    val reader = BarcodeScanning.getClient()
    var tries = 0
    fun attempt() {
      reader.process(image)
        .addOnSuccessListener { list -> done(Result.success(list.map { b -> ScannedCode(b.rawValue ?: b.displayValue ?: "", format(b.format), kind(b.valueType)) })) }
        .addOnFailureListener { e ->
          // The first use on a phone waits for Google Play services to fetch the reader.
          if (e is MlKitException && e.errorCode == MlKitException.UNAVAILABLE && tries++ < 30) main.postDelayed({ attempt() }, 2_000)
          else done(Result.failure(e))
        }
    }
    val api = reader as? OptionalModuleApi ?: return attempt()
    val installer = ModuleInstall.getClient(context)
    installer.areModulesAvailable(api)
      .addOnSuccessListener { r ->
        if (r.areModulesAvailable()) attempt()
        else installer.installModules(ModuleInstallRequest.newBuilder().addApi(api).build())
          .addOnSuccessListener { attempt() }
          .addOnFailureListener { attempt() }
      }
      .addOnFailureListener { attempt() }
  }

  private fun format(f: Int) = when (f) {
    Barcode.FORMAT_QR_CODE -> "qr"
    Barcode.FORMAT_EAN_13 -> "ean13"
    Barcode.FORMAT_EAN_8 -> "ean8"
    Barcode.FORMAT_UPC_A -> "upca"
    Barcode.FORMAT_UPC_E -> "upce"
    Barcode.FORMAT_CODE_128 -> "code128"
    Barcode.FORMAT_CODE_39 -> "code39"
    Barcode.FORMAT_CODE_93 -> "code93"
    Barcode.FORMAT_CODABAR -> "codabar"
    Barcode.FORMAT_ITF -> "itf"
    Barcode.FORMAT_DATA_MATRIX -> "datamatrix"
    Barcode.FORMAT_PDF417 -> "pdf417"
    Barcode.FORMAT_AZTEC -> "aztec"
    else -> "unknown"
  }

  private fun kind(t: Int) = when (t) {
    Barcode.TYPE_URL -> "url"
    Barcode.TYPE_PRODUCT, Barcode.TYPE_ISBN -> "product"
    Barcode.TYPE_WIFI -> "wifi"
    Barcode.TYPE_CONTACT_INFO -> "contact"
    Barcode.TYPE_EMAIL -> "email"
    Barcode.TYPE_PHONE -> "phone"
    Barcode.TYPE_SMS -> "sms"
    Barcode.TYPE_GEO -> "geo"
    Barcode.TYPE_CALENDAR_EVENT -> "event"
    else -> "text"
  }
}
