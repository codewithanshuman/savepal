$ErrorActionPreference = 'Stop'
$base = if ($env:SAVEPAL_BASE_URL) { $env:SAVEPAL_BASE_URL } else { 'http://127.0.0.1:8787' }
$client = @{ 'oai-authenticated-user-id' = 'local-proof-client'; 'oai-authenticated-user-email' = 'proof-client@example.com' }
$worker = @{ 'oai-authenticated-user-id' = 'local-proof-worker'; 'oai-authenticated-user-email' = 'proof-worker@example.com' }
$outsider = @{ 'oai-authenticated-user-id' = 'local-outsider'; 'oai-authenticated-user-email' = 'outsider@example.com' }
$created = Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -Headers $client -ContentType 'application/json' -Body (@{
  action = 'create'; title = 'Local replay proof'; description = 'Verify an HTTPS page and retain replayable evidence.'
  freelancerEmail = 'proof-worker@example.com'; amount = '5.00'
  criteria = @(@{ label = 'The website is reachable'; kind = 'reachable' })
} | ConvertTo-Json -Depth 8)
$id = $created.id
if (-not $id) { throw 'Agreement creation failed' }
Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -Headers $worker -ContentType 'application/json' -Body (@{action='accept';id=$id}|ConvertTo-Json) | Out-Null
Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -Headers $worker -ContentType 'application/json' -Body (@{action='submit';id=$id;url='https://example.org/';notes='Public example page.'}|ConvertTo-Json) | Out-Null
$verified = Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -Headers $client -ContentType 'application/json' -Body (@{action='verify';id=$id}|ConvertTo-Json)
if (-not $verified.runId) { throw 'Verification run was not saved' }
$proof = Invoke-RestMethod -Uri "$base/api/verification-proof?projectId=$id&runId=$($verified.runId)" -Headers $client
if (-not $proof.valid -or -not $proof.checks.objectiveHash) { throw 'Verification replay failed' }
$denied = Invoke-WebRequest -Uri "$base/api/verification-proof?projectId=$id&runId=$($verified.runId)" -Headers $outsider -SkipHttpErrorCheck
if ($denied.StatusCode -ne 404) { throw 'Outsider could access proof' }
$path = Join-Path ([IO.Path]::GetTempPath()) "savepal-proof-$($verified.runId).json"
try {
  Invoke-WebRequest -Uri "$base/api/verification-proof?projectId=$id&runId=$($verified.runId)&download=1" -Headers $client -OutFile $path | Out-Null
  & node scripts/verify-proof-bundle.mjs $path
  if ($LASTEXITCODE -ne 0) { throw 'Downloaded proof failed offline verification' }
} finally { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path } }
$approved = Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -Headers $client -ContentType 'application/json' -Body (@{
  action='approve';id=$id;reason='Client reviewed the replayed website evidence.'
}|ConvertTo-Json)
if (-not $approved.approvalHash) { throw 'Approval receipt was not saved' }
$approvedPath = Join-Path ([IO.Path]::GetTempPath()) "savepal-approved-proof-$($verified.runId).json"
try {
  Invoke-WebRequest -Uri "$base/api/verification-proof?projectId=$id&runId=$($verified.runId)&download=1" -Headers $client -OutFile $approvedPath | Out-Null
  & node scripts/verify-proof-bundle.mjs $approvedPath
  if ($LASTEXITCODE -ne 0) { throw 'Approved proof failed offline verification' }
} finally { if (Test-Path -LiteralPath $approvedPath) { Remove-Item -LiteralPath $approvedPath } }
$checkout = Invoke-WebRequest -Uri "$base/api/workspace" -Method Post -Headers $client -ContentType 'application/json' -Body (@{action='create_order';id=$id}|ConvertTo-Json) -SkipHttpErrorCheck
if ($checkout.StatusCode -ne 502) { throw 'Checkout should be gated without PayPal credentials' }
Write-Output "PASS project=$id run=$($verified.runId) proof=$($proof.valid) outsider=$($denied.StatusCode) checkout_gate=$($checkout.StatusCode)"
