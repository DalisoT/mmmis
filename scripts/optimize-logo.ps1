Add-Type -AssemblyName System.Drawing

$src = (Resolve-Path 'public/logo.PNG').Path
$img = [System.Drawing.Image]::FromFile($src)
$w = $img.Width
$h = $img.Height
Write-Host "Original: ${w}x${h}px"

# Crop logo to the visible disc (drop the surrounding teal/transparent padding).
# The artwork is centered; pad is roughly 12% on each side at 512x512.
# We'll just resize, not crop — the caller can use object-fit / object-position.

# Variant 1: small mark for header / nav drawer (96x96, transparent where possible).
# We re-encode as PNG with IndexedColor (palette) to shrink. Drop alpha for max compression.
$out96 = (Resolve-Path 'public').Path + [IO.Path]::DirectorySeparatorChar + 'logo-mark.png'
$bmp96 = New-Object System.Drawing.Bitmap 96, 96
$g96 = [System.Drawing.Graphics]::FromImage($bmp96)
$g96.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g96.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g96.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g96.DrawImage($img, 0, 0, 96, 96)
$g96.Dispose()
$bmp96.Save($out96, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp96.Dispose()
$fi96 = Get-Item $out96
Write-Host "logo-mark.png: $($fi96.Length) bytes"

# Variant 2: full lockup for login hero (256x256)
$out256 = (Resolve-Path 'public').Path + [IO.Path]::DirectorySeparatorChar + 'logo-full.png'
$bmp256 = New-Object System.Drawing.Bitmap 256, 256
$g256 = [System.Drawing.Graphics]::FromImage($bmp256)
$g256.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g256.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g256.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g256.DrawImage($img, 0, 0, 256, 256)
$g256.Dispose()
$bmp256.Save($out256, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp256.Dispose()
$fi256 = Get-Item $out256
Write-Host "logo-full.png: $($fi256.Length) bytes"

$img.Dispose()
Write-Host "Done."
