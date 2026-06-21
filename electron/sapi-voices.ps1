$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voices = @($synth.GetInstalledVoices() | ForEach-Object {
    $info = $_.VoiceInfo
    [PSCustomObject]@{
      id = $info.Name
      name = $info.Name
      culture = $info.Culture.Name
      gender = $info.Gender.ToString()
      age = $info.Age.ToString()
      enabled = $_.Enabled
    }
  })
  $voices | ConvertTo-Json -Compress
}
finally {
  $synth.Dispose()
}
