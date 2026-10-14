/**
 * Sonido, generado por código igual que el arte: sin archivos que descargar.
 * Ruido filtrado para disparos y explosiones, tonos cortos para los avisos.
 *
 * Los sonidos del mundo se escuchan según dónde pasan: más bajo cuanto más
 * lejos, y del lado de donde vienen. Con la línea de vista tapando lo que pasa
 * detrás de una pared, oír un tiro a la izquierda es información.
 *
 * El navegador no deja sonar nada hasta que la página recibe un click o una
 * tecla, así que el contexto de audio se crea recién con la primera.
 */

const MUTE_KEY = "wabbr:mute";
/** Más lejos que esto no se oye: algo más que la pantalla. */
const HEARING = 1100;
/** Volumen general. Bajo a propósito: es fácil subirlo y molesto que te aturda. */
const MASTER = 0.35;

/** Cómo suena cada arma, por índice: filtro del ruido, cola y golpe grave. */
const WEAPON_VOICES = [
  { filter: 1800, decay: 0.09, thump: 120, gain: 0.7 }, // pistola
  { filter: 2400, decay: 0.06, thump: 140, gain: 0.55 }, // subfusil
  { filter: 2000, decay: 0.1, thump: 100, gain: 0.75 }, // rifle
  { filter: 900, decay: 0.22, thump: 70, gain: 1 }, // escopeta
  { filter: 2600, decay: 0.35, thump: 60, gain: 1 }, // francotirador
  { filter: 4000, decay: 0.05, thump: 0, gain: 0.35 }, // ballesta: un chasquido
  { filter: 600, decay: 0.45, thump: 45, gain: 1 }, // lanzacohetes: un soplido grave
  { filter: 1500, decay: 0.16, thump: 90, gain: 0.95 }, // revólver: seco y fuerte
  { filter: 2200, decay: 0.07, thump: 120, gain: 0.6 }, // ametralladora
];

