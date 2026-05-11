# notify-dev-start.ps1
# Posts a "Lynxedo is in development mode" message to #ai-updates.
# Saves the message timestamp so notify-dev-stable.ps1 can edit it later.

# Read Slack token from jobber-mcp .env (same token used by the MCP server)
$envFile = "H:\Shared drives\Claude\Projects\jobber-mcp\.env"
$TOKEN = (Get-Content $envFile | Where-Object { $_ -match "^SLACK_BOT_TOKEN=" }) -replace "^SLACK_BOT_TOKEN=",""
$CHANNEL = "C0B26LLE2TD"
$STATE_FILE = "$env:LOCALAPPDATA\lynxedo-dev-session\ts.txt"

if (Test-Path $STATE_FILE) {
    Write-Host "Already in dev mode - skipping post."
    exit 0
}

$body = '{"channel":"' + $CHANNEL + '","text":":hammer_and_wrench: *Lynxedo is in development mode.* You may experience short, temporary outages. We will post here when it is back to stable."}'

$response = Invoke-RestMethod -Uri "https://slack.com/api/chat.postMessage" -Method POST -ContentType "application/json; charset=utf-8" -Headers @{ Authorization = "Bearer $TOKEN" } -Body $body

if ($response.ok) {
    New-Item -ItemType Directory -Force -Path (Split-Path $STATE_FILE) | Out-Null
    $response.ts | Out-File -FilePath $STATE_FILE -Encoding utf8
    Write-Host "Posted: Lynxedo in development mode."
} else {
    Write-Host "ERROR: Slack returned $($response.error)"
    exit 1
}
