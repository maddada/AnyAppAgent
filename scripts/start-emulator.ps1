# Starts a Kiwimake Android emulator (visible window, hardware acceleration) if it is not
# already running, then waits until Android has fully booted.
# Usage:  pwsh -File C:\dev\AnyAppAgent\scripts\start-emulator.ps1 [-Name anyapp|anyapp2] [-TimeoutSec 300] [-ColdBoot]
# Serials are fixed by console port: anyapp = emulator-5560, anyapp2 = emulator-5562.
# Never touches the "ghostex" AVD and never kills the adb server.
param(
    [ValidateSet('anyapp', 'anyapp2')]
    [string]$Name = 'anyapp',
    [int]$TimeoutSec = 300,
    [switch]$ColdBoot
)
$ErrorActionPreference = 'Stop'
$Quiet = $true
. (Join-Path $PSScriptRoot 'android-env.ps1')

$ports  = @{ 'anyapp' = 5560; 'anyapp2' = 5562 }
$avd    = $Name
$port   = $ports[$Name]
$serial = "emulator-$port"
$logDir = 'D:\tools\android\logs'
New-Item -ItemType Directory -Force $logDir | Out-Null

function Get-BootState {
    $state = (& adb -s $serial get-state 2>$null)
    if ($state -ne 'device') { return 'absent' }
    $boot = (& adb -s $serial shell getprop sys.boot_completed 2>$null)
    if ("$boot".Trim() -eq '1') { return 'booted' }
    return 'booting'
}

& adb start-server 2>$null | Out-Null

$running = Get-CimInstance Win32_Process -Filter "Name like 'qemu-system%' or Name = 'emulator.exe'" |
    Where-Object { $_.CommandLine -match "-avd\s+$avd(\s|$)" }

if (-not $running) {
    $emuArgs = @('-avd', $avd, '-port', "$port", '-gpu', 'auto', '-accel', 'on', '-netdelay', 'none', '-netspeed', 'full')
    if ($ColdBoot) { $emuArgs += '-no-snapshot-load' }
    Write-Host "Starting emulator $avd on $serial ..."
    # Launched through Win32_Process.Create so it is NOT a child of this shell: agent tools
    # (Claude Code, CI runners) kill the whole process tree when a command ends, and a
    # Start-Process child would die with it. The environment is passed explicitly because
    # the WMI-created process gets the user's default environment, not this session's.
    $emuExe = Join-Path $env:ANDROID_HOME 'emulator\emulator.exe'
    $out = Join-Path $logDir "$avd-emulator-stdout.log"
    $err = Join-Path $logDir "$avd-emulator-stderr.log"
    $cmd = "cmd.exe /d /c set `"ANDROID_HOME=$env:ANDROID_HOME`"&& set `"ANDROID_SDK_ROOT=$env:ANDROID_SDK_ROOT`"&& set `"ANDROID_AVD_HOME=$env:ANDROID_AVD_HOME`"&& `"$emuExe`" $($emuArgs -join ' ') > `"$out`" 2> `"$err`""
    $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $logDir }
    if ($r.ReturnValue -ne 0) { throw "Could not start the emulator (Win32_Process.Create returned $($r.ReturnValue))." }
} else {
    Write-Host "Emulator $avd is already running."
}

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-BootState) -ne 'booted') {
    if ((Get-Date) -gt $deadline) {
        throw "Emulator $avd ($serial) did not finish booting within $TimeoutSec s. See $logDir\$avd-emulator-*.log"
    }
    Start-Sleep -Seconds 2
}

# Keep the screen awake while it is plugged in, so installs and launches are visible.
& adb -s $serial shell svc power stayon true 2>$null | Out-Null
& adb -s $serial shell input keyevent 82 2>$null | Out-Null   # dismiss the lock screen if shown
Write-Host "Emulator $avd is booted: $serial"
