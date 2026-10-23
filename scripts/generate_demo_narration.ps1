Add-Type -AssemblyName System.Speech

$repoRoot = Split-Path $PSScriptRoot -Parent
$srtPath = Join-Path $repoRoot 'docs/demo/demo_captions.srt'
$cueDir = Join-Path $repoRoot '.tmp_video/narration_cues'
$outputPath = Join-Path $repoRoot '.tmp_video/demo_narration.wav'
$assemblerPath = Join-Path $PSScriptRoot 'assemble_demo_narration.py'

New-Item -ItemType Directory -Path $cueDir -Force | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Zira Desktop')
$synth.Rate = -1
$synth.Volume = 88
$format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
    24000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
)

$captionText = [System.IO.File]::ReadAllText($srtPath, [System.Text.Encoding]::UTF8)
$blocks = $captionText.Trim() -split '\r?\n\s*\r?\n'
foreach ($block in $blocks) {
    $lines = $block -split '\r?\n'
    $cueId = [int]$lines[0]
    $text = ($lines[2..($lines.Length - 1)] -join ' ').Trim()
    $cuePath = Join-Path $cueDir ('{0:D3}.wav' -f $cueId)
    $synth.SetOutputToWaveFile($cuePath, $format)
    $synth.Speak($text)
    $synth.SetOutputToNull()
}

$synth.Dispose()
python $assemblerPath --srt $srtPath --audio-dir $cueDir --output $outputPath --duration 960
if ($LASTEXITCODE -ne 0) { throw 'Could not assemble timed narration.' }
Write-Output "Created timed narration: $outputPath"