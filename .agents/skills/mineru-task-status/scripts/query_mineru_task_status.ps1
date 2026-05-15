param(
    [Parameter(Mandatory = $true)]
    [string[]]$TaskId,

    [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"

function Resolve-ConfigPath {
    param([string]$RequestedPath)

    if ($RequestedPath) {
        if (-not (Test-Path -LiteralPath $RequestedPath)) {
            throw "Config file not found: $RequestedPath"
        }
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    if (Test-Path -LiteralPath "backend/config.yaml") {
        return (Resolve-Path -LiteralPath "backend/config.yaml").Path
    }
    if (Test-Path -LiteralPath "config.yaml") {
        return (Resolve-Path -LiteralPath "config.yaml").Path
    }

    throw "No config.yaml found. Expected backend/config.yaml or config.yaml."
}

function Read-MineruConfig {
    param([string]$Path)

    $lines = Get-Content -LiteralPath $Path
    $inParsers = $false
    $inMineru = $false
    $apiUrl = ""
    $apiToken = ""

    foreach ($line in $lines) {
        if ($line -match '^\S') {
            $inParsers = $false
            $inMineru = $false
        }

        if ($line -match '^parsers:\s*$') {
            $inParsers = $true
            $inMineru = $false
            continue
        }

        if ($inParsers -and $line -match '^\s{2}mineru:\s*$') {
            $inMineru = $true
            continue
        }

        if ($inMineru -and $line -match '^\s{2}\S') {
            $inMineru = $false
        }

        if ($inMineru -and $line -match '^\s{4}api_url:\s*"?([^"#]+?)"?\s*(?:#.*)?$') {
            $apiUrl = $Matches[1].Trim()
        }
        if ($inMineru -and $line -match '^\s{4}api_token:\s*"?([^"#]+?)"?\s*(?:#.*)?$') {
            $apiToken = $Matches[1].Trim()
        }
    }

    if (-not $apiUrl -or -not $apiToken) {
        throw "Could not read parsers.mineru.api_url/api_token from $Path"
    }

    [pscustomobject]@{
        ApiUrl = $apiUrl.TrimEnd("/")
        ApiToken = $apiToken
    }
}

$resolvedConfig = Resolve-ConfigPath -RequestedPath $ConfigPath
$mineru = Read-MineruConfig -Path $resolvedConfig
$results = @()

foreach ($id in $TaskId) {
    try {
        $response = Invoke-RestMethod `
            -Method Get `
            -Uri "$($mineru.ApiUrl)/extract/task/$id" `
            -Headers @{ Authorization = "Bearer $($mineru.ApiToken)"; Accept = "*/*" } `
            -TimeoutSec 60

        $results += [pscustomobject]@{
            task_id = $id
            code = $response.code
            msg = $response.msg
            trace_id = $response.trace_id
            data_id = $response.data.data_id
            state = $response.data.state
            err_msg = $response.data.err_msg
            full_zip_url_present = [bool]$response.data.full_zip_url
            model_version = $response.data.model_version
            extracted_pages = $response.data.extract_progress.extracted_pages
            total_pages = $response.data.extract_progress.total_pages
            start_time = $response.data.extract_progress.start_time
        }
    } catch {
        $results += [pscustomobject]@{
            task_id = $id
            error = $_.Exception.Message
        }
    }
}

$results | ConvertTo-Json -Depth 6
