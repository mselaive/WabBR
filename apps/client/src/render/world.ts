import {
  AlphaFilter,
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  TilingSprite,
  type Texture,
} from "pixi.js";
import {
  PLAYER_RADIUS,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  WORLD_RADIUS,
  AIRDROP_FALL_TICKS,
  ITEM_ARMOR,
  GRENADE_SMOKE,
  ITEM_GRENADE,
  SMOKE_RADIUS,
  STRIKE_RADIUS,
  smokeRadius,
  ITEM_WEAPON,
  itemColor,
  rarityAt,
  BLOCKS_SIGHT,
  makeRng,
  playerColor,
  type GroundItem,
  type ArenaMap,
  type Obstacle,
  type PlayerMeta,
  type UnpackedPlayer,
} from "@wabbr/shared";
import { getTextures, ART_SCALE, type TexturePack } from "./textures.js";
import type { InterpolatedFrame } from "../net/interpolation.js";

/** Altura del mundo visible, en unidades del mundo. Fija el zoom de la cámara. */
const VIEW_HEIGHT = 640;
/**
 * Cuánto puede alejarse la cámara del centro de la arena. Sin este límite, un
 * jugador pegado al muro ve media pantalla de vacío en vez de campo de juego.
 */
const CAMERA_MAX_OFFSET = WORLD_RADIUS - 210;

/**
 * Estilo del suelo de cada distrito, en el mismo orden que los índices que usa
 * el generador del mapa. `markW/markH` es la forma de la marca: los surcos del
 * campo son rayas largas, la gravilla son puntos.
 */
const GROUND_STYLES: {
  base: number;
  dark: number;
  light: number;
  marks: number;
  markW: number;
  markH: number;
}[] = [
  // 0 asfalto
  { base: 0x4b4e52, dark: 0x43464a, light: 0x585c61, marks: 700, markW: 3, markH: 2 },
  // 1 tierra arada: rayas largas, que leen como surcos.
  { base: 0x7d5a34, dark: 0x684927, light: 0x936c3f, marks: 900, markW: 18, markH: 3 },
  // 2 gravilla
  { base: 0x6f6a62, dark: 0x5d5951, light: 0x847d73, marks: 1100, markW: 3, markH: 3 },
  // 3 tierra pisada
  { base: 0x93794d, dark: 0x836b43, light: 0xa4885a, marks: 800, markW: 5, markH: 4 },
];

/**
 * Hasta dónde se buscan obstáculos que proyecten sombra. Un poco más que la
 * esquina de la pantalla con la mira del francotirador puesta, en pantalla
 * ancha y con la cámara corrida hacia el cursor.
 */
const SHADOW_RANGE = 1300;
/** Largo de la sombra: alcanza con que salga de la pantalla. */
const SHADOW_LENGTH = 2200;

const shadowScratch: number[] = [];

/** Aleja el punto de la luz, hasta bien afuera de lo que se ve. */
function project(x: number, y: number, lx: number, ly: number): { x: number; y: number } {
  const dx = x - lx;
  const dy = y - ly;
  const len = Math.hypot(dx, dy) || 1;
  return { x: x + (dx / len) * SHADOW_LENGTH, y: y + (dy / len) * SHADOW_LENGTH };
}

interface PlayerView {
  root: Container;
  body: Sprite;
  shirt: Sprite;
  gun: Sprite;
  flash: Sprite;
  label: Text;
  hpBar: Graphics;
  lastAmmo: number;
}

interface Effect {
  node: Container;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  kind: "flash" | "spark" | "blood" | "blast" | "number" | "puff";
}

export class WorldView {
  private readonly tex: TexturePack;
  /** Contenedor con la cámara aplicada. Todo lo del mundo cuelga de acá. */
  private readonly camera = new Container();
  private readonly groundLayer = new Container();
  /** Capas de suelo recortadas por la máscara circular de la arena. */
  private terrain!: Container;
  /** Capa ordenada por Y: es lo que hace que puedas esconderte detrás de un árbol. */
  private readonly entityLayer = new Container();
  /** Los objetos van debajo de los jugadores: nunca tapan a alguien. */
  private readonly itemLayer = new Container();
  /** Sombras proyectadas por lo que tapa la vista. */
  private readonly shadowLayer = new Graphics();
  private readonly bulletLayer = new Container();
  private readonly effectLayer = new Container();
  /** Nubes de humo: encima de jugadores, balas y efectos, que es lo que tapan. */
  private readonly smokeLayer = new Container();
  private readonly smokeClouds = new Map<number, Container>();
  private readonly zoneLayer = new Graphics();
  /** Dónde va a caer cada paquete aéreo: anillo y sombra, debajo de los jugadores. */
  private readonly airdropGround = new Graphics();
  /** Los bombardeos: un círculo rojo en el piso. */
  private readonly strikeLayer = new Graphics();
  /** Lo que está en el aire, por encima de todo. */
  private readonly skyLayer = new Container();
  private readonly airdropSprites = new Map<number, Sprite>();
  /** Capa en coordenadas de pantalla (mira). */
  private readonly screenLayer = new Container();
  private readonly crosshair = new Graphics();

  private readonly players = new Map<number, PlayerView>();
  private readonly bullets = new Map<number, Sprite>();
  private readonly itemSprites = new Map<number, Container>();
  private readonly grenadeSprites = new Map<number, Sprite>();
  /** Sprite de cada caja de botín, por id (= su orden en el mapa). */
  private readonly crateSprites = new Map<number, Sprite>();
  /** Sprite de cada barril, por índice de obstáculo: los que estallan se cambian. */
  private readonly barrelSprites = new Map<number, Sprite>();
  private readonly effects: Effect[] = [];

  /** Última bocanada de estela de cohete (performance.now()), para no llenar de humo. */
  private lastPuff = 0;
  /** Sacudón pendiente, en píxeles. Se apaga solo. */
  private shake = 0;
  /** Marca de acierto sobre la mira: segundos que le quedan. */
  private hitMarker = 0;
  /** Flechas de "te pegaron desde acá", en radianes. */
  private readonly damageArcs: { dir: number; life: number }[] = [];
  private readonly markerLayer = new Graphics();
  /** Marcas de la pareja, en pantalla: un rombo encima del lugar o una flecha en el borde. */
  private readonly markLayer = new Graphics();
  private readonly arcLayer = new Graphics();
  /**
   * Flecha hacia la zona cuando estás afuera. Va en el mundo, pegada al
   * jugador, y no en la pantalla: así sigue al muñeco exacto aunque la cámara
   * se corra hacia el cursor.
   */
  private readonly zoneArrow = new Graphics()
    .poly([46, 0, 32, -10, 32, 10])
    .fill(0x6fd3ff)
    .stroke({ width: 2, color: 0x0b0e12 });

