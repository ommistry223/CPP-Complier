## ══════════════════════════════════════════════════════════════════
##  PC-1 Firewall Setup Script
##  Run this as Administrator on PC-1 to allow worker PCs to connect.
##
##  Usage (PowerShell as Admin):
##    Set-ExecutionPolicy Bypass -Scope Process
##    .\scripts\setup-pc1-firewall.ps1
##
##  Parameters:
##    -LanSubnet  Your LAN subnet (default: 192.168.1.0/24)
## ══════════════════════════════════════════════════════════════════

param(
    [string]$LanSubnet = "192.168.1.0/24"
)

# Check for admin rights
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator! Right-click PowerShell and choose 'Run as administrator'."
    exit 1
}

Write-Host ""
Write-Host "======================================================"
Write-Host "|   PC-1 Firewall Configuration for Worker Nodes     |"
Write-Host "======================================================"
Write-Host ""
Write-Host "LAN Subnet : $LanSubnet"
Write-Host ""

# ── Helper function ────────────────────────────────────────────────
function Add-LanRule {
    param($Name, $Port, $Description)
    
    # Remove existing rule with same name if present
    $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Remove-NetFirewallRule -DisplayName $Name
        Write-Host "  [Updated] Removed old rule: $Name"
    }
    
    New-NetFirewallRule `
        -DisplayName $Name `
        -Description $Description `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort $Port `
        -RemoteAddress $LanSubnet `
        -Action Allow `
        -Profile Any `
        -Enabled True | Out-Null
    
    Write-Host "  [+] $Name (port $Port) - allowed from $LanSubnet"
}

# ── Add firewall rules ─────────────────────────────────────────────
Write-Host "Adding firewall rules..."
Write-Host ""

Add-LanRule `
    -Name "CPP-Compiler Redis LAN" `
    -Port 6380 `
    -Description "Allow worker PCs (PC-2, PC-3) to connect to Redis queue"

Add-LanRule `
    -Name "CPP-Compiler PgBouncer LAN" `
    -Port 5434 `
    -Description "Allow worker PCs (PC-2, PC-3) to connect to PostgreSQL via PgBouncer"

# ── Verify rules were created ──────────────────────────────────────
Write-Host ""
Write-Host "Verifying rules..."
$rules = Get-NetFirewallRule -DisplayName "CPP-Compiler*" | Select-Object DisplayName, Enabled, Direction
$rules | Format-Table -AutoSize

Write-Host ""
Write-Host "--------------------------------------------------------"
Write-Host "|  Firewall configured successfully!                   |"
Write-Host "|                                                      |"
Write-Host "|  Next steps:                                         |"
Write-Host "|  1. Add REDIS_PASSWORD to your .env on PC-1          |"
Write-Host "|  2. Restart PC-1 services:                           |"
Write-Host "|       docker compose down && docker compose up -d    |"
Write-Host "|  3. Configure .env on PC-2 and PC-3 (see README)     |"
Write-Host "|  4. Run worker-node\start-worker.bat on each PC      |"
Write-Host "--------------------------------------------------------"
Write-Host ""
