# Generate 16 kHz 16-bit Audio Dataset for TinyML KWS
Add-Type -AssemblyName System.Speech

$baseDir = "c:\Users\ashis\.gemini\antigravity-ide\scratch\Iotproject\kws\dataset"
$classes = @("parity", "hello_parity", "hey_parity", "noise")

foreach ($c in $classes) {
    $dir = Join-Path $baseDir $c
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

$phrases = @{
    "parity" = "parity"
    "hello_parity" = "hello parity"
    "hey_parity" = "hey parity"
}

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$installedVoices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled }

$rates = @(-6, -4, -2, 0, 2, 4, 6)

Write-Host "Synthesizing 16 kHz audio files..."
$count = 0

foreach ($voice in $installedVoices) {
    $synth.SelectVoice($voice.VoiceInfo.Name)
    $vName = $voice.VoiceInfo.Name.Split(" ")[1] # e.g. David or Zira
    
    foreach ($item in $phrases.GetEnumerator()) {
        $label = $item.Key
        $text = $item.Value
        
        foreach ($r in $rates) {
            $synth.Rate = $r
            $outFile = Join-Path $baseDir "$label\$($label)_$($vName)_rate$($r).wav"
            
            $synth.SetOutputToWaveFile($outFile, $format)
            $synth.Speak($text)
            $synth.SetOutputToNull()
            $count++
        }
    }
}

$synth.Dispose()
Write-Host "Generated $count synthetic speech samples!"

# Generate background noise & silence files using Python
& "C:\Users\ashis\.mcuxpressotools\python-3.12\python.exe" -c "
import os, numpy as np, scipy.io.wavfile as wavfile

dataset_dir = r'$baseDir'
noise_dir = os.path.join(dataset_dir, 'noise')
os.makedirs(noise_dir, exist_ok=True)

# Generate 25 ambient noise files
for i in range(25):
    noise = (np.random.randn(16000) * np.random.randint(60, 250)).astype(np.int16)
    wavfile.write(os.path.join(noise_dir, f'noise_{i}.wav'), 16000, noise)

# Generate 5 electrical hum files
t = np.linspace(0, 1.0, 16000, endpoint=False)
for freq in [50, 60, 100, 120]:
    hum = (np.sin(2 * np.pi * freq * t) * 350).astype(np.int16)
    wavfile.write(os.path.join(noise_dir, f'hum_{freq}hz.wav'), 16000, hum)

# Center and normalize all speech files to 16000 samples (1 second)
for label in ['parity', 'hello_parity', 'hey_parity']:
    folder = os.path.join(dataset_dir, label)
    for fname in os.listdir(folder):
        if not fname.endswith('.wav'): continue
        fpath = os.path.join(folder, fname)
        sr, data = wavfile.read(fpath)
        if len(data.shape) > 1: data = data[:, 0]
        data = data.astype(np.float32)
        m = np.max(np.abs(data))
        if m > 0: data = (data / m) * 26000.0
        data = data.astype(np.int16)
        if len(data) < 16000:
            pad = 16000 - len(data)
            p1 = pad // 2
            p2 = pad - p1
            data = np.pad(data, (p1, p2), mode='constant')
        else:
            data = data[:16000]
        wavfile.write(fpath, 16000, data)
print('Noise generated and all samples normalized to 16 kHz 1-second format!')
"
