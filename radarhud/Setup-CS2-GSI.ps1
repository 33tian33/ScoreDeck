[CmdletBinding()]
param([string]$Cs2CfgDir = "")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$portableRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$configFile = Join-Path $portableRoot "config\gamestate_integration_radarhud.cfg"
if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) {
    throw "GSI config file not found: $configFile"
}

$script:candidates = New-Object 'System.Collections.Generic.List[string]'
function Add-Candidate {
    param([AllowNull()][string]$SteamLibrary)
    if ([string]::IsNullOrWhiteSpace($SteamLibrary)) { return }
    $library = $SteamLibrary.Trim().Trim('"').Replace("/", "\")
    if (-not (Test-Path -LiteralPath $library -PathType Container)) { return }
    foreach ($gameFolder in @("Counter-Strike Global Offensive", "Counter-Strike 2")) {
        $cfg = Join-Path $library ("steamapps\common\$gameFolder\game\csgo\cfg")
        if ((Test-Path -LiteralPath $cfg -PathType Container) -and -not $script:candidates.Contains($cfg)) {
            [void]$script:candidates.Add($cfg)
        }
    }
}

$steamRoots = New-Object 'System.Collections.Generic.List[string]'
foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, ${env:LOCALAPPDATA})) {
    if (-not [string]::IsNullOrWhiteSpace($base)) {
        [void]$steamRoots.Add((Join-Path $base "Steam"))
    }
}
foreach ($registryPath in @(
    "HKCU:\Software\Valve\Steam",
    "HKLM:\SOFTWARE\WOW6432Node\Valve\Steam",
    "HKLM:\SOFTWARE\Valve\Steam"
)) {
    try {
        $steam = Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop
        foreach ($property in @("SteamPath", "InstallPath")) {
            if (-not [string]::IsNullOrWhiteSpace($steam.$property)) {
                [void]$steamRoots.Add($steam.$property)
            }
        }
    } catch {
        # A missing Steam registry key is normal on some portable installs.
    }
}

foreach ($steamRoot in @($steamRoots | Select-Object -Unique)) {
    Add-Candidate $steamRoot
    $libraryFile = Join-Path $steamRoot "steamapps\libraryfolders.vdf"
    if (Test-Path -LiteralPath $libraryFile -PathType Leaf) {
        foreach ($line in Get-Content -LiteralPath $libraryFile) {
            if ($line -match '"path"\s+"([^"]+)"') { Add-Candidate $matches[1] }
        }
    }
}

if ([string]::IsNullOrWhiteSpace($Cs2CfgDir)) {
    if ($script:candidates.Count -eq 1) {
        $Cs2CfgDir = $script:candidates[0]
    } elseif ($script:candidates.Count -gt 1) {
        Write-Host "Multiple CS2 config folders found:" -ForegroundColor Yellow
        for ($i = 0; $i -lt $script:candidates.Count; $i++) {
            Write-Host ("  [{0}] {1}" -f ($i + 1), $script:candidates[$i])
        }
        $choice = Read-Host "Choose a folder (default 1; enter 0 for a manual path)"
        if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "1" }
        $number = 0
        if ([int]::TryParse($choice, [ref]$number) -and $number -ge 1 -and $number -le $script:candidates.Count) {
            $Cs2CfgDir = $script:candidates[$number - 1]
        }
    }
}

if ([string]::IsNullOrWhiteSpace($Cs2CfgDir)) {
    $Cs2CfgDir = Read-Host "Paste the CS2 game\csgo\cfg folder path"
}
if (-not (Test-Path -LiteralPath $Cs2CfgDir -PathType Container)) {
    throw "Folder does not exist: $Cs2CfgDir"
}

Copy-Item -LiteralPath $configFile -Destination (Join-Path $Cs2CfgDir "gamestate_integration_radarhud.cfg") -Force
Write-Host ""
Write-Host "GSI config written to: $Cs2CfgDir" -ForegroundColor Green
Write-Host "Now run Start-RadarHUD.cmd to launch the HUD."
