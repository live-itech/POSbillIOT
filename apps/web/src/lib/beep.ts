let audio: AudioContext | null = null;

export function beep(level: 'info' | 'warning' | 'danger'): void {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = level === 'danger' ? 880 : level === 'warning' ? 660 : 520;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (level === 'danger' ? 0.5 : 0.25));
  } catch {
    // audio tidak tersedia (mis. belum ada interaksi pengguna)
  }
}
