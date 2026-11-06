$ErrorActionPreference = 'Stop'
$base = if ($env:SAVEPAL_BASE_URL) { $env:SAVEPAL_BASE_URL } else { 'http://127.0.0.1:5174' }
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-WebRequest -Uri "$base/signin-with-chatgpt?return_to=/" -WebSession $session -UseBasicParsing | Out-Null
$payload = @{
  action = 'create'
  title = 'Local verification test'
  description = 'Synthetic website criterion test.'
  freelancerEmail = 'worker@sites.test'
  amount = 10
  criteria = @(
    @{ label = 'Website is reachable'; kind = 'reachable' },
    @{ label = 'HTML includes Example Domain'; kind = 'contains'; needle = 'Example Domain' },
    @{ label = 'Manual checkout review'; kind = 'manual' }
  )
} | ConvertTo-Json -Depth 8
$created = Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -WebSession $session -ContentType 'application/json' -Body $payload
if ($created.id -notmatch '^[0-9a-f-]{36}$') { throw 'Invalid test ID' }
$sql = "UPDATE projects SET status='SUBMITTED',evidence_url='https://example.org/',evidence_notes='Synthetic test submission',evidence_hash='synthetic-test-hash',evidence_at='2026-11-04T00:00:00Z' WHERE id='$($created.id)'"
& node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --command $sql | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Test setup failed' }
$body = @{ action = 'verify'; id = $created.id } | ConvertTo-Json
$result = Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -WebSession $session -ContentType 'application/json' -Body $body
$detail = Invoke-RestMethod -Uri "$base/api/workspace?id=$($created.id)" -WebSession $session
if ($detail.project.status -ne 'REVIEW' -or $detail.project.latest_run_id -ne $result.runId) { throw 'Verification state mismatch' }
if (-not $detail.auditIntegrity.valid -or $detail.auditIntegrity.checked -ne 3) { throw 'Audit chain failed after verification' }
if (-not $result.snapshotHash -or -not $detail.project.current_submission_id -or $detail.verificationRun.submission_id -ne $detail.project.current_submission_id) { throw 'Verification was not bound to a snapshot' }
if ($result.findings.Count -ne 3 -or $result.findings[2].status -ne 'INCONCLUSIVE') { throw 'Findings are incorrect' }
Write-Output "PASS verification_run=$($result.runId) status=$($detail.project.status) findings=$($result.findings.Count) audit_checked=$($detail.auditIntegrity.checked)"
