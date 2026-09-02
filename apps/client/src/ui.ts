import { MIN_PLAYERS, playerColor, type PlayerMeta } from "@wabbr/shared";

export type ScreenName = "menu" | "lobby" | "result" | "connecting" | null;

export interface UICallbacks {
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
}

const NAME_KEY = "wabbr:name";

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
  private readonly lobbyHint = el("lobbyHint");

  private readonly aliveEl = el("alive");
  private readonly killsEl = el("kills");
  private readonly hpFill = el("hpFill");
  private readonly hpText = el("hpText");
  private readonly ammoEl = el("ammo");
  private readonly weaponName = el("weaponName");
  private readonly slotsEl = el("slots");
  private readonly shieldBar = el("shieldBar");
  private readonly shieldFill = el("shieldFill");
  private readonly staminaFill = el("staminaFill");
  private readonly consumablesEl = el("consumables");
  private readonly pickupPrompt = el("pickupPrompt");
  private readonly channel = el("channel");
  private readonly channelFill = el("channelFill");
  private readonly channelText = el("channelText");
  private readonly killfeed = el("killfeed");
  private readonly zoneBanner = el("zoneBanner");
  private readonly zoneLabel = el("zoneLabel");
  private readonly zoneTime = el("zoneTime");
  private readonly spectating = el("spectating");
  private readonly scoreboard = el("scoreboard");
  private readonly scoreboardList = el("scoreboardList");

  private readonly resultTitle = el("resultTitle");
  private readonly resultSubtitle = el("resultSubtitle");
  private readonly standings = el("standings");

  private ready = false;
  /** Firmas para no rehacer el DOM en cada cuadro si nada cambió. */
  private slotsSignature = "";
  private consumablesSignature = "";

  constructor(private readonly cb: UICallbacks) {
    this.nameInput.value = localStorage.getItem(NAME_KEY) ?? "";

    // Si el link trae ?room=XXXX, precargar el código para que solo haya que entrar.
    const room = new URLSearchParams(location.search).get("room");
    if (room) this.codeInput.value = room.toUpperCase();

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
    el("btnLeave").addEventListener("click", () => this.cb.onLeave());

    this.roomCode.addEventListener("click", () => this.copyInvite());
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

  setRoster(roster: PlayerMeta[], hostId: number, localId: number): void {
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

        if (p.id === hostId) {
          const tag = document.createElement("span");
          tag.className = "tag host";
          tag.textContent = "HOST";
          li.append(tag);
        }
        const state = document.createElement("span");
        state.className = p.ready ? "tag ready" : "tag";
        state.textContent = p.ready ? "LISTO" : "esperando";
        li.append(state);

        return li;
      }),
    );

    const isHost = hostId === localId;
    this.btnStart.hidden = !isHost;
    this.btnStart.disabled = roster.length < MIN_PLAYERS;

    this.lobbyHint.textContent =
      roster.length < MIN_PLAYERS
        ? `Hacen falta al menos ${MIN_PLAYERS} jugadores.`
        : isHost
          ? "Cuando estén todos listos arranca sola, o podés forzarla."
          : "La partida arranca cuando estén todos listos.";
  }

  // ----------------------------------------------------------------- HUD

  setHud(v: {
    alive: number;
    kills: number;
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

  setSpectating(text: string | null): void {
    this.spectating.hidden = text === null;
    if (text !== null) this.spectating.textContent = text;
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

  setScoreboard(
    visible: boolean,
    rows: { name: string; kills: number; alive: boolean; colorIndex: number; isLocal: boolean }[],
  ): void {
    this.scoreboard.hidden = !visible;
    if (!visible) return;
    this.scoreboardList.replaceChildren(
      ...rows.map((r) => {
        const li = document.createElement("li");
        li.className = `score-row${r.alive ? "" : " dead"}${r.isLocal ? " me" : ""}`;

        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = hex(playerColor(r.colorIndex));

        const who = document.createElement("span");
        who.className = "who";
        who.textContent = r.name;

        const kills = document.createElement("span");
        kills.textContent = `${r.kills}`;

        li.append(swatch, who, kills);
        return li;
      }),
    );
  }

  showResult(
    title: string,
    subtitle: string,
    rows: { name: string; kills: number; colorIndex: number }[],
  ): void {
    this.resultTitle.textContent = title;
    this.resultSubtitle.textContent = subtitle;
    this.standings.replaceChildren(
      ...rows.map((r, i) => {
        const li = document.createElement("li");
        li.className = "player-row";

        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = hex(playerColor(r.colorIndex));

        const who = document.createElement("span");
        who.className = "who";
        who.textContent = `${i + 1}. ${r.name}`;

        const kills = document.createElement("span");
        kills.className = "tag";
        kills.textContent = `${r.kills} kills`;

        li.append(swatch, who, kills);
        return li;
      }),
    );
    this.showScreen("result");
  }
}
