# notify-dev-stable.ps1
# Edits the "in development" Slack message to show Lynxedo is back to stable.
# Run when the dev session is complete and the server is confirmed stable.

# Read Slack token from jobber-mcp .env (same token used by the MCP server)
$envFile = "H:\Shared drives\Claude\Projects\jobber-mcp\.env"
$TOKEN = (Get-Content $envFile | Where-Object { $_ -match "^SLACK_BOT_TOKEN=" }) -replace "^SLACK_BOT_TOKEN=",""
$CHANNEL = "C0B26LLE2TD"
$STATE_FILE = "$env:LOCALAPPDATA\lynxedo-dev-session\ts.txt"

if (-not (Test-Path $STATE_FILE)) {
    Write-Host "No active dev session found - nothing to update."
    exit 0
}

$body = '{"channel":"' + $CHANNEL + '","text":":white_check_mark: *Lynxedo is back up and stable.* Development session complete."}'

$response = Invoke-RestMethod -Uri "https://slack.com/api/chat.postMessage" -Method POST -ContentType "application/json; charset=utf-8" -Headers @{ Authorization = "Bearer $TOKEN" } -Body $body

if ($response.ok) {
    Remove-Item $STATE_FILE -Force
    Write-Host "Posted: Lynxedo back to stable."
} else {
    Write-Host "ERROR: Slack returned $($response.error)"
    exit 1
}
