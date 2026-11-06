$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:5174'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-WebRequest -Uri "$base/signin-with-chatgpt?return_to=/" -WebSession $session -UseBasicParsing | Out-Null
$payload = @{
  action = 'create'
  title = 'Local payment safety test'
  description = 'Synthetic milestone with no PayPal credentials.'
  freelancerEmail = 'worker@sites.test'
  amount = 5
  criteria = @(@{ label = 'Website reachable'; kind = 'reachable' })
} | ConvertTo-Json -Depth 8
$created = Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -WebSession $session -ContentType 'application/json' -Body $payload
if ($created.id -notmatch '^[0-9a-f-]{36}$') { throw 'Invalid test ID' }
$sql = "UPDATE projects SET status='SUBMITTED',evidence_url='https://example.org/',evidence_notes='Synthetic payment gate test',evidence_hash='synthetic-payment-hash',evidence_at='2026-11-04T00:00:00Z' WHERE id='$($created.id)'"
& node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --command $sql | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Test setup failed' }
$verify = @{ action = 'verify'; id = $created.id } | ConvertTo-Json
Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -WebSession $session -ContentType 'application/json' -Body $verify | Out-Null
$approval = @{ action = 'approve'; id = $created.id; reason = 'Client reviewed the synthetic verification for the local payment gate test.' } | ConvertTo-Json
$approved = Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -WebSession $session -ContentType 'application/json' -Body $approval
if (-not $approved.approvalHash) { throw 'Approval receipt was not created' }
try {
  $body = @{ action = 'create_order'; id = $created.id } | ConvertTo-Json
  Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -WebSession $session -ContentType 'application/json' -Body $body | Out-Null
  throw 'Checkout unexpectedly succeeded without credentials'
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 502) { throw }
}
$detail = Invoke-RestMethod -Uri "$base/api/workspace?id=$($created.id)" -WebSession $session
if ($detail.project.payment_status -ne 'NOT_STARTED' -or $detail.project.paypal_order_id -or $detail.approvalReceipt.receipt_hash -ne $approved.approvalHash) { throw 'Payment or approval state mismatch' }
Write-Output "PASS approval_receipt=$($approved.approvalHash) no_credentials payment_status=$($detail.project.payment_status)"
