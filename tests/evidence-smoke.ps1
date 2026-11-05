$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:5174'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-WebRequest -Uri "$base/signin-with-chatgpt?return_to=/" -WebSession $session -UseBasicParsing | Out-Null

function Invoke-LocalSql([string]$sql) {
  & node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --command $sql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Local database setup failed' }
}

$payload = @{
  action = 'create'
  title = 'Evidence snapshot integration test'
  description = 'Synthetic same-origin evidence and reproducible verification.'
  freelancerEmail = 'worker@sites.test'
  amount = 10
  criteria = @(
    @{ label = 'Website is reachable'; kind = 'reachable' },
    @{ label = 'Example Domain is present'; kind = 'contains'; needle = 'Example Domain' },
    @{ label = 'Checkout review'; kind = 'manual' }
  )
} | ConvertTo-Json -Depth 8
$created = Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -WebSession $session -ContentType 'application/json' -Body $payload
$initial = Invoke-RestMethod -Uri "$base/api/workspace?id=$($created.id)" -WebSession $session
$clientId = $initial.project.client_id.Replace("'", "''")
$clientEmail = $initial.project.client_email.Replace("'", "''")
Invoke-LocalSql "UPDATE projects SET client_id='synthetic-other-client',freelancer_email='$clientEmail',status='AGREED' WHERE id='$($created.id)'"

$body = @{ action = 'submit'; id = $created.id; url = 'https://example.org/'; notes = 'Submitted public example page' } | ConvertTo-Json
$submitted = Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -WebSession $session -ContentType 'application/json' -Body $body
if (-not $submitted.submissionId -or -not $submitted.snapshotHash -or $submitted.pagesCaptured -lt 1) { throw 'Evidence submission was not snapshotted' }
$snapshot = Invoke-RestMethod -Uri "$base/api/evidence?projectId=$($created.id)&submissionId=$($submitted.submissionId)" -WebSession $session
if ($snapshot.pages[0].url -ne 'https://example.org/' -or -not $snapshot.pages[0].bodyHash) { throw 'Private snapshot could not be read' }

Invoke-LocalSql "UPDATE projects SET client_id='$clientId',freelancer_email='worker@sites.test' WHERE id='$($created.id)'"
$verifyBody = @{ action = 'verify'; id = $created.id } | ConvertTo-Json
$result = Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -WebSession $session -ContentType 'application/json' -Body $verifyBody
$detail = Invoke-RestMethod -Uri "$base/api/workspace?id=$($created.id)" -WebSession $session
if ($detail.project.status -ne 'REVIEW' -or $detail.verificationRun.submission_id -ne $submitted.submissionId) { throw 'Verification is not bound to the submission' }
if ($result.snapshotHash -ne $submitted.snapshotHash -or $detail.verificationRun.snapshot_hash -ne $submitted.snapshotHash) { throw 'Snapshot hash changed during verification' }
if ($detail.evidenceHistory[0].manifest.pages.Count -lt 1 -or -not $detail.auditIntegrity.valid) { throw 'Evidence manifest or audit chain failed' }
if ($result.findings.Count -ne 3 -or $result.findings[2].status -ne 'INCONCLUSIVE') { throw 'Findings are incorrect' }
Write-Output "PASS submission=$($submitted.submissionId) snapshot=$($submitted.snapshotHash) pages=$($submitted.pagesCaptured) status=$($detail.project.status)"
