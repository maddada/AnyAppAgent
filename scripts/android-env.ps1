# Loads the AnyAppAgent Android toolchain into the CURRENT PowerShell session only.
# Usage (dot-source it):   . C:\dev\AnyAppAgent\scripts\android-env.ps1
# It never touches machine-wide or user-wide environment variables.
# See docs/ENVIRONMENT.md for the versions and pitfalls.

$AndroidRoot = 'D:\tools\android'

$env:JAVA_HOME        = Join-Path $AndroidRoot 'jdk'          # Microsoft OpenJDK 21
$env:ANDROID_HOME     = Join-Path $AndroidRoot 'sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_AVD_HOME = Join-Path $AndroidRoot 'avd'

# Our tools go FIRST on PATH so they win over the old Java 8 and the old
# "Minimal ADB and Fastboot" adb 1.0.39 that are also on the user's PATH.
$prepend = @(
    (Join-Path $env:JAVA_HOME 'bin'),
    (Join-Path $env:ANDROID_HOME 'platform-tools'),
    (Join-Path $env:ANDROID_HOME 'emulator'),
    (Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin'),
    (Join-Path $env:ANDROID_HOME 'build-tools\37.0.0')
)
$rest = $env:Path -split ';' | Where-Object { $_ -and ($prepend -notcontains $_) }
$env:Path = (($prepend + $rest) -join ';')

# Emulator serial of the anyapp AVD (console port 5560, see scripts/start-emulator.ps1).
$env:ANYAPP_ADB_SERIAL = 'emulator-5560'

if (-not $Quiet) {
    Write-Host "Android env loaded: JAVA_HOME=$env:JAVA_HOME ANDROID_HOME=$env:ANDROID_HOME AVD_HOME=$env:ANDROID_AVD_HOME serial=$env:ANYAPP_ADB_SERIAL"
}
