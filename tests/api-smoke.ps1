$ErrorActionPreference = 'Stop'
$base = if ($env:SAVEPAL_BASE_URL) { $env:SAVEPAL_BASE_URL } else { 'http://127.0.0.1:5174' }
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-WebRequest -Uri "$base/signin-with-chatgpt?return_to=/" -WebSession $session -UseBasicParsing | Out-Null
$payload = @{
  action = 'create'
  title = 'Local API hardening test'
  description = 'Synthetic agreement for backend verification only.'
  freelancerEmail = 'worker@sites.test'
  amount = 12.50
  criteria = @(@{ label = 'The website is reachable over HTTPS'; kind = 'reachable' })
} | ConvertTo-Json -Depth 8
$created = Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -WebSession $session -ContentType 'application/json' -Body $payload
if (-not $created.id) { throw 'Create did not return an ID' }
$detail = Invoke-RestMethod -Uri "$base/api/workspace?id=$($created.id)" -WebSession $session
if ($detail.project.status -ne 'INVITED') { throw "Unexpected status $($detail.project.status)" }
if (-not $detail.auditIntegrity.valid -or $detail.auditIntegrity.checked -ne 1) { throw 'Audit chain verification failed' }
try {
  $body = @{ action = 'submit'; id = $created.id; url = 'https://example.org'; notes = 'Unauthorized synthetic submission' } | ConvertTo-Json
  Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -WebSession $session -ContentType 'application/json' -Body $body | Out-Null
  throw 'Client was incorrectly allowed to submit freelancer evidence'
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw }
}
Write-Output "PASS create=$($created.id) status=$($detail.project.status) audit_checked=$($detail.auditIntegrity.checked) unauthorized_submit=403"
