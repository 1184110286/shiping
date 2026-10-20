$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "resources\bin"
$source = Join-Path $PSScriptRoot "windows-keyboard-guard.c"
$output = Join-Path $outDir "windows-keyboard-guard.exe"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
  throw "vswhere.exe not found. Install Visual Studio Build Tools with the Desktop development with C++ workload."
}

$install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $install) {
  throw "MSVC C++ build tools were not found."
}

$devShell = Join-Path $install "Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
Import-Module $devShell
Enter-VsDevShell -VsInstallPath $install -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64" | Out-Null

& cl.exe /nologo /O2 /W4 /MT /DUNICODE /D_UNICODE $source /Fe:$output user32.lib
if ($LASTEXITCODE -ne 0) {
  throw "Failed to build windows-keyboard-guard.exe"
}

Write-Host "Built $output"