export class Sound {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      // Sin almacenamiento: se arranca con sonido.
    }
  }

  /**
   * Llamar con el primer gesto del jugador: antes, el navegador no deja sonar.
   * `context` es para medir los sonidos sin parlantes (un OfflineAudioContext).
   */
  unlock(context?: BaseAudioContext): void {
    if (this.ctx) {
      if (this.ctx instanceof AudioContext && this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      this.ctx = context ?? new AudioContext();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER;
    this.master.connect(this.ctx.destination);
    // Un segundo de ruido blanco, reusado por todos los sonidos que lo necesitan.
    const length = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      // Igual se aplica en esta sesión.
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  // ------------------------------------------------------------ sonidos

  /** Un disparo. `at` y `from` ubican el sonido; sin ellos suena en el centro (el tuyo). */
  shot(weapon: number, at?: Spot): void {
    const v = WEAPON_VOICES[weapon] ?? WEAPON_VOICES[0]!;
    const out = this.voice(at, v.gain);
    if (!out) return;
    this.noiseBurst(out, { type: "lowpass", freq: v.filter, decay: v.decay, gain: 1 });
    if (v.thump > 0) this.tone(out, { freq: v.thump, endFreq: v.thump * 0.5, decay: 0.08, gain: 0.8, type: "sine" });
  }

  /** Bala contra una pared: un tic seco, sólo de cerca. */
  impact(at: Spot): void {
    const out = this.voice(at, 0.25);
    if (out) this.noiseBurst(out, { type: "highpass", freq: 2500, decay: 0.025, gain: 1 });
  }

  /** Le pegaste a alguien: el tic de confirmación de los shooters. */
  hitConfirm(): void {
    const out = this.voice(undefined, 0.35);
    if (out) this.tone(out, { freq: 1500, decay: 0.04, gain: 1, type: "square" });
  }

  /** Te pegaron: un golpe sordo. */
  hurt(): void {
    const out = this.voice(undefined, 0.6);
    if (!out) return;
    this.tone(out, { freq: 110, endFreq: 60, decay: 0.12, gain: 1, type: "sine" });
    this.noiseBurst(out, { type: "lowpass", freq: 500, decay: 0.06, gain: 0.6 });
  }

  /** Mataste a alguien: dos notas que suben. */
  kill(): void {
    const out = this.voice(undefined, 0.45);
    if (!out) return;
    this.tone(out, { freq: 660, decay: 0.12, gain: 0.8, type: "triangle" });
    this.tone(out, { freq: 990, decay: 0.22, gain: 0.8, type: "triangle", delay: 0.08 });
  }

  /** Una racha tuya: más notas cuanto más larga. */
  streak(level: number): void {
    const out = this.voice(undefined, 0.45);
    if (!out) return;
    const notes = [660, 880, 990, 1320, 1760];
    for (let i = 0; i < Math.min(notes.length, level + 1); i++) {
      this.tone(out, { freq: notes[i]!, decay: 0.12, gain: 0.8, type: "square", delay: i * 0.07 });
    }
  }

  /** Te mataron: una nota que cae. */
  death(): void {
    const out = this.voice(undefined, 0.5);
    if (out) this.tone(out, { freq: 330, endFreq: 110, decay: 0.6, gain: 0.8, type: "triangle" });
  }

  explosion(at?: Spot): void {
    const out = this.voice(at, 1);
    if (!out) return;
    this.noiseBurst(out, { type: "lowpass", freq: 1400, endFreq: 150, decay: 0.7, gain: 1 });
    this.tone(out, { freq: 70, endFreq: 35, decay: 0.5, gain: 1, type: "sine" });
  }

  /** Un hongo saltarín: un "boing" que sube. */
  jump(): void {
    const out = this.voice(undefined, 0.4);
    if (out) this.tone(out, { freq: 180, endFreq: 520, decay: 0.3, gain: 0.9, type: "sine" });
  }

  /** Una molotov se rompe: vidrio y una llamarada. */
  fire(at?: Spot): void {
    const out = this.voice(at, 0.7);
    if (!out) return;
    this.noiseBurst(out, { type: "highpass", freq: 5000, decay: 0.08, gain: 0.8 });
    this.noiseBurst(out, { type: "lowpass", freq: 900, endFreq: 300, decay: 0.8, gain: 1, delay: 0.05 });
  }

  /** Una granada de humo se abre: un siseo largo que baja. */
  smoke(at?: Spot): void {
    const out = this.voice(at, 0.5);
    if (!out) return;
    this.noiseBurst(out, { type: "highpass", freq: 3500, endFreq: 1200, decay: 0.9, gain: 0.8 });
    this.tone(out, { freq: 90, endFreq: 50, decay: 0.15, gain: 0.5, type: "sine" });
  }

  /** Alguien de tu pareja marcó un lugar: dos notas cortas que suben. */
  mark(): void {
    const out = this.voice(undefined, 0.3);
    if (!out) return;
    this.tone(out, { freq: 880, decay: 0.07, gain: 1, type: "sine" });
    this.tone(out, { freq: 1320, decay: 0.1, gain: 1, type: "sine", delay: 0.07 });
  }

  /** Recarga: dos clics. */
  reload(): void {
    const out = this.voice(undefined, 0.6);
    if (!out) return;
    this.noiseBurst(out, { type: "bandpass", freq: 3000, decay: 0.015, gain: 1 });
    this.noiseBurst(out, { type: "bandpass", freq: 2200, decay: 0.02, gain: 1, delay: 0.14 });
  }

  pickup(): void {
    const out = this.voice(undefined, 0.3);
    if (out) this.tone(out, { freq: 600, endFreq: 950, decay: 0.07, gain: 1, type: "sine" });
  }

  /** Quedaste afuera de la zona. */
  zoneWarning(): void {
    const out = this.voice(undefined, 0.3);
    if (!out) return;
    this.tone(out, { freq: 440, decay: 0.12, gain: 1, type: "square" });
    this.tone(out, { freq: 330, decay: 0.16, gain: 1, type: "square", delay: 0.15 });
  }

  /** Se anunció un paquete aéreo. */
  airdrop(): void {
    const out = this.voice(undefined, 0.35);
    if (out) this.tone(out, { freq: 260, endFreq: 520, decay: 0.5, gain: 0.8, type: "triangle" });
  }

  /** Se anunció un bombardeo: una sirena que sube y baja dos veces. */
  siren(): void {
    const out = this.voice(undefined, 0.3);
    if (!out) return;
    for (let i = 0; i < 2; i++) {
      this.tone(out, { freq: 520, endFreq: 880, decay: 0.45, gain: 0.9, type: "sawtooth", delay: i * 0.9 });
      this.tone(out, { freq: 880, endFreq: 520, decay: 0.45, gain: 0.9, type: "sawtooth", delay: i * 0.9 + 0.45 });
    }
  }

  /** Aterrizó un paquete. */
  landing(at?: Spot): void {
    const out = this.voice(at, 0.9);
    if (!out) return;
    this.noiseBurst(out, { type: "lowpass", freq: 500, decay: 0.25, gain: 1 });
    this.tone(out, { freq: 80, endFreq: 40, decay: 0.3, gain: 1, type: "sine" });
  }

  // ------------------------------------------------------------ piezas

  /**
   * El nodo al que conectar un sonido: con volumen por distancia y paneo
   * según de qué lado viene. null si no hay audio o está tan lejos que no se oye.
   */
  private voice(at: Spot | undefined, gain: number): GainNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return null;

    let volume = gain;
    let pan = 0;
    if (at) {
      const dx = at.x - at.listenerX;
      const dy = at.y - at.listenerY;
      const dist = Math.hypot(dx, dy);
      if (dist > HEARING) return null;
      // Cae parejo hasta cero en el límite: cuadrático suena más natural que lineal.
      volume *= (1 - dist / HEARING) ** 2;
      // Nunca del todo de un lado: con un oído mudo suena raro, no ubicado.
      pan = Math.max(-0.8, Math.min(0.8, dx / 900));
    }
    if (volume < 0.01) return null;

    const g = ctx.createGain();
    g.gain.value = volume;
    if (pan !== 0) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      g.connect(panner).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  private noiseBurst(
    out: GainNode,
    o: { type: BiquadFilterType; freq: number; endFreq?: number; decay: number; gain: number; delay?: number },
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    // Cada vez desde otro punto del ruido: si no, todos los tiros sonarían idénticos.
    const offset = Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.frequency.setValueAtTime(o.freq, t);
    if (o.endFreq) filter.frequency.exponentialRampToValueAtTime(o.endFreq, t + o.decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(o.gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + o.decay);
    src.connect(filter).connect(env).connect(out);
    src.start(t, offset, o.decay + 0.05);
  }

  private tone(
    out: GainNode,
    o: { freq: number; endFreq?: number; decay: number; gain: number; type: OscillatorType; delay?: number },
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.endFreq) osc.frequency.exponentialRampToValueAtTime(o.endFreq, t + o.decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(o.gain, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + o.decay + 0.05);
  }
}

/** Dónde pasa algo y desde dónde se escucha. */
export interface Spot {
  x: number;
  y: number;
  listenerX: number;
  listenerY: number;
}
