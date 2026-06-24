<#
.SYNOPSIS
  整体平移 ASS/SRT 字幕时间轴。

.EXAMPLE
  # 字幕慢了，让它提前 500 毫秒（往前调）
  .\shift_ass.ps1 -Path "字幕.ass" -Ms -500

.EXAMPLE
  # 字幕快了，让它延后 1200 毫秒（往后调）
  .\shift_ass.ps1 -Path "字幕.ass" -Ms 1200

  默认会先备份原文件为 *.bak，然后直接改原文件。
  加 -Suffix 可以另存一份不覆盖原文件，例如 -Suffix ".shifted"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    # 平移的毫秒数：正数 = 往后（延迟出现），负数 = 往前（提前出现）
    [Parameter(Mandatory = $true)]
    [int]$Ms,

    # 另存后缀；留空则原地修改（会先生成 .bak 备份）
    [string]$Suffix = "",

    # 原地修改时跳过 .bak 备份
    [switch]$NoBackup
)

if (-not (Test-Path $Path)) { throw "找不到文件: $Path" }

# --- 读取并保留原始编码（ASS 常见 UTF-16 LE BOM 或 UTF-8）---
$bytes = [System.IO.File]::ReadAllBytes($Path)
$enc = $null
if     ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) { $enc = New-Object System.Text.UnicodeEncoding($false, $true) }       # UTF-16 LE BOM
elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) { $enc = New-Object System.Text.UnicodeEncoding($true,  $true) }       # UTF-16 BE BOM
elseif ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $enc = New-Object System.Text.UTF8Encoding($true) }  # UTF-8 BOM
else   { $enc = New-Object System.Text.UTF8Encoding($false) }                                                                                      # 默认 UTF-8 无 BOM
$text = $enc.GetString($bytes)

# --- 时间字符串 <-> 毫秒 ---
# ASS:  H:MM:SS.CC  (CC = 百分秒)
# SRT:  HH:MM:SS,mmm
function Shift-AssTime($h, $m, $s, $cc, $deltaMs) {
    $total = ([int]$h*3600 + [int]$m*60 + [int]$s)*1000 + [int]$cc*10 + $deltaMs
    if ($total -lt 0) { $total = 0 }
    $H  = [int][math]::Floor($total / 3600000); $total -= $H*3600000
    $M  = [int][math]::Floor($total / 60000);   $total -= $M*60000
    $S  = [int][math]::Floor($total / 1000);    $total -= $S*1000
    $C  = [int][math]::Round($total / 10)
    if ($C -ge 100) { $C -= 100; $S++ }   # 四舍五入进位
    "{0}:{1:D2}:{2:D2}.{3:D2}" -f $H, $M, $S, $C
}
function Shift-SrtTime($h, $m, $s, $ms, $deltaMs) {
    $total = ([int]$h*3600 + [int]$m*60 + [int]$s)*1000 + [int]$ms + $deltaMs
    if ($total -lt 0) { $total = 0 }
    $H  = [int][math]::Floor($total / 3600000); $total -= $H*3600000
    $M  = [int][math]::Floor($total / 60000);   $total -= $M*60000
    $S  = [int][math]::Floor($total / 1000);    $total -= $S*1000
    "{0:D2}:{1:D2}:{2:D2},{3:D3}" -f $H, $M, $S, [int]$total
}

$count = 0
# ASS 时间戳: H:MM:SS.CC
$text = [regex]::Replace($text, '(\d+):(\d{2}):(\d{2})\.(\d{2})', {
    param($mt)
    $script:count++
    Shift-AssTime $mt.Groups[1].Value $mt.Groups[2].Value $mt.Groups[3].Value $mt.Groups[4].Value $Ms
})
# SRT 时间戳: HH:MM:SS,mmm
$text = [regex]::Replace($text, '(\d{2}):(\d{2}):(\d{2}),(\d{3})', {
    param($mt)
    $script:count++
    Shift-SrtTime $mt.Groups[1].Value $mt.Groups[2].Value $mt.Groups[3].Value $mt.Groups[4].Value $Ms
})

# --- 写出 ---
if ($Suffix -ne "") {
    $dir  = Split-Path $Path -Parent
    $name = [System.IO.Path]::GetFileNameWithoutExtension($Path)
    $ext  = [System.IO.Path]::GetExtension($Path)
    $out  = Join-Path $dir "$name$Suffix$ext"
} else {
    if (-not $NoBackup) {
        $bak = "$Path.bak"
        if (-not (Test-Path $bak)) { [System.IO.File]::WriteAllBytes($bak, $bytes) }
    }
    $out = $Path
}

[System.IO.File]::WriteAllText($out, $text, $enc)

$dir = if ($Ms -ge 0) { "往后(延迟) +$Ms ms" } else { "往前(提前) $Ms ms" }
Write-Host "OK: 平移 $dir，共修改 $count 个时间戳"
Write-Host "输出: $out"