  private scale = 1;
  private camX = WORLD_CENTER_X;
  private zoom = 1;
  private camY = WORLD_CENTER_Y;

  constructor(
    private readonly app: Application,
    private readonly arena: ArenaMap,
  ) {
    this.tex = getTextures();

    this.entityLayer.sortableChildren = true;
    // La capa de sombras se dibuja opaca en una textura aparte y recién ahí se
    // vuelve transparente: así las sombras que se superponen no se suman.
    this.shadowLayer.filters = [new AlphaFilter({ alpha: 0.62 })];

    this.camera.addChild(
      this.groundLayer,
      this.zoneLayer,
      this.strikeLayer,
      this.itemLayer,
      this.airdropGround,
      this.shadowLayer,
      this.entityLayer,
      this.bulletLayer,
      this.effectLayer,
      this.smokeLayer,
      this.skyLayer,
      this.zoneArrow,
    );
    this.zoneArrow.visible = false;
    this.app.stage.addChild(this.camera, this.screenLayer);
    this.screenLayer.addChild(this.markLayer, this.arcLayer, this.crosshair, this.markerLayer);

    this.buildGround();
    this.buildWallRing();
    this.buildObstacles();
    this.buildDecor();
    this.drawCrosshair();
  }

  // ------------------------------------------------------------ escenario

