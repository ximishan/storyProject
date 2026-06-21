param(
  [Parameter(Mandatory = $true)][string]$TextPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [int]$Rate = 0,
  [int]$Volume = 100,
  [string]$VoiceName = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($TextPath, [System.Text.Encoding]::UTF8)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $synth.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
  $synth.Volume = [Math]::Max(0, [Math]::Min(100, $Volume))
  if (-not [string]::IsNullOrWhiteSpace($VoiceName)) {
    $synth.SelectVoice($VoiceName)
  }
  $synth.SetOutputToWaveFile($OutputPath)
  $synth.Speak($text)
}
finally {
  $synth.Dispose()
}
