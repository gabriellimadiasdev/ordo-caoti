param(
  [Parameter(Mandatory = $true)]
  [string]$BucketName,

  [Parameter(Mandatory = $true)]
  [string]$DistributionId,

  [string]$FrontendDir = "frontend",

  [switch]$DeleteRemoved
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw 'AWS CLI nao encontrado. Instale e configure o perfil antes de executar.'
}

if (-not (Test-Path $FrontendDir)) {
  throw "Diretorio frontend nao encontrado: $FrontendDir"
}

Write-Host "[1/3] Upload de arquivos estaticos para s3://$BucketName" -ForegroundColor Cyan
$syncArgs = @('s3', 'sync', $FrontendDir, "s3://$BucketName", '--exact-timestamps')
if ($DeleteRemoved) { $syncArgs += '--delete' }
aws @syncArgs

Write-Host "[2/3] Ajuste de cache para HTML (curto)" -ForegroundColor Cyan
Get-ChildItem -Path $FrontendDir -Recurse -Filter *.html | ForEach-Object {
  $relativePath = $_.FullName.Substring((Resolve-Path $FrontendDir).Path.Length + 1).Replace('\\', '/')
  aws s3 cp $_.FullName "s3://$BucketName/$relativePath" --metadata-directive REPLACE --cache-control "max-age=60,public"
}

Write-Host "[3/3] Invalidacao CloudFront" -ForegroundColor Cyan
aws cloudfront create-invalidation --distribution-id $DistributionId --paths '/*'

Write-Host "Deploy finalizado com sucesso." -ForegroundColor Green
