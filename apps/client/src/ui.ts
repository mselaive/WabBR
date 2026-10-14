import { MAX_PLAYERS, MIN_PLAYERS, playerColor, type PlayerMeta } from "@wabbr/shared";
import { playerPortraitUrl } from "./render/textures.js";
import { ACHIEVEMENTS, hatUnlocked, selectHat, selectedHat, unlockedAchievements } from "./achievements.js";

export type ScreenName = "menu" | "lobby" | "result" | "connecting" | null;

export interface UICallbacks {
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
  onKick: (id: number) => void;
  onAddBot: () => void;
  onMode: (teamSize: number) => void;
  onPartner: (id: number) => void;
  onBotSkill: (skill: number) => void;
  onNight: (on: boolean) => void;
  onRules: (rules: number) => void;
  onMapMode: (mode: number) => void;
  onSecondChance: (on: boolean) => void;
  onBet: (id: number) => void;
}

/** La apuesta del espectador: por quién se puede apostar, o por quién apostaste. */
export interface BetChoice {
  options?: { id: number; name: string; color: string }[];
  chosen?: string;
}

const NAME_KEY = "wabbr:name";

/** Una fila del resultado final. */
export interface ResultRow {
  name: string;
  kills: number;
  colorIndex: number;
  /** Puesto final: 1 el ganador. Los que cayeron en el mismo tick comparten número. */
  place: number;
  isLocal: boolean;
  /** Se desconectó antes de que terminara. */
  left: boolean;
  damage: number;
  /** Aciertos sobre disparos, de 0 a 1. null si no disparó. */
  accuracy: number | null;
  /** Proyectiles disparados: la puntería con muy pocos no dice nada. */
  shots: number;
  /** Segundos que aguantó vivo. */
  survived: number;
  /** La kill más lejana, en metros. */
  longestKill: number;
  /** El título que se llevó ("Ciego: no dio una bala"). */
  title?: { label: string; detail: string };
  /** Su gorro, para el retrato del podio. */
  hat?: number;
}

/** Un premio del resultado: "más daño", "mejor puntería"... */
export interface Award {
  label: string;
  name: string;
  colorIndex: number;
  value: string;
}

/** Clase del puesto para pintarlo de oro, plata o bronce. */
const MEDAL = ["", "gold", "silver", "bronze"];

function killsText(kills: number): string {
  return kills === 1 ? "1 kill" : `${kills} kills`;
}

