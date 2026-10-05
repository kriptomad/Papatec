# Papatec - instalador do backup local das maquinas internas
# Cria a pasta Documents\Backup com o arquivo papatec_backup.bkp (todos os
# dados do sistema) e uma tarefa agendada que o mantem 1:1 com o backup do
# servidor principal (padrao: a cada 1 minuto).
#
# Uso (1x nesta maquina):
#   powershell -ExecutionPolicy Bypass -File .\papatec-backup-local.ps1

param(
  [string]$ApiBase = "__API_BASE__",
  [string]$Token = "__TOKEN__",
  [string]$IntervalMinutes = "1",
  [string]$DestDir = (Join-Path $env:USERPROFILE "Documents\Backup"),
  [string]$FileName = "papatec_backup.bkp"
)

$ErrorActionPreference = "Stop"
$workDir = Join-Path $env:ProgramData "PapaTecBackup"
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

# --- script de pull (gravado no ProgramData) --------------------------------
$pull = Join-Path $workDir "pull-backup.ps1"
$pullContent = @'
param(
  [string]$ApiBase,
  [string]$Token,
  [string]$DestDir,
  [string]$FileName
)
$ErrorActionPreference = "Stop"
$tmp = Join-Path $DestDir ($FileName + ".download")
try {
  if ($PSVersionTable.PSVersion.Major -ge 6) {
    Invoke-WebRequest -Uri ($ApiBase + "/backup/machine?token=" + $Token) -OutFile $tmp -UseBasicParsing -SkipCertificateCheck
  } else {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    # Certificado do servidor local: aceita via ICertificatePolicy (o callback
    # ServerCertificateValidationCallback falha em thread do WinHTTP)
    if (-not ('PapaTecCertPolicy' -as [type])) {
      Add-Type -TypeDefinition 'using System.Net;using System.Security.Cryptography.X509Certificates;public class PapaTecCertPolicy : ICertificatePolicy { public bool CheckValidationResult(ServicePoint sp, X509Certificate c, WebRequest r, int p) { return true; } }'
    }
    [System.Net.ServicePointManager]::CertificatePolicy = New-Object PapaTecCertPolicy
    Invoke-WebRequest -Uri ($ApiBase + "/backup/machine?token=" + $Token) -OutFile $tmp -UseBasicParsing
  }
  $bytes = [IO.File]::ReadAllBytes($tmp)
  if ($bytes.Length -lt 4 -or $bytes[0] -ne 0x50 -or $bytes[1] -ne 0x4B) {
    Remove-Item $tmp -Force
    Write-Warning "Resposta invalida do servidor (arquivo nao e .bkp/zip)."
    exit 1
  }
  Move-Item -Force $tmp (Join-Path $DestDir $FileName)
  $size = (Get-Item (Join-Path $DestDir $FileName)).Length
  Write-Output ("{0} backup local atualizado ({1} bytes)" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $size)
} catch {
  if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
  Write-Warning ("Falha no backup local: " + $_.Exception.Message)
  exit 1
}
'@
Set-Content -Path $pull -Value $pullContent -Encoding UTF8

# --- tarefa agendada --------------------------------------------------------
$arg = '-NoProfile -ExecutionPolicy Bypass -File "' + $pull + '" -ApiBase "' + $ApiBase + '" -Token "' + $Token + '" -DestDir "' + $DestDir + '" -FileName "' + $FileName + '"'
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes ([int]$IntervalMinutes))

$registered = $false
try {
  Register-ScheduledTask -TaskName "PapaTec Backup Local" -Action $action -Trigger $trigger -Force `
    -Description "Mantem Documents\Backup\papatec_backup.bkp 1:1 com o servidor PapaTec" | Out-Null
  $registered = $true
} catch {
  Write-Warning ("Nao foi possivel criar a tarefa agendada (execute como administrador): " + $_.Exception.Message)
}

# --- primeira copia imediata ------------------------------------------------
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $pull -ApiBase $ApiBase -Token $Token -DestDir $DestDir -FileName $FileName

Write-Host ""
Write-Host ("Destino: " + (Join-Path $DestDir $FileName))
if ($registered) { Write-Host ("Tarefa:  'PapaTec Backup Local' a cada " + $IntervalMinutes + " min") }
Write-Host "Pronto."
