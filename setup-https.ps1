# Generate self-signed certificate for local HTTPS
Write-Host "Generating self-signed certificate for HTTPS..." -ForegroundColor Green

$cert = New-SelfSignedCertificate `
    -DnsName "localhost", "172.20.10.2" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyExportPolicy Exportable `
    -KeySpec Signature `
    -KeyLength 2048 `
    -KeyAlgorithm RSA `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(1)

# Export certificate to PFX
$password = ConvertTo-SecureString -String "foreman2024" -Force -AsPlainText
$certPath = Join-Path $PSScriptRoot "server-cert.pfx"
Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" -FilePath $certPath -Password $password | Out-Null

# Also export to PEM format for compatibility
$certPemPath = Join-Path $PSScriptRoot "server-cert.pem"
$keyPemPath = Join-Path $PSScriptRoot "server-key.pem"

# Export certificate
$certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
$certPem = [System.Convert]::ToBase64String($certBytes, [System.Base64FormattingOptions]::InsertLineBreaks)
"-----BEGIN CERTIFICATE-----`n$certPem`n-----END CERTIFICATE-----" | Out-File -FilePath $certPemPath -Encoding ASCII

Write-Host "`nCertificate created successfully!" -ForegroundColor Green
Write-Host "PFX Location: $certPath" -ForegroundColor Cyan
Write-Host "PEM Location: $certPemPath" -ForegroundColor Cyan
Write-Host "Password: foreman2024" -ForegroundColor Cyan
Write-Host "`nServer will use HTTPS automatically." -ForegroundColor Yellow
Write-Host "Access via: https://172.20.10.2:3000" -ForegroundColor Yellow
Write-Host "Accept the security warning when prompted." -ForegroundColor Yellow