/** 154 -> "2:34" */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function cell(text: string, className = "num"): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id} en index.html`);
  return node as T;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Todo el HUD y los menúes son DOM: el texto queda nítido y se estila con CSS. */
export class UI {
  private readonly overlay = el("overlay");
  private readonly hud = el("hud");
  private readonly screens: Record<Exclude<ScreenName, null>, HTMLElement> = {
    menu: el("screenMenu"),
    lobby: el("screenLobby"),
    result: el("screenResult"),
    connecting: el("screenConnecting"),
  };

  private readonly btnCreate = el<HTMLButtonElement>("btnCreate");
  private readonly btnJoin = el<HTMLButtonElement>("btnJoin");

  private readonly nameInput = el<HTMLInputElement>("nameInput");
  private readonly codeInput = el<HTMLInputElement>("codeInput");
  private readonly menuError = el("menuError");
  private readonly roomCode = el<HTMLButtonElement>("roomCode");
  private readonly playerList = el("playerList");
  private readonly btnReady = el<HTMLButtonElement>("btnReady");
  private readonly btnStart = el<HTMLButtonElement>("btnStart");
  private readonly btnAddBot = el<HTMLButtonElement>("btnAddBot");
  private readonly lobbyHint = el("lobbyHint");

  private readonly aliveEl = el("alive");
  private readonly killsEl = el("kills");
  private readonly pingEl = el("ping");
  private readonly hpFill = el("hpFill");
  private readonly hpText = el("hpText");
  private readonly ammoEl = el("ammo");
  private readonly weaponName = el("weaponName");
  private readonly slotsEl = el("slots");
  private readonly modeSolo = el("modeSolo") as HTMLButtonElement;
  private readonly modeDuos = el("modeDuos") as HTMLButtonElement;
  private readonly shieldBar = el("shieldBar");
  private readonly shieldFill = el("shieldFill");
  private readonly staminaFill = el("staminaFill");
  private readonly consumablesEl = el("consumables");
  private readonly loadout = el("loadout");
  private readonly hiddenTag = el("hiddenTag");
  private readonly reconnecting = el("reconnecting");
  private readonly pickupPrompt = el("pickupPrompt");
  private readonly channel = el("channel");
  private readonly channelFill = el("channelFill");
  private readonly channelText = el("channelText");
  private readonly killfeed = el("killfeed");
  private readonly zoneBanner = el("zoneBanner");
  private readonly zoneLabel = el("zoneLabel");
  private readonly zoneTime = el("zoneTime");
  private readonly zoneAlert = el("zoneAlert");
  private readonly zoneAlertInfo = el("zoneAlertInfo");
  private readonly zoneVignette = el("zoneVignette");
  private readonly spectating = el("spectating");
  private readonly scoreboard = el("scoreboard");
  private readonly scoreboardList = el("scoreboardList");

  private readonly resultTitle = el("resultTitle");
  private readonly resultSubtitle = el("resultSubtitle");
  private readonly resultRecords = el("resultRecords");
  private readonly roomBest = el("roomBest");
  private readonly resultBets = el("resultBets");
  private readonly myStats = el("myStats");
  private readonly podium = el("podium");
  private readonly awards = el("awards");
  private readonly standings = el("standings");

  private ready = false;
  /** Firmas para no rehacer el DOM en cada cuadro si nada cambió. */
  private slotsSignature = "";
  private consumablesSignature = "";
  private streakTimer = 0;
  private spectatingSignature = "";

  constructor(private readonly cb: UICallbacks) {
    this.nameInput.value = localStorage.getItem(NAME_KEY) ?? "";
    this.refreshHats();

    // Si el link trae ?room=XXXX, precargar el código para que solo haya que entrar.
    const room = new URLSearchParams(location.search).get("room");
    if (room) {
      this.codeInput.value = room.toUpperCase();
      this.showInvite(room.toUpperCase());
    }

    this.btnCreate.addEventListener("click", () => {
      this.hideError();
      this.cb.onCreate(this.playerName());
    });

    this.btnJoin.addEventListener("click", () => this.tryJoin());
    this.codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.tryJoin();
    });
    this.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.tryJoin();
    });

    this.btnReady.addEventListener("click", () => {
      this.ready = !this.ready;
      this.btnReady.textContent = this.ready ? "Listo ✓" : "Estoy listo";
      this.btnReady.classList.toggle("is-ready", this.ready);
      this.cb.onReady(this.ready);
    });

    this.btnStart.addEventListener("click", () => this.cb.onStart());
    this.btnAddBot.addEventListener("click", () => this.cb.onAddBot());
    this.modeSolo.addEventListener("click", () => this.cb.onMode(1));
    this.modeDuos.addEventListener("click", () => this.cb.onMode(2));
    for (const b of el("rulesRow").querySelectorAll<HTMLButtonElement>("[data-rules]")) {
      b.addEventListener("click", () => this.cb.onRules(Number(b.dataset.rules)));
    }
    // Las opciones de sí o no: cada botón se prende y se apaga.
    const isOn = (id: string): boolean => el(id).getAttribute("aria-checked") === "true";
    el("optMap").addEventListener("click", () => this.cb.onMapMode(isOn("optMap") ? 0 : 1));
    el("optChance").addEventListener("click", () => this.cb.onSecondChance(!isOn("optChance")));
    el("optNight").addEventListener("click", () => this.cb.onNight(!isOn("optNight")));
    for (const b of el("botSkillRow").querySelectorAll<HTMLButtonElement>("[data-skill]")) {
      b.addEventListener("click", () => this.cb.onBotSkill(Number(b.dataset.skill)));
    }
    el("btnLeave").addEventListener("click", () => this.cb.onLeave());

    this.roomCode.addEventListener("click", () => this.copyInvite());
  }

  /**
   * Llegaste por un link de invitación: lo que querés es entrar a ESA sala.
   * Con "Crear sala" como botón grande, la gente lo apretaba y terminaba sola
   * en una sala nueva. Ahora el botón grande es entrar, y crear queda abajo.
   */
  private showInvite(code: string): void {
    const hint = el("inviteHint");
    hint.hidden = false;
    hint.replaceChildren("Te invitaron a la sala ", Object.assign(document.createElement("b"), { textContent: code }), ". Poné tu nombre y entrá.");
    el("menuActions").classList.add("invited");
    this.btnJoin.classList.add("btn-primary");
    this.btnJoin.textContent = "Entrar a la sala";
    this.btnCreate.classList.remove("btn-primary");
    this.btnCreate.classList.add("btn-ghost", "btn-small");
    this.btnCreate.textContent = "O crear una sala nueva";
  }

  private tryJoin(): void {
    const code = this.codeInput.value.trim().toUpperCase();
    if (code.length !== 6) {
      this.showError("El código tiene 6 caracteres.");
      return;
    }
    this.hideError();
    this.cb.onJoin(this.playerName(), code);
  }

  private playerName(): string {
    const name = this.nameInput.value.trim() || "Jugador";
    localStorage.setItem(NAME_KEY, name);
    return name;
  }

  private async copyInvite(): Promise<void> {
    const url = new URL(location.href);
    url.searchParams.set("room", this.roomCode.textContent ?? "");
    try {
      await navigator.clipboard.writeText(url.toString());
      this.roomCode.classList.add("copied");
      setTimeout(() => this.roomCode.classList.remove("copied"), 1200);
    } catch {
      // Sin permiso de portapapeles: al menos dejamos el link en la barra.
      history.replaceState(null, "", url);
    }
  }

  // ------------------------------------------------------------ pantallas

  /**
   * El selector de gorros del menú: los desbloqueados se eligen con un click;
   * los otros se ven apagados y dicen con qué logro se consiguen.
   */
  refreshHats(): void {
    const done = unlockedAchievements();
    const current = selectedHat();
    const hint = el("hatHint");
    const options = [{ hat: 0, name: "La gorra de siempre", how: "" }, ...ACHIEVEMENTS.map((a) => ({ hat: a.hat, name: a.hatName, how: `${a.name}: ${a.how}` }))];
    el("hatsCount").textContent = `· ${done.size}/${ACHIEVEMENTS.length} logros`;
    el("hatPicker").replaceChildren(
      ...options.map((o) => {
        const open = hatUnlocked(o.hat, done);
        const b = document.createElement("button");
        b.type = "button";
        b.className = `hat-option${open ? "" : " locked"}${o.hat === current ? " on" : ""}`;
        b.title = open ? o.name : `${o.name} · ${o.how}`;
        b.setAttribute("aria-label", b.title);
        const img = document.createElement("img");
        img.src = playerPortraitUrl(0x4aa3ff, o.hat);
        img.alt = "";
        b.append(img);
        b.addEventListener("click", () => {
          if (!open) {
            hint.textContent = `Bloqueado. ${o.how}.`;
            return;
          }
          selectHat(o.hat);
          hint.textContent = o.name;
          this.refreshHats();
        });
        return b;
      }),
    );
  }

  /** Tus números de siempre, abajo del nombre del juego. Vacío lo esconde. */
  setMyStats(line: string): void {
    this.myStats.hidden = line === "";
    this.myStats.textContent = line;
  }

  showScreen(name: ScreenName): void {
    for (const [key, node] of Object.entries(this.screens)) {
      node.hidden = key !== name;
    }
    this.overlay.hidden = name === null;
    this.hud.hidden = name !== null;
    document.body.classList.toggle("playing", name === null);
  }

  /**
   * Habilita crear y unirse. Arrancan apagados: el menú es visible desde el
   * primer instante, pero `Game.init()` es asíncrono y hasta que termina no hay
   * renderizador. Entrar antes revienta con un error que no dice nada.
   */
  setEntryEnabled(enabled: boolean): void {
    this.btnCreate.disabled = !enabled;
    this.btnJoin.disabled = !enabled;
  }

  showError(message: string): void {
    this.menuError.textContent = message;
    this.menuError.hidden = false;
  }

  hideError(): void {
    this.menuError.hidden = true;
  }

  resetReady(): void {
    this.ready = false;
    this.btnReady.textContent = "Estoy listo";
    this.btnReady.classList.remove("is-ready");
  }

  // --------------------------------------------------------------- lobby

  setRoom(code: string): void {
    this.roomCode.textContent = code;
  }

  setRoster(roster: PlayerMeta[], hostId: number, localId: number, teamSize = 1): void {
    this.setRoomBest(roster);
    const byId = new Map(roster.map((p) => [p.id, p]));
    const me = byId.get(localId);
    /** Con quién está emparejado (los dos se eligieron), o undefined. */
    const pairedWith = (p: PlayerMeta): PlayerMeta | undefined => {
      const other = p.partner === undefined ? undefined : byId.get(p.partner);
      return other?.partner === p.id ? other : undefined;
    };
    this.playerList.replaceChildren(
      ...roster.map((p) => {
        const li = document.createElement("li");
        li.className = "player-row";

        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = hex(playerColor(p.colorIndex));

        const who = document.createElement("span");
        who.className = "who";
        who.textContent = p.id === localId ? `${p.name} (vos)` : p.name;

        li.append(swatch, who);

        // El marcador de la noche: cuántas ganó de las que jugó en esta sala.
        if ((p.played ?? 0) > 0) {
          const tally = document.createElement("span");
          tally.className = "tally";
          tally.textContent =
            `${p.wins ?? 0}/${p.played} ganadas · ${p.totalKills ?? 0} kills` +
            (p.betsWon ? ` · ${p.betsWon} ${p.betsWon === 1 ? "apuesta" : "apuestas"}` : "");
          tally.title = `En esta sala: ganó ${p.wins ?? 0} de ${p.played} partidas e hizo ${p.totalKills ?? 0} kills`;
          li.append(tally);
        }

        if (teamSize === 2) li.append(...this.partnerControls(p, me, pairedWith));

        if (p.id === hostId) {
          const tag = document.createElement("span");
          tag.className = "tag host";
          tag.textContent = "HOST";
          li.append(tag);
        }
        if (p.bot) {
          const tag = document.createElement("span");
          tag.className = "tag bot";
          tag.textContent = "BOT";
          li.append(tag);
        }
        const state = document.createElement("span");
        state.className = p.ready ? "tag ready" : "tag";
        state.textContent = p.away ? "sin conexión" : p.ready ? "LISTO" : "esperando";
        li.append(state);

        // El host puede echar a cualquiera menos a sí mismo. El servidor lo
        // vuelve a comprobar: esconder el botón no es un control de acceso.
        if (hostId === localId && p.id !== hostId) {
          const kick = document.createElement("button");
          kick.className = "kick";
          kick.type = "button";
          kick.textContent = "✕";
          kick.title = `Echar a ${p.name}`;
          kick.setAttribute("aria-label", `Echar a ${p.name}`);
          kick.addEventListener("click", () => this.cb.onKick(p.id));
          li.append(kick);
        }

        return li;
      }),
    );

    const isHost = hostId === localId;
    this.btnStart.hidden = !isHost;
    this.btnStart.disabled = roster.length < MIN_PLAYERS;
    // Bots para completar la sala o practicar solo. El servidor vuelve a
    // comprobar que seas el host y que haya lugar.
    this.btnAddBot.hidden = !isHost;
    this.btnAddBot.disabled = roster.length >= MAX_PLAYERS;

    this.lobbyHint.textContent =
      roster.length < MIN_PLAYERS
        ? isHost
          ? `Hacen falta al menos ${MIN_PLAYERS} jugadores: invitá a alguien o agregá un bot.`
          : `Hacen falta al menos ${MIN_PLAYERS} jugadores.`
        : isHost
          ? "Cuando estén todos listos arranca sola, o podés forzarla."
          : "La partida arranca cuando estén todos listos.";
  }

  /**
   * En dúos, lo de la pareja en cada fila. Para los demás, un botón para
   * elegirlos (o aceptar si te eligieron); para los que ya están emparejados,
   * con quién. La pareja es mutua: hace falta que los dos se elijan.
   */
  private partnerControls(
    p: PlayerMeta,
    me: PlayerMeta | undefined,
    pairedWith: (p: PlayerMeta) => PlayerMeta | undefined,
  ): HTMLElement[] {
    const mate = pairedWith(p);
    if (!me || p.id === me.id) {
      if (!mate) return [];
      const tag = document.createElement("span");
      tag.className = "tag pair";
      tag.textContent = `con ${mate.name}`;
      return [tag];
    }
    if (mate && mate.id !== me.id) {
      const tag = document.createElement("span");
      tag.className = "tag pair";
      tag.textContent = `con ${mate.name}`;
      return [tag];
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pair-btn";
    const mine = me.partner === p.id;
    const theirs = p.partner === me.id;
    if (mine && theirs) {
      button.textContent = "Tu pareja";
      button.classList.add("on");
      button.title = "Tocá para separarse";
    } else if (mine) {
      button.textContent = "Esperando…";
      button.title = `Esperando que ${p.name} te elija. Tocá para cancelar.`;
    } else if (theirs) {
      button.textContent = "Aceptar pareja";
      button.classList.add("invite");
    } else {
      button.textContent = "Pareja";
      button.title = `Jugar con ${p.name}`;
    }
    button.addEventListener("click", () => this.cb.onPartner(mine ? -1 : p.id));
    return [button];
  }

  /**
   * El modo de la próxima partida. Lo cambia sólo el host; los demás lo ven
   * marcado pero no lo pueden tocar (y el servidor igual lo vuelve a comprobar).
   */
  setMode(teamSize: number, isHost: boolean): void {
    for (const [button, size] of [
      [this.modeSolo, 1],
      [this.modeDuos, 2],
    ] as const) {
      const on = teamSize === size;
      button.classList.toggle("on", on);
      button.setAttribute("aria-checked", String(on));
      button.disabled = !isHost;
    }
    this.modeDuos.title = "Las parejas se sortean al empezar";
  }

  /**
   * Lo mejor de la noche en esta sala, arriba de la lista: quién ganó más, quién
   * mató más y quién apuesta mejor. Sólo el que va primero solo: empatados, nadie.
   */
  private setRoomBest(roster: PlayerMeta[]): void {
    const leader = (score: (p: PlayerMeta) => number): PlayerMeta | undefined => {
      const sorted = [...roster].sort((a, b) => score(b) - score(a));
      const top = sorted[0];
      if (!top || score(top) <= 0) return undefined;
      return sorted[1] && score(sorted[1]) === score(top) ? undefined : top;
    };
    const parts: string[] = [];
    const wins = leader((p) => p.wins ?? 0);
    if (wins) parts.push(`Más ganadas: ${wins.name} (${wins.wins})`);
    const kills = leader((p) => p.totalKills ?? 0);
    if (kills) parts.push(`Más kills: ${kills.name} (${kills.totalKills})`);
    const bets = leader((p) => p.betsWon ?? 0);
    if (bets) parts.push(`Mejor apostador: ${bets.name} (${bets.betsWon})`);
    const el = this.roomBest;
    el.hidden = parts.length === 0;
    el.textContent = parts.length > 0 ? `La noche · ${parts.join(" · ")}` : "";
  }

  /** Las reglas especiales. Las cambia el host. */
  setRules(rules: number, isHost: boolean): void {
    for (const b of el("rulesRow").querySelectorAll<HTMLButtonElement>("[data-rules]")) {
      const on = Number(b.dataset.rules) === rules;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
      b.disabled = !isHost;
    }
  }

  /**
   * Siempre el mismo mapa o uno nuevo cada partida; con uno nuevo, el botón
   * dice cuál toca. Lo cambia el host.
   */
  setMap(mode: number, name: string, isHost: boolean): void {
    this.setSwitch("optMap", mode === 1, isHost);
    el("optMap").textContent = mode === 1 ? `Mapa: ${name}` : "Mapa nuevo";
  }

  /** De día o de noche. Lo cambia el host. */
  setNight(night: boolean, isHost: boolean): void {
    this.setSwitch("optNight", night, isHost);
  }

  /** Segunda oportunidad, sí o no. La cambia el host. */
  setSecondChance(on: boolean, isHost: boolean): void {
    this.setSwitch("optChance", on, isHost);
  }

  /** Una opción de sí o no. */
  private setSwitch(id: string, on: boolean, isHost: boolean): void {
    const b = el(id) as HTMLButtonElement;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
    b.disabled = !isHost;
  }

  /**
   * La dificultad de los bots. Se muestra sólo si hay algún bot en la sala; la
   * cambia el host.
   */
  setBotSkill(skill: number, isHost: boolean, hasBots: boolean): void {
    const row = el("botSkillRow");
    row.hidden = !hasBots;
    for (const b of row.querySelectorAll<HTMLButtonElement>("[data-skill]")) {
      const on = Number(b.dataset.skill) === skill;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
      b.disabled = !isHost;
    }
  }

  // ----------------------------------------------------------------- HUD

  setHud(v: {
    alive: number;
    kills: number;
    /** Ida y vuelta al servidor en ms, o null si todavía no se midió. */
    ping: number | null;
    hp: number;
    shield: number;
    stamina: number;
    ammo: number;
    magSize: number;
    reloading: boolean;
    weaponName: string;
    /** Color de la rareza del arma en la mano, en formato CSS. */
    weaponColor: string;
    slots: { key: string; name: string; color: string; active: boolean }[];
  }): void {
    this.aliveEl.textContent = String(v.alive);
    this.killsEl.textContent = String(v.kills);
    this.pingEl.textContent = v.ping === null ? "—" : String(v.ping);
    // Verde jugable, amarillo se nota, rojo es lo que explica una muerte rara.
    this.pingEl.className = v.ping === null || v.ping < 90 ? "" : v.ping < 160 ? "ping-mid" : "ping-bad";

    const hp = Math.max(0, Math.min(100, v.hp));
    this.hpFill.style.width = `${hp}%`;
    this.hpText.textContent = String(Math.round(hp));

    // El escudo sólo aparece si tenés puesto un chaleco.
    this.shieldBar.hidden = v.shield <= 0;
    this.shieldFill.style.width = `${Math.min(100, v.shield)}%`;

    this.staminaFill.style.width = `${Math.max(0, Math.min(100, v.stamina))}%`;
    // Apagada cuando se acabó: comunica "no podés correr" sin texto.
    this.staminaFill.classList.toggle("spent", v.stamina < 1);

    this.weaponName.textContent = v.weaponName;
    this.weaponName.style.color = v.weaponColor;
    this.ammoEl.textContent = v.reloading
      ? "RECARGANDO..."
      : v.magSize > 0
        ? `${v.ammo} / ${v.magSize}`
        : "SIN ARMA";

    if (this.slotsSignature !== JSON.stringify(v.slots)) {
      this.slotsSignature = JSON.stringify(v.slots);
      this.slotsEl.replaceChildren(
        ...v.slots.map((slot) => {
          const node = document.createElement("div");
          node.className = slot.active ? "slot active" : "slot";
          // El borde de la ranura lleva el color de la rareza que guarda.
          if (slot.color) node.style.borderColor = slot.color;
          const key = document.createElement("span");
          key.className = "key";
          key.textContent = slot.key;
          const name = document.createElement("span");
          name.textContent = slot.name;
          node.append(key, name);
          return node;
        }),
      );
    }
  }

  /**
   * Vida, arma y mochila. Se esconden cuando no hay a quién mostrar: en cámara
   * libre se veía tu propio muñeco muerto, con vida 0 y la pistola de arranque.
   */
  setLoadoutVisible(visible: boolean): void {
    this.loadout.hidden = !visible;
    this.consumablesEl.hidden = !visible;
  }

  /** Cantidades de vendas / botiquín / adrenalina, con su tecla. */
  setConsumables(items: { key: string; name: string; count: number }[]): void {
    const signature = JSON.stringify(items);
    if (this.consumablesSignature === signature) return;
    this.consumablesSignature = signature;

    this.consumablesEl.replaceChildren(
      ...items.map((item) => {
        const node = document.createElement("div");
        node.className = item.count > 0 ? "consumable" : "consumable empty";
        const key = document.createElement("span");
        key.className = "key";
        key.textContent = item.key;
        const name = document.createElement("span");
        name.textContent = item.name;
        const count = document.createElement("span");
        count.className = "count";
        count.textContent = String(item.count);
        node.append(key, name, count);
        return node;
      }),
    );
  }

  /** Aviso de que estás al lado de una fogata (y te falta vida). */
  setNearFire(near: boolean): void {
    const tag = el("fireTag");
    if (tag.hidden !== !near) tag.hidden = !near;
  }

  /** Aviso de que estás escondido: dónde ("en el arbusto", "en el humo"), o null. */
  setHidden(where: string | null): void {
    if (this.hiddenTag.hidden !== (where === null)) this.hiddenTag.hidden = where === null;
    const text = where === null ? "" : `Escondido ${where}`;
    if (where !== null && this.hiddenTag.textContent !== text) this.hiddenTag.textContent = text;
  }

  /** Aviso de "apretá E para recoger". null lo esconde. */
  setPickup(name: string | null): void {
    this.pickupPrompt.hidden = name === null;
    if (name === null) return;
    this.pickupPrompt.innerHTML = "";
    const key = document.createElement("b");
    key.textContent = "E";
    this.pickupPrompt.append(key, document.createTextNode(` ${name}`));
  }

  /** Progreso de la curación en curso (0..1). null la esconde. */
  setChannel(progress: number | null, label: string): void {
    this.channel.hidden = progress === null;
    if (progress === null) return;
    this.channelFill.style.width = `${Math.round(progress * 100)}%`;
    this.channelText.textContent = label;
  }

  setZoneBanner(label: string | null, time: string, danger: boolean): void {
    this.zoneBanner.hidden = label === null;
    if (label === null) return;
    this.zoneLabel.textContent = label;
    this.zoneTime.textContent = time;
    this.zoneBanner.classList.toggle("danger", danger);
  }

  /**
   * Aviso de que estás afuera de la zona: cuánto te saca por segundo y cuánto
   * aguantás así. null lo esconde.
   */
  setZoneAlert(alert: { dps: number; seconds: number } | null): void {
    this.zoneAlert.hidden = alert === null;
    // El viñeteado se apaga con una transición, así que se prende con una
    // clase y no con `hidden`, que lo cortaría de golpe.
    this.zoneVignette.classList.toggle("on", alert !== null);
    if (alert === null) return;
    this.zoneAlertInfo.textContent = `-${alert.dps} HP/s · aguantás ${alert.seconds} s`;
    this.zoneAlert.classList.toggle("critical", alert.seconds <= 5);
  }

  /** Aviso de que se cortó la conexión y se está reintentando. */
  setReconnecting(on: boolean): void {
    this.reconnecting.hidden = !on;
  }

  /** A quién estás mirando después de morir y cómo cambiar. null lo esconde. */
  setSpectating(view: { title: string; hint: string; note?: string; bet?: BetChoice } | null): void {
    this.spectating.hidden = view === null;
    if (view === null) return;
    // Se reescribe sólo si cambió: esto corre en cada cuadro.
    const bet = view.bet?.chosen ?? view.bet?.options?.map((o) => o.id).join(",") ?? "";
    const signature = `${view.title}|${view.hint}|${view.note ?? ""}|${bet}`;
    if (this.spectatingSignature === signature) return;
    this.spectatingSignature = signature;
    const title = document.createElement("span");
    title.className = "spectating-title";
    title.textContent = view.title;
    const hint = document.createElement("span");
    hint.className = "spectating-hint";
    hint.textContent = view.hint;
    this.spectating.replaceChildren(title, hint);
    if (view.note) {
      const note = document.createElement("span");
      note.className = "spectating-note";
      note.textContent = view.note;
      this.spectating.prepend(note);
    }
    if (view.bet?.chosen) {
      this.spectating.append(cell(`Apostaste por ${view.bet.chosen}`, "spectating-bet-done"));
    } else if (view.bet?.options) {
      const row = document.createElement("div");
      row.className = "spectating-bets";
      row.append(cell("¿Quién gana?", "spectating-bet-label"));
      for (const o of view.bet.options) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bet-btn";
        b.textContent = o.name;
        b.style.borderColor = o.color;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          this.cb.onBet(o.id);
        });
        row.append(b);
      }
      this.spectating.append(row);
    }
  }

  /**
   * Una línea del kill feed, al estilo de los shooters: quién, con qué y a
   * quién, con los nombres en el color de cada jugador. Es mucho más rápido de
   * leer que una frase, sobre todo cuando caen tres seguidas.
   */
  addKill(kill: {
    killerName: string | null;
    killerColor: string;
    victimName: string;
    victimColor: string;
    iconUrl: string;
    /** Resalta la línea si el jugador local mató o murió. */
    involvesMe: boolean;
  }): void {
    const line = document.createElement("div");
    line.className = kill.involvesMe ? "kill-line mine" : "kill-line";

    if (kill.killerName !== null) {
      const killer = document.createElement("span");
      killer.className = "who";
      killer.style.color = kill.killerColor;
      killer.textContent = kill.killerName;
      line.append(killer);
    }

    const icon = document.createElement("img");
    icon.className = "cause";
    icon.src = kill.iconUrl;
    icon.alt = "";
    line.append(icon);

    const victim = document.createElement("span");
    victim.className = "who";
    victim.style.color = kill.victimColor;
    victim.textContent = kill.victimName;
    line.append(victim);

    this.killfeed.append(line);
    setTimeout(() => line.remove(), 6500);
    while (this.killfeed.childElementCount > 5) this.killfeed.firstElementChild?.remove();
  }

  /** Un aviso en la columna del kill feed, resaltado: "paquete en camino". */
  /** "¡Doble kill!" en grande en el medio de la pantalla, un momento. */
  showStreak(text: string): void {
    const banner = el("streakBanner");
    banner.textContent = text;
    banner.hidden = false;
    // Reiniciar la animación aunque el anterior siga en pantalla.
    banner.classList.remove("pop");
    void banner.offsetWidth;
    banner.classList.add("pop");
    clearTimeout(this.streakTimer);
    this.streakTimer = window.setTimeout(() => (banner.hidden = true), 1800);
  }

  addNotice(text: string): void {
    const line = document.createElement("div");
    line.className = "kill-line notice";
    line.textContent = text;
    this.killfeed.append(line);
    setTimeout(() => line.remove(), 6500);
    while (this.killfeed.childElementCount > 5) this.killfeed.firstElementChild?.remove();
  }

  setScoreboard(
    visible: boolean,
    rows: {
      name: string;
      kills: number;
      alive: boolean;
      colorIndex: number;
      isLocal: boolean;
      away: boolean;
      /** Tu compañero en dúos. */
      mate?: boolean;
    }[],
  ): void {
    this.scoreboard.hidden = !visible;
    if (!visible) return;
    this.scoreboardList.replaceChildren(
      ...rows.map((r) => {
        const li = document.createElement("li");
        li.className = `score-row${r.alive ? "" : " dead"}${r.isLocal ? " me" : ""}${r.mate ? " mate" : ""}`;

        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = hex(playerColor(r.colorIndex));

        const who = document.createElement("span");
        who.className = "who";
        who.textContent = r.away ? `${r.name} (sin conexión)` : r.name;

        const kills = document.createElement("span");
        kills.textContent = `${r.kills}`;

        li.append(swatch, who, kills);
        return li;
      }),
    );
  }

  /**
   * Pantalla final: un podio con los tres primeros y abajo la tabla completa.
   * `rows` viene ordenada por puesto y, dentro del mismo puesto, por kills.
   */
  showResult(
    title: string,
    subtitle: string,
    rows: ResultRow[],
    awards: Award[],
    records: string[] = [],
    bets: string[] = [],
  ): void {
    this.resultTitle.textContent = title;
    this.resultSubtitle.textContent = subtitle;
    this.resultRecords.hidden = records.length === 0;
    this.resultRecords.textContent = records.length > 0 ? `¡Récord personal! ${records.join(" · ")}` : "";
    this.resultBets.hidden = bets.length === 0;
    this.resultBets.textContent = bets.length > 0 ? `Apuestas: ${bets.join(" · ")}` : "";

    // Segundo, primero, tercero: el ganador en el medio y más alto.
    const top = rows.slice(0, 3);
    const order = [1, 0, 2].filter((slot) => top[slot] !== undefined);
    this.podium.hidden = top.length === 0;
    this.podium.replaceChildren(...order.map((slot) => this.podiumSpot(top[slot]!, slot)));

    this.awards.hidden = awards.length === 0;
    this.awards.replaceChildren(
      ...awards.map((a) => {
        const card = document.createElement("div");
        card.className = "award";
        const who = cell(a.name, "award-who");
        who.style.color = hex(playerColor(a.colorIndex));
        card.append(cell(a.label, "award-label"), who, cell(a.value, "award-value"));
        return card;
      }),
    );

    const head = document.createElement("li");
    head.className = "result-head";
    head.setAttribute("aria-hidden", "true");
    head.append(
      cell("#", "place"),
      cell("", ""),
      cell("Jugador", "who"),
      cell("Kills"),
      cell("Daño"),
      cell("Punt."),
      cell("Vivo"),
    );

    this.standings.replaceChildren(
      head,
      ...rows.map((r) => {
        const li = document.createElement("li");
        li.className = r.isLocal ? "player-row standing me" : "player-row standing";

        const place = document.createElement("span");
        place.className = `place ${MEDAL[r.place] ?? ""}`;
        // "#1" y no "1°": la fuente pixelada dibuja el ° como un brillito.
        place.textContent = `#${r.place}`;

        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = hex(playerColor(r.colorIndex));

        const who = document.createElement("span");
        who.className = "who";
        who.textContent = r.isLocal ? `${r.name} (vos)` : r.name;
        if (r.title) {
          // El título de cada uno, abajo del nombre: nadie se va sin nada.
          const title = document.createElement("span");
          title.className = "row-title";
          const label = document.createElement("b");
          label.textContent = r.title.label;
          title.append(label, ` · ${r.title.detail}`);
          who.append(title);
        }
        if (r.left) {
          const left = document.createElement("span");
          left.className = "tag";
          left.textContent = "se fue";
          who.append(" ", left);
        }

        li.append(
          place,
          swatch,
          who,
          cell(String(r.kills)),
          cell(String(Math.round(r.damage))),
          cell(r.accuracy === null ? "—" : `${Math.round(r.accuracy * 100)}%`),
          cell(clock(r.survived)),
        );
        return li;
      }),
    );
    this.showScreen("result");
  }

  /** Un escalón del podio. `slot` es 0, 1 o 2: la altura del escalón, no el puesto. */
  private podiumSpot(r: ResultRow, slot: number): HTMLElement {
    const spot = document.createElement("div");
    spot.className = `podium-spot slot-${slot + 1}${r.isLocal ? " me" : ""}`;

    const avatar = document.createElement("img");
    avatar.className = "podium-avatar";
    avatar.src = playerPortraitUrl(playerColor(r.colorIndex), r.hat ?? 0);
    avatar.alt = "";

    const name = document.createElement("span");
    name.className = "podium-name";
    name.textContent = r.name;
    name.title = r.name;

    const kills = document.createElement("span");
    kills.className = "podium-kills";
    kills.textContent = killsText(r.kills);

    // El número es el puesto de verdad: si dos empataron en el segundo, los
    // dos escalones dicen 2.
    const block = document.createElement("div");
    block.className = `podium-block ${MEDAL[r.place] ?? ""}`;
    block.textContent = String(r.place);

    spot.append(avatar, name, kills, block);
    return spot;
  }
}
