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
$sql = "UPDATE projects SET status='APPROVED' WHERE id='$($created.id)'"
& node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --command $sql | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Test setup failed' }
try {
  $body = @{ action = 'create_order'; id = $created.id } | ConvertTo-Json
  Invoke-RestMethod -Uri "$base/api/workspace" -Method Post -WebSession $session -ContentType 'application/json' -Body $body | Out-Null
  throw 'Checkout unexpectedly succeeded without credentials'
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 502) { throw }
}
$detail = Invoke-RestMethod -Uri "$base/api/workspace?id=$($created.id)" -WebSession $session
if ($detail.project.payment_status -ne 'NOT_STARTED' -or $detail.project.paypal_order_id) { throw 'Unconfirmed payment state was recorded' }
Write-Output "PASS no_credentials payment_status=$($detail.project.payment_status)"