  private buildGround(): void {
    const size = WORLD_RADIUS * 2;

    // Terreno de afuera del muro: que salirse de la arena no parezca un bug.
    const outside = new TilingSprite({
      texture: this.tex.void,
      width: size * 3,
      height: size * 3,
    });
    outside.position.set(WORLD_CENTER_X - size * 1.5, WORLD_CENTER_Y - size * 1.5);
    outside.tileScale.set(ART_SCALE);
    this.groundLayer.addChild(outside);

    // Todo el terreno cuelga de un contenedor con UNA máscara circular. Si cada
    // capa llevara la suya habría que repetir la misma Graphics cuatro veces.
    const terrain = new Container();
    const mask = new Graphics().circle(WORLD_CENTER_X, WORLD_CENTER_Y, WORLD_RADIUS).fill(0xffffff);
    terrain.mask = mask;
    this.terrain = terrain;

    const grass = new TilingSprite({
      texture: this.tex.grass,
      width: size,
      height: size,
    });
    grass.position.set(WORLD_CENTER_X - WORLD_RADIUS, WORLD_CENTER_Y - WORLD_RADIUS);
    grass.tileScale.set(ART_SCALE);
    terrain.addChild(grass);

    // Claros de tierra: rompen la monotonía del verde y marcan el centro.
    const dirt = new Graphics();
    const rnd = makeRng(777);
    const blob = (cx: number, cy: number, r: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * r;
        dirt.ellipse(
          cx + Math.cos(a) * d,
          cy + Math.sin(a) * d,
          r * (0.35 + rnd() * 0.5),
          r * (0.3 + rnd() * 0.45),
        );
      }
    };
    blob(WORLD_CENTER_X, WORLD_CENTER_Y, 240, 14);
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 250 + rnd() * 550;
      blob(
        WORLD_CENTER_X + Math.cos(a) * d,
        WORLD_CENTER_Y + Math.sin(a) * d,
        70 + rnd() * 90,
        8,
      );
    }
    dirt.fill({ color: 0x9c8354, alpha: 0.85 });
    terrain.addChild(dirt);

    terrain.addChild(
      this.buildDistrictGrounds(),
      this.buildPonds(),
      this.buildPaths(),
      this.buildBuildingFloors(),
    );
    this.groundLayer.addChild(mask, terrain);
  }

  /**
   * El suelo propio de cada distrito. Es lo que más hace por que el mapa se lea:
   * el asfalto ya te dice desde lejos que ahí está la ciudad, sin ningún cartel.
   *
   * Va como color plano más detalle sembrado, y no como textura en mosaico, por
   * dos razones. El contenedor del terreno ya lleva la máscara circular de la
   * arena, y anidar una segunda adentro no dibuja nada. Y así el detalle puede
   * seguir la forma del terreno en vez de repetirse cada 32 px.
   */
  private buildDistrictGrounds(): Graphics {
    const g = new Graphics();

    for (const d of this.arena.districts) {
      if (d.ground < 0) continue; // el parque se queda con el pasto
      const style = GROUND_STYLES[d.ground] ?? GROUND_STYLES[0]!;

      for (const blob of d.blobs) g.ellipse(blob.x, blob.y, blob.rx, blob.ry);
      g.fill({ color: style.base });

      // El detalle se siembra por rechazo: se tiran puntos en el cuadro del
      // distrito y sólo se dibujan los que caen adentro de alguna mancha, así
      // no hace falta recortar nada ni volver a usar una máscara.
      const rnd = makeRng(0xd1 + d.ground * 977 + Math.round(d.x));
      const inside = (x: number, y: number): boolean =>
        d.blobs.some((b) => {
          const dx = (x - b.x) / b.rx;
          const dy = (y - b.y) / b.ry;
          return dx * dx + dy * dy <= 1;
        });

      for (let i = 0; i < style.marks; i++) {
        const x = d.x + (rnd() * 2 - 1) * d.radius;
        const y = d.y + (rnd() * 2 - 1) * d.radius;
        if (!inside(x, y)) continue;
        g.rect(Math.round(x), Math.round(y), style.markW, style.markH).fill({
          color: rnd() < 0.5 ? style.dark : style.light,
        });
      }
    }

    return g;
  }

  private buildPonds(): Graphics {
    const g = new Graphics();
    for (const p of this.arena.ponds) {
      // Orilla más oscura y agua adentro. Se camina por encima: es paisaje.
      g.ellipse(p.x, p.y, p.rx, p.ry).fill({ color: 0x25566f });
      g.ellipse(p.x, p.y, p.rx - 9, p.ry - 9).fill({ color: 0x2f6f9e });
      g.ellipse(p.x - p.rx * 0.25, p.y - p.ry * 0.3, p.rx * 0.3, p.ry * 0.18)
        .fill({ color: 0x4d93bd, alpha: 0.8 });
    }
    return g;
  }

  /**
   * Los caminos no colisionan con nada: existen para que el mapa se lea y para
   * que moverse entre casas tenga una ruta obvia en vez de campo abierto.
   */
  private buildPaths(): Graphics {
    const g = new Graphics();

    // Dos pasadas: un borde ancho y oscuro, y encima el centro más claro.
    const passes = [
      { grow: 12, color: 0x7a6642, alpha: 0.85 },
      { grow: 0, color: 0xa38c5d, alpha: 1 },
    ];

    for (const pass of passes) {
      for (const path of this.arena.paths) {
        const first = path.points[0];
        if (!first) continue;
        g.moveTo(first.x, first.y);
        for (let i = 1; i < path.points.length; i++) {
          const point = path.points[i]!;
          g.lineTo(point.x, point.y);
        }
        g.stroke({
          width: path.width + pass.grow,
          color: pass.color,
          alpha: pass.alpha,
          cap: "round",
          join: "round",
        });
      }
    }

    return g;
  }

  private buildBuildingFloors(): Container {
    const layer = new Container();
    for (const b of this.arena.buildings) {
      const texture = this.tex.floor[b.floor] ?? this.tex.floor[0]!;
      const floor = new TilingSprite({ texture, width: b.w, height: b.h });
      floor.position.set(b.x, b.y);
      floor.tileScale.set(ART_SCALE);
      layer.addChild(floor);
    }
    return layer;
  }

  private buildWallRing(): void {
    const ring = new Container();
    const blockSize = 16 * ART_SCALE;
    const radius = WORLD_RADIUS + blockSize * 0.35;
    const count = Math.ceil((Math.PI * 2 * radius) / (blockSize * 0.9));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const block = new Sprite(this.tex.wallRing);
      block.anchor.set(0.5);
      block.scale.set(ART_SCALE);
      block.position.set(
        WORLD_CENTER_X + Math.cos(a) * radius,
        WORLD_CENTER_Y + Math.sin(a) * radius,
      );
      block.rotation = a + Math.PI / 2;
      ring.addChild(block);
    }
    this.groundLayer.addChild(ring);
  }

  private buildObstacles(): void {
    // El id de la caja es su orden de aparición en la lista de obstáculos, igual
    // que en el servidor: por eso alcanza con transmitir un número al abrirla.
    let crateId = 0;

    for (const [index, o] of this.arena.obstacles.entries()) {
      if (o.kind === "buildingWall") {
        this.entityLayer.addChild(this.makeWall(o));
        continue;
      }

      if (o.kind === "lootCrate") {
        const sprite = new Sprite(this.tex.lootCrate[0]!);
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(ART_SCALE);
        sprite.position.set(o.x + o.w / 2, o.y + o.h);
        sprite.zIndex = o.y + o.h;
        this.entityLayer.addChild(sprite);
        this.crateSprites.set(crateId++, sprite);
        continue;
      }

      const texture = this.obstacleTexture(o.kind, o.variant);
      const sprite = new Sprite(texture);
      // Anclado al pie del collider: así el orden por Y coincide con la profundidad.
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(ART_SCALE);
      sprite.position.set(o.x + o.w / 2, o.y + o.h);
      sprite.zIndex = o.y + o.h;
      this.entityLayer.addChild(sprite);
      if (o.kind === "barrel") this.barrelSprites.set(index, sprite);
    }
  }

  /**
   * Pared de casa. Las paredes son tiras de largo variable, así que la textura
   * se repite en vez de estirarse: un sprite escalado deformaría el pixel art.
   * El zIndex es el borde de abajo, así la pared del fondo queda detrás tuyo y
   * la de adelante te tapa, que es lo que espera el ojo en vista cenital.
   */
  private makeWall(o: Obstacle): Container {
    const node = new Container();
    const texture = this.tex.wallTile[o.variant % this.tex.wallTile.length]!;

    const face = new TilingSprite({ texture, width: o.w, height: o.h });
    face.tileScale.set(ART_SCALE);

    const shade = new Graphics()
      .rect(0, o.h - 6, o.w, 6)
      .fill({ color: 0x000000, alpha: 0.34 });
    const rim = new Graphics().rect(0, 0, o.w, 2).fill({ color: 0xffffff, alpha: 0.14 });

    node.addChild(face, shade, rim);
    node.position.set(o.x, o.y);
    node.zIndex = o.y + o.h;
    return node;
  }

  /** Cambia la tapa de una caja al sprite abierto. Idempotente. */
  setCrateOpen(crateId: number): void {
    const sprite = this.crateSprites.get(crateId);
    if (sprite) sprite.texture = this.tex.lootCrate[1]!;
  }

  /** Vuelve a cerrar todas: se llama al empezar una ronda nueva. */
  resetCrates(): void {
    for (const sprite of this.crateSprites.values()) {
      sprite.texture = this.tex.lootCrate[0]!;
    }
    // Lo mismo con los barriles: la ronda nueva arranca con todos enteros.
    for (const sprite of this.barrelSprites.values()) sprite.texture = this.tex.barrel;
  }

  /** Un barril estalló: queda quemado. Idempotente. */
  setBarrelExploded(index: number): void {
    const sprite = this.barrelSprites.get(index);
    if (sprite) sprite.texture = this.tex.burntBarrel;
  }

  private obstacleTexture(kind: string, variant: number): Texture {
    switch (kind) {
      case "crate":
        return this.tex.crate[variant % this.tex.crate.length]!;
      case "wall":
        return this.tex.wall;
      case "container":
        return this.tex.container;
      case "tree":
        return this.tex.tree[variant % this.tex.tree.length]!;
      case "rock":
        return this.tex.rock;
      case "silo":
        return this.tex.silo;
      case "hayBale":
        return this.tex.hayBale;
      case "fence":
        return this.tex.fence;
      case "pump":
        return this.tex.pump;
      default:
        return this.tex.barrel;
    }
  }

  private buildDecor(): void {
    const flat = new Container();
    for (const d of this.arena.decor) {
      let texture: Texture;
      switch (d.kind) {
        case "bush":
          texture = this.tex.bush[d.variant % this.tex.bush.length]!;
          break;
        case "grass":
          texture = this.tex.grassTuft;
          break;
        case "flower":
          texture = this.tex.flower[d.variant % this.tex.flower.length]!;
          break;
        default:
          texture = this.tex.pebble;
      }
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(ART_SCALE * d.scale);
      sprite.position.set(d.x, d.y);

      if (d.kind === "bush") {
        // Los arbustos son altos: entran en el orden por Y como un obstáculo más.
        sprite.zIndex = d.y;
        this.entityLayer.addChild(sprite);
      } else {
        flat.addChild(sprite);
      }
    }
    this.terrain.addChild(flat);
  }

  private drawCrosshair(): void {
    const g = this.crosshair;
    g.clear();
    const arm = 9;
    const gap = 4;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      g.moveTo(dx * gap, dy * gap).lineTo(dx * (gap + arm), dy * (gap + arm));
    }
    g.stroke({ width: 3, color: 0x000000, alpha: 0.55 });
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      g.moveTo(dx * gap, dy * gap).lineTo(dx * (gap + arm), dy * (gap + arm));
    }
    g.stroke({ width: 1.5, color: 0xffffff, alpha: 0.95 });
  }

  // ------------------------------------------------------------ feedback

  /**
   * Sacude la cámara. Es la señal más barata de que algo pasó: sin esto,
   * recibir un tiro no se siente distinto de no recibirlo.
   */
  addShake(amount: number): void {
    this.shake = Math.min(22, this.shake + amount);
  }

  /** Marca sobre la mira cuando le pegaste a alguien. */
  showHitMarker(): void {
    this.hitMarker = 0.18;
  }

  /**
   * Flecha que apunta al origen del daño. Con línea de vista es lo más útil de
   * todo el feedback: te disparan desde algo que no ves y al menos sabés para
   * dónde mirar.
   */
  addDamageArc(dir: number): void {
    this.damageArcs.push({ dir, life: 1.1 });
    if (this.damageArcs.length > 6) this.damageArcs.shift();
  }

  /**
   * Flecha alrededor de (x, y) apuntando en `dir`, del color del borde de la
   * zona: "volvé para el azul". null la esconde.
   */
  setZoneArrow(arrow: { x: number; y: number; dir: number } | null, timeMs = 0): void {
    this.zoneArrow.visible = arrow !== null;
    if (!arrow) return;
    this.zoneArrow.position.set(arrow.x, arrow.y);
    this.zoneArrow.rotation = arrow.dir;
    this.zoneArrow.alpha = 0.65 + 0.35 * Math.sin(timeMs / 110);
  }

  /** Número de daño que sube y se desvanece sobre el que lo recibió. */
  spawnDamageNumber(x: number, y: number, amount: number): void {
    const text = new Text({
      text: String(Math.max(1, Math.round(amount))),
      style: {
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: 15,
        fontWeight: "700",
        fill: amount >= 40 ? 0xffd257 : 0xffffff,
        stroke: { color: 0x000000, width: 4, join: "round" },
      },
    });
    text.anchor.set(0.5, 1);
    text.resolution = 2;
    // Un poco de desvío al azar: dos impactos seguidos no se tapan entre sí.
    text.position.set(x + (Math.random() - 0.5) * 16, y - 18);
    this.effectLayer.addChild(text);
    this.effects.push({ node: text, life: 0.85, maxLife: 0.85, vx: 0, vy: -46, kind: "number" });
  }

  private drawFeedback(dt: number): void {
    // Marca de acierto: una X corta que se abre sobre la mira.
    this.markerLayer.clear();
    if (this.hitMarker > 0) {
      this.hitMarker -= dt;
      const t = Math.max(0, this.hitMarker / 0.18);
      const size = 7 + (1 - t) * 5;
      for (const [dx, dy] of [
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
      ] as const) {
        this.markerLayer.moveTo(dx * size, dy * size).lineTo(dx * (size + 6), dy * (size + 6));
      }
      this.markerLayer.stroke({ width: 2.5, color: 0xffffff, alpha: 0.2 + t * 0.8 });
      this.markerLayer.position.copyFrom(this.crosshair.position);
    }

    // Flechas de dirección del daño, en un anillo alrededor del centro.
    this.arcLayer.clear();
    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;
    for (let i = this.damageArcs.length - 1; i >= 0; i--) {
      const arc = this.damageArcs[i]!;
      arc.life -= dt;
      if (arc.life <= 0) {
        this.damageArcs.splice(i, 1);
        continue;
      }
      this.arcLayer.arc(cx, cy, 120, arc.dir - 0.34, arc.dir + 0.34);
      this.arcLayer.stroke({
        width: 7,
        color: 0xff4a4a,
        alpha: Math.min(1, arc.life) * 0.85,
        cap: "round",
      });
    }
  }

  // -------------------------------------------------------------- sombras

  /**
   * Sombras proyectadas desde el jugador por todo lo que tapa la vista.
   *
   * No cambian nada del juego —quién ve a quién lo decide el servidor— pero sin
   * esto la gente desaparecería detrás de una pared sin ninguna explicación
   * visual, y eso se lee como un bug y no como una mecánica.
   *
   * Se extruye cada arista trasera de la caja en dirección contraria a la luz.
   * Todo se rellena de una sola vez para que los solapamientos no se oscurezcan
   * dos veces.
   */
  updateShadows(viewX: number | null, viewY: number): void {
    const g = this.shadowLayer;
    g.clear();
    if (viewX === null) return; // espectador: ve todo

    this.arena.grid.query(viewX, viewY, SHADOW_RANGE, shadowScratch);

    for (let i = 0; i < shadowScratch.length; i++) {
      const o = this.arena.obstacles[shadowScratch[i]!];
      if (!o || !BLOCKS_SIGHT.has(o.kind)) continue;

      const corners = [
        { x: o.x, y: o.y },
        { x: o.x + o.w, y: o.y },
        { x: o.x + o.w, y: o.y + o.h },
        { x: o.x, y: o.y + o.h },
      ];

      for (let e = 0; e < 4; e++) {
        const a = corners[e]!;
        const b = corners[(e + 1) % 4]!;

        // Normal saliente de la arista. Si apunta en contra de la luz, la
        // arista está de espaldas y es la que proyecta sombra.
        const nx = b.y - a.y;
        const ny = -(b.x - a.x);
        if (nx * (a.x - viewX) + ny * (a.y - viewY) <= 0) continue;

        const pa = project(a.x, a.y, viewX, viewY);
        const pb = project(b.x, b.y, viewX, viewY);
        g.poly([a.x, a.y, b.x, b.y, pb.x, pb.y, pa.x, pa.y]);
      }
    }

    // Opaca acá y transparente toda la capa junta (ver el AlphaFilter en el
    // constructor). Con la transparencia en el relleno, cada pared pintaba su
    // sombra encima de la de al lado y donde se cruzaban quedaba el doble de
    // oscuro: la "doble sombra" entre las paredes de una misma casa.
    g.fill({ color: 0x08121c, alpha: 1 });
  }

  // -------------------------------------------------------------- jugador

  private ensurePlayer(id: number, meta: PlayerMeta | undefined): PlayerView {
    const existing = this.players.get(id);
    if (existing) return existing;

    const root = new Container();

    const shadow = new Sprite(this.tex.shadow);
    shadow.anchor.set(0.5, 0.5);
    shadow.scale.set(ART_SCALE * 0.9);
    shadow.position.set(0, PLAYER_RADIUS * 0.7);

    const gun = new Sprite(this.tex.gun);
    // Pivote en la empuñadura, cerca del cuerpo: el arma gira alrededor del jugador.
    gun.anchor.set(0.15, 0.5);
    gun.scale.set(ART_SCALE);

    const flash = new Sprite(this.tex.muzzleFlash);
    flash.anchor.set(0, 0.5);
    flash.scale.set(ART_SCALE);
    flash.visible = false;

    const body = new Sprite(this.tex.playerBody);
    body.anchor.set(0.5, 0.72);
    body.scale.set(ART_SCALE);

    const shirt = new Sprite(this.tex.playerShirt);
    shirt.anchor.set(0.5, 0.72);
    shirt.scale.set(ART_SCALE);
    shirt.tint = playerColor(meta?.colorIndex ?? 0);

    const label = new Text({
      text: meta?.name ?? "",
      style: {
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: 13,
        fontWeight: "600",
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 4, join: "round" },
      },
    });
    label.anchor.set(0.5, 1);
    label.position.set(0, -PLAYER_RADIUS - 16);
    label.resolution = 2;

    const hpBar = new Graphics();
    hpBar.position.set(0, -PLAYER_RADIUS - 12);

    root.addChild(shadow, gun, flash, body, shirt, hpBar, label);
    this.entityLayer.addChild(root);

    const view: PlayerView = { root, body, shirt, gun, flash, label, hpBar, lastAmmo: -1 };
    this.players.set(id, view);
    return view;
  }

  // -------------------------------------------------------------- update

  /**
   * Dibuja un cuadro. `localOverride` es la posición predicha del jugador local:
   * pisa lo que dice el snapshot para que tu propio movimiento no tenga latencia.
   */
  update(
    frame: InterpolatedFrame,
    roster: Map<number, PlayerMeta>,
    localId: number,
    localOverride: { x: number; y: number; aim: number; hidden: boolean } | null,
    dt: number,
    /** Compañeros en dúos: su nombre va en verde. */
    mates: ReadonlySet<number> = new Set(),
    /** El más buscado: su nombre va en dorado con una estrella. */
    wantedId = -1,
  ): void {
    const seen = new Set<number>();

    for (const p of frame.players) {
      if (!p.alive) continue;
      seen.add(p.id);

      const meta = roster.get(p.id);
      const view = this.ensurePlayer(p.id, meta);

      const isLocal = p.id === localId;
      const x = isLocal && localOverride ? localOverride.x : p.x;
      const y = isLocal && localOverride ? localOverride.y : p.y;
      const aim = isLocal && localOverride ? localOverride.aim : p.aim;

      view.root.position.set(x, y);
      view.root.zIndex = y;
      view.root.visible = true;
      // Escondido en un arbusto: tu muñeco se ve medio transparente, para que
      // sepas que los demás no te ven.
      view.root.alpha = isLocal && localOverride?.hidden ? 0.5 : 1;
      view.gun.rotation = aim;
      // El arma se tiñe con su rareza: de un vistazo sabés con qué te disparan.
      const tier = p.slotTiers[p.activeSlot] ?? 0;
      view.gun.tint = tier > 0 ? rarityAt(tier).color : 0xffffff;
      // El arma se dibuja detrás del cuerpo cuando apunta hacia arriba.
      view.gun.position.set(Math.cos(aim) * 6, Math.sin(aim) * 6 + 2);
      view.flash.rotation = aim;
      view.flash.position.set(Math.cos(aim) * 24, Math.sin(aim) * 24 + 2);

      if (meta && !p.downed) {
        const name = p.id === wantedId ? `★ ${meta.name}` : meta.name;
        if (view.label.text !== name) view.label.text = name;
        view.shirt.tint = playerColor(meta.colorIndex);
      }
      view.label.visible = !isLocal || p.downed;
      // El compañero se distingue de lejos: nombre en verde; el más buscado, en dorado.
      view.label.style.fill = mates.has(p.id) ? 0x7dff9a : p.id === wantedId ? 0xffc94a : 0xffffff;

      // Caído: acostado, sin arma y con el nombre avisándolo. Es lo que le dice
      // al compañero "vení a levantarme" y al rival "rematalo".
      const lying = p.downed ? Math.PI / 2 : 0;
      view.body.rotation = lying;
      view.shirt.rotation = lying;
      view.gun.visible = !p.downed;
      if (p.downed) {
        const name = isLocal ? "Caíste" : `${meta?.name ?? ""} (caído)`;
        if (view.label.text !== name) view.label.text = name;
      }

      // Barra de vida sobre los demás; la propia ya está en el HUD.
      view.hpBar.clear();
      if ((!isLocal || p.downed) && p.hp > 0) {
        const w = 30;
        view.hpBar
          .rect(-w / 2 - 1, -4, w + 2, 6)
          .fill({ color: 0x000000, alpha: 0.55 })
          .rect(-w / 2, -3, (w * p.hp) / 100, 4)
          // Caído, la barra es lo que le queda antes de desangrarse: roja siempre.
          .fill(p.downed ? 0xff3b3b : p.hp > 50 ? 0x5cd97a : p.hp > 25 ? 0xffc94a : 0xff5c5c);
      }
    }

    for (const [id, view] of this.players) {
      if (!seen.has(id)) view.root.visible = false;
    }

    this.updateBullets(frame);
    this.updateGrenades(frame);
    this.updateSmokes(frame, localOverride);
    this.updateAirdrops(frame);
    this.updateStrikes(frame);
    this.updateZone(frame);
    this.updateEffects(dt);
    // El sacudón se apaga rápido: si dura, marea en vez de comunicar.
    this.shake *= Math.exp(-dt / 0.09);
    if (this.shake < 0.2) this.shake = 0;
    this.drawFeedback(dt);
    this.entityLayer.sortChildren();
  }

  /** Sincroniza los sprites del loot con la lista que tiene el juego. */
  updateItems(items: Iterable<GroundItem>, timeMs: number): void {
    const seen = new Set<number>();

    for (const item of items) {
      seen.add(item.id);
      let node = this.itemSprites.get(item.id);
      if (!node) {
        node = new Container();

        const icon = new Sprite(this.itemTexture(item));
        icon.anchor.set(0.5);
        icon.scale.set(ART_SCALE * 0.85);

        // El marco se tiñe con el color de la rareza: de lejos, lo único que
        // querés saber es si vale la pena acercarse.
        const border = new Sprite(this.tex.itemBorder);
        border.anchor.set(0.5);
        border.scale.set(ART_SCALE * 0.85);
        border.tint = itemColor(item);

        node.addChild(icon, border);
        this.itemLayer.addChild(node);
        this.itemSprites.set(item.id, node);
      }
      // Flotan apenas: el movimiento es lo que hace que el ojo los encuentre.
      node.position.set(item.x, item.y + Math.sin(timeMs / 420 + item.id) * 2);
    }

    for (const [id, node] of this.itemSprites) {
      if (seen.has(id)) continue;
      node.destroy({ children: true });
      this.itemSprites.delete(id);
    }
  }

  private itemTexture(item: GroundItem): Texture {
    if (item.kind === ITEM_WEAPON) {
      return this.tex.itemWeapon[item.ref] ?? this.tex.itemWeapon[0]!;
    }
    if (item.kind === ITEM_ARMOR) {
      return this.tex.itemArmor[item.ref] ?? this.tex.itemArmor[0]!;
    }
    if (item.kind === ITEM_GRENADE) return item.ref === GRENADE_SMOKE ? this.tex.itemSmoke : this.tex.itemGrenade;
    return item.ref === 0
      ? this.tex.itemBandage
      : item.ref === 1
        ? this.tex.itemMedkit
        : this.tex.itemAdrenaline;
  }

  private updateGrenades(frame: InterpolatedFrame): void {
    const seen = new Set<number>();
    for (const g of frame.grenades) {
      seen.add(g.id);
      let sprite = this.grenadeSprites.get(g.id);
      if (!sprite) {
        sprite = new Sprite(g.kind === GRENADE_SMOKE ? this.tex.smokeGrenade : this.tex.grenade);
        sprite.anchor.set(0.5, 0.8);
        sprite.scale.set(ART_SCALE);
        this.bulletLayer.addChild(sprite);
        this.grenadeSprites.set(g.id, sprite);
      }
      sprite.position.set(g.x, g.y);
      // Parpadea cada vez más rápido a medida que se acaba la mecha.
      const blink = g.fuse < 20 ? Math.floor(g.fuse / Math.max(1, Math.floor(g.fuse / 3) + 1)) % 2 : 0;
      sprite.tint = blink === 1 ? 0xff6a4a : 0xffffff;
    }
    for (const [id, sprite] of this.grenadeSprites) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.grenadeSprites.delete(id);
    }
  }

  /**
   * Las nubes de humo: bocanadas superpuestas que se mueven apenas, crecen al
   * formarse y se achican al irse, al mismo ritmo que lo que tapan
   * (`smokeRadius`). Si estás adentro, la tuya se aclara para que te veas.
   */
  private updateSmokes(frame: InterpolatedFrame, local: { x: number; y: number } | null): void {
    const seen = new Set<number>();
    const t = performance.now() / 1000;
    for (const s of frame.smokes) {
      seen.add(s.id);
      let cloud = this.smokeClouds.get(s.id);
      if (!cloud) {
        cloud = new Container();
        // Un centro y dos anillos. El giro de cada anillo sale del id: dos
        // nubes no quedan iguales.
        const rings = [
          { count: 1, at: 0 },
          { count: 6, at: 0.45 },
          { count: 9, at: 0.8 },
        ];
        for (const ring of rings) {
          for (let i = 0; i < ring.count; i++) {
            const angle = (i / ring.count) * Math.PI * 2 + s.id * 1.7 + ring.at * 3;
            const puff = new Sprite(this.tex.smokePuff);
            puff.anchor.set(0.5);
            puff.position.set(Math.cos(angle) * ring.at * SMOKE_RADIUS, Math.sin(angle) * ring.at * SMOKE_RADIUS);
            // Diámetro de cada bocanada: algo más de la mitad del radio.
            puff.scale.set((SMOKE_RADIUS * (ring.at === 0.8 ? 0.62 : 0.75)) / 32);
            cloud.addChild(puff);
          }
        }
        this.smokeLayer.addChild(cloud);
        this.smokeClouds.set(s.id, cloud);
      }
      const r = smokeRadius(s) / SMOKE_RADIUS;
      cloud.position.set(s.x, s.y);
      cloud.scale.set(Math.max(0.05, r));
      cloud.children.forEach((puff, i) => {
        // Un vaivén lento por bocanada: quieto se ve pintado.
        puff.rotation = Math.sin(t * 0.4 + i) * 0.15;
        puff.pivot.set(Math.sin(t * 0.7 + i * 2.1) * 2, Math.cos(t * 0.5 + i * 1.3) * 2);
      });
      const inside = local !== null && Math.hypot(local.x - s.x, local.y - s.y) < smokeRadius(s);
      cloud.alpha = (inside ? 0.6 : 0.95) * Math.min(1, r * 1.5);
    }
    for (const [id, cloud] of this.smokeClouds) {
      if (seen.has(id)) continue;
      cloud.destroy({ children: true });
      this.smokeClouds.delete(id);
    }
  }

  /**
   * Los paquetes aéreos bajando. Arriba, el cajón con paracaídas que se mece;
   * en el piso, un anillo que late donde va a caer y una sombra que crece a
   * medida que se acerca.
   */
  /**
   * Los bombardeos: un círculo rojo que late mientras avisa, más rápido cuanto
   * menos falta, y se pone fuerte cuando caen las bombas.
   */
  private updateStrikes(frame: InterpolatedFrame): void {
    const g = this.strikeLayer;
    g.clear();
    const now = performance.now();
    for (const s of frame.strikes) {
      const bombing = s.untilStart <= 0;
      const speed = bombing ? 90 : 120 + s.untilStart * 3;
      const pulse = 0.5 + 0.5 * Math.sin(now / speed);
      g.circle(s.x, s.y, STRIKE_RADIUS).fill({ color: 0xff2a1a, alpha: (bombing ? 0.28 : 0.16) + 0.1 * pulse });
      g.circle(s.x, s.y, STRIKE_RADIUS).stroke({ width: 6, color: 0xff3b2a, alpha: 0.65 + 0.35 * pulse });
      // La cruz del medio: se ve de lejos qué es, aunque no se vea el borde.
      const c = 18;
      g.moveTo(s.x - c, s.y - c).lineTo(s.x + c, s.y + c).moveTo(s.x + c, s.y - c).lineTo(s.x - c, s.y + c);
      g.stroke({ width: 4, color: 0xff3b2a, alpha: 0.7 });
    }
  }

  private updateAirdrops(frame: InterpolatedFrame): void {
    const g = this.airdropGround;
    g.clear();
    const now = performance.now();
    const seen = new Set<number>();

    for (const drop of frame.airdrops) {
      seen.add(drop.id);
      // 1 recién anunciado, 0 tocando el piso.
      const fall = Math.max(0, Math.min(1, drop.ticksLeft / AIRDROP_FALL_TICKS));
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);

      g.circle(drop.x, drop.y, 46).stroke({ width: 3, color: 0xffc94a, alpha: 0.45 + 0.45 * pulse });
      const shadow = 1 - fall * 0.65;
      g.ellipse(drop.x, drop.y + 4, 26 * shadow, 10 * shadow).fill({ color: 0x000000, alpha: 0.4 * shadow });

      let sprite = this.airdropSprites.get(drop.id);
      if (!sprite) {
        sprite = new Sprite(this.tex.airdrop);
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(ART_SCALE);
        this.skyLayer.addChild(sprite);
        this.airdropSprites.set(drop.id, sprite);
      }
      // Se mece más cuanto más alto está; al llegar al piso ya está quieto.
      sprite.position.set(drop.x + Math.sin(now / 700 + drop.id) * 8 * fall, drop.y + 6 - fall * 420);
      sprite.rotation = Math.sin(now / 700 + drop.id) * 0.12 * fall;
    }

    for (const [id, sprite] of this.airdropSprites) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.airdropSprites.delete(id);
    }
  }

  /** El paquete tocó el piso: una nube de tierra que se abre. */
  spawnLanding(x: number, y: number): void {
    const ring = new Graphics();
    ring.circle(0, 0, 30).fill({ color: 0xd8c49a, alpha: 0.7 });
    ring.position.set(x, y);
    this.effectLayer.addChild(ring);
    this.effects.push({ node: ring, life: 0.5, maxLife: 0.5, vx: 0, vy: 0, kind: "blast" });

    for (let i = 0; i < 12; i++) {
      const p = new Graphics().rect(0, 0, 5, 5).fill(0xc9b27f);
      p.position.set(x, y);
      this.effectLayer.addChild(p);
      const a = (i / 12) * Math.PI * 2;
      const speed = 120 + Math.random() * 90;
      this.effects.push({
        node: p,
        life: 0.55,
        maxLife: 0.55,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        kind: "blood",
      });
    }
  }

  /** Fogonazo de la explosión: un anillo que se abre y se apaga. */
  spawnExplosion(x: number, y: number): void {
    const g = new Graphics();
    g.circle(0, 0, 30).fill({ color: 0xffd9a0, alpha: 0.9 });
    g.circle(0, 0, 46).stroke({ width: 8, color: 0xff9a3c, alpha: 0.9 });
    g.position.set(x, y);
    this.effectLayer.addChild(g);
    this.effects.push({ node: g, life: 0.38, maxLife: 0.38, vx: 0, vy: 0, kind: "blast" });

    for (let i = 0; i < 10; i++) {
      const p = new Graphics().rect(0, 0, 4, 4).fill(0xffb457);
      p.position.set(x, y);
      this.effectLayer.addChild(p);
      const a = (i / 10) * Math.PI * 2;
      const speed = 180 + Math.random() * 160;
      this.effects.push({
        node: p,
        life: 0.42,
        maxLife: 0.42,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        kind: "blood",
      });
    }
  }

  private updateBullets(frame: InterpolatedFrame): void {
    const seen = new Set<number>();
    const now = performance.now();
    for (const b of frame.bullets) {
      seen.add(b.id);
      let sprite = this.bullets.get(b.id);
      if (!sprite) {
        sprite = new Sprite(b.rocket ? this.tex.rocket : this.tex.bullet);
        sprite.anchor.set(0.5);
        sprite.scale.set(ART_SCALE);
        this.bulletLayer.addChild(sprite);
        this.bullets.set(b.id, sprite);
      }
      sprite.position.set(b.x, b.y);
      sprite.rotation = b.angle;
      // Estela de humo del cohete: una bocanada cada tanto, atrás de la llama.
      if (b.rocket && now - this.lastPuff > 35) {
        this.lastPuff = now;
        const puff = new Graphics().circle(0, 0, 4).fill(0xc8ccd0);
        puff.position.set(b.x - Math.cos(b.angle) * 14, b.y - Math.sin(b.angle) * 14);
        this.effectLayer.addChild(puff);
        this.effects.push({ node: puff, life: 0.45, maxLife: 0.45, vx: 0, vy: 0, kind: "puff" });
      }
    }
    for (const [id, sprite] of this.bullets) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.bullets.delete(id);
    }
  }

  private updateZone(frame: InterpolatedFrame): void {
    const z = frame.zone;
    const g = this.zoneLayer;
    g.clear();

    // Círculo objetivo de la próxima contracción, en blanco tenue.
    if (z.targetRadius < z.radius - 1) {
      g.circle(z.targetX, z.targetY, z.targetRadius).stroke({
        width: 3,
        color: 0xffffff,
        alpha: 0.35,
      });
    }

    // Pared de la zona: un halo ancho y una línea brillante encima.
    g.circle(z.x, z.y, z.radius).stroke({ width: 26, color: 0x2f8fd8, alpha: 0.18 });
    g.circle(z.x, z.y, z.radius).stroke({ width: 5, color: 0x6fd3ff, alpha: 0.9 });
  }

  // -------------------------------------------------------------- efectos

  spawnMuzzleFlash(x: number, y: number, aim: number): void {
    const sprite = new Sprite(this.tex.muzzleFlash);
    sprite.anchor.set(0, 0.5);
    sprite.scale.set(ART_SCALE);
    sprite.rotation = aim;
    sprite.position.set(x + Math.cos(aim) * 24, y + Math.sin(aim) * 24 + 2);
    this.effectLayer.addChild(sprite);
    this.effects.push({ node: sprite, life: 0.06, maxLife: 0.06, vx: 0, vy: 0, kind: "flash" });
  }

  spawnImpact(x: number, y: number): void {
    const g = new Graphics();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.moveTo(0, 0).lineTo(Math.cos(a) * 7, Math.sin(a) * 7);
    }
    g.stroke({ width: 2, color: 0xffd257, alpha: 0.9 });
    g.position.set(x, y);
    this.effectLayer.addChild(g);
    this.effects.push({ node: g, life: 0.18, maxLife: 0.18, vx: 0, vy: 0, kind: "spark" });
  }

  spawnBlood(x: number, y: number): void {
    for (let i = 0; i < 6; i++) {
      const g = new Graphics().rect(0, 0, 3, 3).fill(0xc02a2a);
      g.position.set(x, y);
      this.effectLayer.addChild(g);
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 70;
      this.effects.push({
        node: g,
        life: 0.35,
        maxLife: 0.35,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        kind: "blood",
      });
    }
  }

  private updateEffects(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i]!;
      fx.life -= dt;
      if (fx.life <= 0) {
        fx.node.destroy();
        this.effects.splice(i, 1);
        continue;
      }
      const t = fx.life / fx.maxLife;
      fx.node.alpha = t;
      if (fx.kind === "blood") {
        fx.node.x += fx.vx * dt;
        fx.node.y += fx.vy * dt;
        fx.vx *= 0.9;
        fx.vy *= 0.9;
      } else if (fx.kind === "spark") {
        fx.node.scale.set(1 + (1 - t) * 1.2);
      } else if (fx.kind === "number") {
        fx.node.y += fx.vy * dt;
        fx.vy *= 0.93;
      } else if (fx.kind === "puff") {
        // El humo de la estela: crece y se apaga.
        fx.node.scale.set(1 + (1 - t) * 1.5);
        fx.node.alpha = t * 0.5;
      } else if (fx.kind === "blast") {
        // Se abre de golpe y se desvanece: la curva es lo que la hace sentir seca.
        fx.node.scale.set(0.4 + (1 - t) * 2.2);
      }
    }
  }

  /**
   * Las marcas de la pareja. Adentro de la pantalla, un rombo que late sobre el
   * lugar; afuera, una flecha pegada al borde que apunta hacia allá, para que
   * "voy para el paquete" sirva aunque el paquete esté lejos.
   */
  drawMarks(marks: readonly { x: number; y: number; color: number; at: number }[]): void {
    const g = this.markLayer;
    g.clear();
    if (marks.length === 0) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const margin = 28;
    const now = performance.now();
    for (const m of marks) {
      const s = this.worldToScreen(m.x, m.y);
      const bob = Math.sin((now - m.at) / 160) * 3;
      if (s.x > margin && s.x < w - margin && s.y > margin && s.y < h - margin) {
        const y = s.y - 26 + bob;
        g.poly([s.x, y - 10, s.x + 8, y, s.x, y + 10, s.x - 8, y])
          .fill({ color: m.color, alpha: 0.9 })
          .stroke({ width: 2, color: 0x000000, alpha: 0.6 });
        g.circle(s.x, s.y, 5).stroke({ width: 2, color: m.color, alpha: 0.8 });
        continue;
      }
      // Afuera: en el borde, en la línea entre el centro de la pantalla y la marca.
      const cx = w / 2;
      const cy = h / 2;
      const dx = s.x - cx;
      const dy = s.y - cy;
      const k = Math.min((w / 2 - margin) / Math.abs(dx || 1e-6), (h / 2 - margin) / Math.abs(dy || 1e-6));
      const ex = cx + dx * k;
      const ey = cy + dy * k;
      const a = Math.atan2(dy, dx);
      const tip = { x: ex + Math.cos(a) * 17, y: ey + Math.sin(a) * 17 };
      const left = { x: ex + Math.cos(a + 2.5) * 14, y: ey + Math.sin(a + 2.5) * 14 };
      const right = { x: ex + Math.cos(a - 2.5) * 14, y: ey + Math.sin(a - 2.5) * 14 };
      g.poly([tip.x, tip.y, left.x, left.y, right.x, right.y])
        .fill({ color: m.color, alpha: 0.9 })
        .stroke({ width: 2, color: 0x000000, alpha: 0.6 });
    }
  }

  // --------------------------------------------------------------- cámara

  /** La cámara mira un punto entre el jugador y el cursor: se ve más adelante. */
  setCamera(x: number, y: number): void {
    this.camX = x;
    this.camY = y;
    this.applyCamera();
  }

  /**
   * Cuánto más mundo se ve que lo normal (1 = lo normal). Lo sube la mira
   * del francotirador; se aplica con la próxima `setCamera`.
   */
  setZoom(zoom: number): void {
    this.zoom = zoom;
  }

  /** Punto del mundo al que mira la cámara. */
  cameraCenter(): { x: number; y: number } {
    return { x: this.camX, y: this.camY };
  }

  resize(): void {
    this.applyCamera();
  }

  private applyCamera(): void {
    // `screen` está en píxeles CSS, igual que clientX/clientY del mouse:
    // usando la misma unidad en los dos lados no hay que pensar en el devicePixelRatio.
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.scale = Math.max(h / VIEW_HEIGHT, 0.35) / this.zoom;

    // Sujetar la cámara dentro de la arena antes de aplicarla.
    let cx = this.camX;
    let cy = this.camY;
    const dx = cx - WORLD_CENTER_X;
    const dy = cy - WORLD_CENTER_Y;
    const d = Math.hypot(dx, dy);
    if (d > CAMERA_MAX_OFFSET) {
      cx = WORLD_CENTER_X + (dx / d) * CAMERA_MAX_OFFSET;
      cy = WORLD_CENTER_Y + (dy / d) * CAMERA_MAX_OFFSET;
    }

    const jitterX = this.shake > 0 ? (Math.random() * 2 - 1) * this.shake : 0;
    const jitterY = this.shake > 0 ? (Math.random() * 2 - 1) * this.shake : 0;

    this.camera.scale.set(this.scale);
    /*
     * Sin redondear a píxeles enteros. Redondear es lo habitual en pixel art
     * para que la grilla quede alineada, pero acá no alinea nada: la escala es
     * el alto de la ventana dividido VIEW_HEIGHT y sale fraccionaria casi
     * siempre (1,25 a 800 px de alto; 1,6875 en 1080p). Con la grilla ya
     * desalineada, el redondeo no daba nitidez y sí cortaba el movimiento:
     * medido a 144 fps, la cámara se desplazaba de a 0, 1 o 2 píxeles enteros y
     * un tercio de los cuadros no se movía nada. Como la cámara te sigue, eso
     * es el mundo entero trabándose, que se nota mucho más que el propio muñeco.
     */
    this.camera.position.set(
      -cx * this.scale + w / 2 + jitterX,
      -cy * this.scale + h / 2 + jitterY,
    );
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.scale + this.camera.x, y: wy * this.scale + this.camera.y };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.camera.x) / this.scale,
      y: (sy - this.camera.y) / this.scale,
    };
  }

  setCrosshair(sx: number, sy: number, visible: boolean): void {
    this.crosshair.visible = visible;
    this.crosshair.position.set(sx, sy);
  }

  /** Posición de la cámara en pantalla, para medir el desplazamiento. Solo dev. */
  debugCamera(): { x: number; y: number; escala: number } {
    return { x: this.camera.position.x, y: this.camera.position.y, escala: this.scale };
  }

  /** Estado del sprite de un jugador, para los scripts de captura. Solo dev. */
  debugPlayer(id: number): unknown {
    const view = this.players.get(id);
    if (!view) return { sprite: "no existe" };
    return {
      visible: view.root.visible,
      alpha: view.root.alpha,
      // Sin redondear: los scripts miden movimiento entre cuadros y un redondeo
      // a enteros haría parecer inmóvil lo que se mueve de a poco.
      mundo: { x: view.root.x, y: view.root.y },
      pantalla: {
        x: Math.round(view.root.getGlobalPosition().x),
        y: Math.round(view.root.getGlobalPosition().y),
      },
    };
  }

  reset(): void {
    this.markLayer.clear();
    this.strikeLayer.clear();
    for (const view of this.players.values()) view.root.visible = false;
    this.zoneArrow.visible = false;
    for (const [id, sprite] of this.bullets) {
      sprite.destroy();
      this.bullets.delete(id);
    }
    for (const [id, node] of this.itemSprites) {
      node.destroy({ children: true });
      this.itemSprites.delete(id);
    }
    for (const [id, sprite] of this.grenadeSprites) {
      sprite.destroy();
      this.grenadeSprites.delete(id);
    }
    for (const [id, cloud] of this.smokeClouds) {
      cloud.destroy({ children: true });
      this.smokeClouds.delete(id);
    }
    for (const fx of this.effects) fx.node.destroy();
    this.effects.length = 0;
    this.shadowLayer.clear();
    this.markerLayer.clear();
    this.arcLayer.clear();
    this.damageArcs.length = 0;
    this.shake = 0;
    this.hitMarker = 0;
    this.zoneLayer.clear();
  }
}
