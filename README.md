# WabBR

Battle royale 2D con vista cenital y estética pixel art, para jugar con amigos desde el navegador.

- **Cliente**: Vite + TypeScript + PixiJS → se despliega en Vercel.
- **Servidor**: Cloudflare Worker + Durable Objects (`partyserver`) → una partida = un Durable Object
  con su propio game loop a 20 Hz.
- **Simulación compartida**: `packages/shared` corre igual en el cliente y en el servidor. Eso es lo
  que permite la predicción del cliente.

> Vercel no puede alojar el servidor de juego: sus funciones son serverless, no mantienen WebSockets
> abiertos ni pueden correr un loop continuo. Por eso el proyecto tiene dos despliegues.

## Empezar

```bash
npm install
npm run dev          # levanta el servidor (:8787) y el cliente (:5173) a la vez
```

Abrí <http://localhost:5173>, creá una sala, copiá el link y abrilo en otra pestaña.
Con dos jugadores listos arranca la partida.

### Controles

| Tecla | Acción |
|---|---|
| `WASD` | moverse |
| Mouse | apuntar |
| Click izquierdo | disparar |
| `R` | recargar |
| `E` | abrir la caja o recoger lo que tengas al lado |
| `1` / `2` | cambiar entre las dos armas |
| `3` / `4` / `5` | vendas, botiquín, adrenalina |
| `Shift` | correr (gasta estamina) |
| `G` | tirar una granada |
| `Tab` | tabla de posiciones |

No ves a través de las paredes: mirá la sección de línea de vista.

### El lobby

El que crea la sala es el host: puede forzar el arranque sin esperar a que todos marquen listo, y
puede **echar a cualquiera** con la ✕ de su fila. Si el host se va, el puesto pasa al siguiente.

Al echado lo devuelve al menú con el motivo, y no puede volver a entrar con el mismo nombre. Es un
bloqueo blando y a propósito: sin cuentas no hay identidad estable, así que cambiando el nombre entra
igual. Cubre lo que molesta —el que reentra de un clic— y no pretende ser más que eso. Sólo funciona
en el lobby: en partida, echar sería un arma más.

## El mapa

Arena circular de 3000 px de diámetro, generada con semilla fija en
`packages/shared/src/map/arena.ts`. No viaja por la red: cliente y servidor
corren la misma función y llegan al mismo resultado.

La unidad de diseño es el **distrito**. Un mapa con casas repartidas parejo se
juega igual en todos lados; con distritos aparece la pregunta de a dónde ir, y
con nombres aparecen las llamadas entre amigos ("voy a la granja").

| Distrito | Qué tiene | Para qué sirve |
|---|---|---|
| **La Ciudad** (centro) | 4 edificios de hormigón, contenedores, asfalto | Mucho botín y todos los caminos pasando por ahí |
| **La Granja** | Granero, silos, campo arado, fardos, cercos | Botín bueno en campo abierto: te ven venir |
| **El Parque** | Árboles densos y charcos, sin edificios | Cruzar el mapa sin que te vean. Botín flojo a propósito |
| **El Depósito** | Contenedores en hileras y un galpón | Pasillos estrechos, pelea de cerca |
| **El Campamento** | Tres casas chicas de madera | Botín repartido, sin un solo punto caliente |
| **Las Ruinas** | Muros sueltos sin techo | Cobertura pura en terreno abierto |
| **Gasolinera / Caserío / Chatarrería** | Puntos menores en los huecos | Rellenan el campo abierto: poco botín, buena referencia |

Además hay **puntos menores** repartidos por los huecos —gasolineras, caseríos y
chatarrerías— con un par de cajas cada uno. No compiten con los distritos: dan
poco botín y existen para que el campo abierto no sea puro pasto y para servir de
referencia y de cobertura de paso. Se colocan por rechazo, o sea en cualquier
lugar que no pise un distrito ni otro punto menor, así el relleno cae justo donde
el mapa se veía vacío sin tener que calcular dónde está el vacío. En el minimapa
van rotulados más chico y apagado: con catorce nombres del mismo tamaño no se
lee nada.

El orden de generación importa y es el que le da forma:

1. **Los distritos y su contenido**: uno central y cinco en anillo, cada uno con
   su propio generador. Cada casa tiene paredes de verdad, dos puertas en lados
   distintos y, las grandes, un tabique interior para pelear adentro.
2. **Caminos** que los unen: radios desde la ciudad más un anillo entre vecinos.
   Sin el anillo, cruzar de un distrito a otro obligaría a pasar siempre por el
   centro, que es justo donde te matan. Salen del borde de la casa más cercana,
   no del centro, para que la ruta no muera contra una pared.
3. **El campo abierto**, que se llena mucho menos que los distritos y esquiva los
   caminos: es lo que hace que los distritos se lean como lugares separados.

Cada distrito pinta su propio suelo (asfalto, tierra arada, gravilla) sobre el
pasto, con manchas irregulares. Es lo que más hace por que el mapa se lea de
lejos, y los nombres en el minimapa hacen el resto.

El mobiliario de adentro deja siempre 52 px libres contra la pared: es más que el
diámetro del jugador más medio ancho de caja, así que queda un pasillo pegado al
perímetro y ningún mueble puede tapar una puerta desde adentro. Sin ese margen,
el test de alcanzabilidad falla — y falló.

Los caminos no colisionan: existen para que el mapa se lea y para que moverse
entre casas tenga una ruta obvia en vez de campo abierto.

Hay un test que hace una inundación desde el punto de aparición y comprueba que
**se pueda entrar a todas las casas**. Encontró un caso real: en las casas chicas
la pared lateral no daba para una puerta de 84 px, así que si las dos puertas
caían en los laterales la casa quedaba sellada — y en pantalla se veía perfecta.

Para agrandar o achicar el mapa alcanza con `WORLD_RADIUS` en `constants.ts`: el
generador, el minimapa y el límite de cámara salen todos de ahí.

## Loot

Hay dos fuentes de botín, y la separación es lo que mantiene el mapa legible:

- **Cajas de botín** (`E` para abrirlas): están casi todas adentro de las casas y
  guardan la mayoría de las armas, los chalecos **y la curación**. Cada una da
  **al menos un arma garantizada** más 1-3 objetos, porque si abrir una pudiera
  salir vacío, desviarse a hacerlo sería una lotería. El contenido se sortea al
  abrirla, no al generar el mapa: así el cliente no puede espiarlo leyendo su
  propio estado.
- **Objetos sueltos** (`E` también): 42 repartidos a la vista, y son sobras.
  Alcanzan para no quedar indefenso si no encontraste una caja, pero no para
  equiparte. Empezaron siendo 190 con todas las armas y todas las curas, y el
  campo se veía sembrado de basura flotante.

Hay un test que compara las dos fuentes: las cajas tienen que dar **más del
doble** de curación que todo lo tirado en el suelo junto, y más armas que el
piso. Se mide en cantidad y no en proporción, porque al sacar curas del suelo la
proporción de armas sube sola sin que haya una sola arma más tirada.

El reparto se genera con la misma técnica que el mapa: `spawnLoot(seed)` corre
igual en el cliente y en el servidor, así que **no se transmite**. Sólo viaja la
lista una vez al arrancar, más los eventos de "lo agarró tal", "se abrió la caja
7" y "se cayó esto". De las cajas ni siquiera viaja la posición: son parte del
mapa, y su id es su orden de aparición.

- **Cinco armas** (`packages/shared/src/items.ts`): pistola, subfusil, rifle,
  escopeta y francotirador. Dos ranuras, así que hay que elegir.
- **Cinco rarezas** (común → legendaria), que multiplican daño, recarga,
  cargador y precisión. No tocan la cadencia ni el alcance a propósito: un rifle
  legendario sigue siendo un rifle, no una escopeta mejor.
- **Curación con canalización**: vendas, botiquín y adrenalina. Te quedás quieto
  unos segundos y si te movés o te pegan se cancela. Eso es lo que la convierte
  en una decisión y no en un botón.
- **Chalecos**: una barra de escudo que se gasta antes que la vida. La zona la
  ignora, para que un chaleco no te deje sobrevivir afuera.
- Al morir soltás todo lo que llevabas: matar a alguien tiene que valer la pena.

Cada arma tiene un **techo de rareza** (`maxTier`). El francotirador tope en
épica: con el multiplicador legendario haría 104 de daño y mataría de un tiro
desde fuera de la pantalla, que no es una pelea sino una lotería. Hay un test
que recorre las cinco armas en su rareza máxima y falla si alguna puede matar de
un disparo a alguien con la vida llena, así que tocar los multiplicadores sin
pensarlo avisa solo.

Todo eso vive en `packages/shared/src/sim/step.ts`, para que cliente y servidor
no puedan discrepar. Las acciones (recoger, cambiar de arma, curarse) viajan en
el campo `act` del mensaje de input que ya se manda 20 veces por segundo: no
agregan ni un mensaje nuevo, que es lo que importa para la factura de Cloudflare.

## Correr y granadas

**Correr** (`Shift`) va 1,45× más rápido y gasta estamina: unos 3 segundos de
sprint continuo y 5 para recuperarla, con una pausa de 1 s antes de empezar a
llenarse — sin esa pausa, dar toquecitos a la tecla te dejaría correr para
siempre. Sólo gasta si te estás moviendo, así que apoyarse en Shift mirando el
mapa no cuesta nada.

El detalle técnico que importa: **la estamina se calcula dentro de
`stepPlayerMovement`**, junto con el movimiento. Como afecta la velocidad, si
sólo la llevara el servidor la predicción del cliente se desviaría en cuanto se
te acabara. Por eso también viaja en el snapshot y la reconciliación la rebobina
igual que la posición.

**Granadas** (`G`): se tiran hacia donde apuntás, ruedan unos 350 px, rebotan
contra las paredes y estallan a los 2 segundos. Le pegan **también a quien las
tiró** — es lo que hace que tirarla a los pies de alguien que te está corriendo
sea una decisión y no un botón gratis. Una pared frena la esquirla: la explosión
usa la misma `hasLineOfSight` que la visión, así que no se puede granadear a
través de una casa.

El daño en área vive en `applyExplosion`, separado de las granadas a propósito:
cualquier cosa que estalle —un barril, un cohete— lo va a usar igual, y así el
balance de las explosiones queda en un solo lugar.

## Feedback de combate

Sin esto no sabés si le estás pegando a alguien, y con línea de vista tampoco
sabés desde dónde te disparan. Son cinco señales, todas en el cliente:

- **Números de daño** flotando sobre el que lo recibe. Sólo los tuyos: con los de
  todos la pantalla se llena de información que no es tuya.
- **Marca de acierto** sobre la mira, una X corta que se abre al pegar.
- **Sacudón de cámara** al recibir daño, escalado por cuánto te pegaron, y un
  retroceso chico al disparar proporcional al arma: el francotirador patea, el
  subfusil apenas cosquillea. Se apaga en 90 ms — si dura más, marea.
- **Flecha de dirección** apuntando al origen del daño. Con las paredes tapando
  la vista es lo más útil de todo: te disparan desde algo que no ves y al menos
  sabés para dónde mirar.
- **Kill feed** estilo shooter, abajo del minimapa: quién, con qué icono de arma
  y a quién, con los nombres en el color de cada jugador. La línea se resalta si
  mataste o te mataron.

Para que todo eso exista, los eventos de la simulación llevan más datos: el de
impacto dice **cuánto** y **desde qué dirección**, y el de muerte dice **con qué**
(índice de arma, o granada, o zona). Hay tests que lo verifican, porque son parte
del contrato entre servidor y cliente.

## Línea de vista

Las paredes tapan la vista, no sólo las balas. La regla es **la cobertura baja
frena balas, las paredes frenan las dos cosas**: una caja te salva de un tiro
pero mirás por encima, y una pared te esconde. Tapan la vista las paredes de
casa, los muros de las ruinas, los contenedores y los silos; no tapan cajas,
barriles, rocas, fardos, cercos ni árboles.

Todo sale de una sola función, `hasLineOfSight` en
`packages/shared/src/sim/sight.ts`, que usan los dos lados: **el servidor** para
no contarte lo que no podés ver, y **el cliente** para dibujar las sombras. Si
cada uno tuviera su versión, tarde o temprano dirían cosas distintas.

Tres consecuencias que vale la pena saber:

- **El wallhack deja de existir.** Antes la posición de todos llegaba a todos los
  clientes y alcanzaba con abrir la consola del navegador. Ahora la información
  no sale del servidor.
- **Los snapshots se achicaron**, de ~820 a ~557 bytes con 12 jugadores: cada uno
  recibe sólo lo que ve.
- **El marcador va aparte** (campo `st` del snapshot). Desde que se ocultan
  jugadores, la lista de posiciones ya no sirve para la tabla: alguien detrás de
  una pared aparecería como muerto y con cero kills.

Hay un margen de gracia de 6 ticks: se te sigue mandando a alguien 300 ms después
de perderlo de vista, porque si no caminar al lado de una columna lo hace
parpadear. Y los muertos ven todo, para que mirar la partida siga teniendo
sentido.

Las sombras del cliente no cambian nada del juego —quién ve a quién lo decide el
servidor— pero sin ellas la gente desaparecería sin explicación visual, y eso se
lee como un bug y no como una mecánica.

## Estructura

```
packages/shared/     simulación, mapa y protocolo (TS puro, sin dependencias)
  src/sim/step.ts      el tick autoritativo: corre igual en cliente y servidor
  src/protocol/        mensajes y codec
  src/map/arena.ts     mapa procedural con semilla fija (no se transmite: se regenera igual en ambos lados)
apps/server/         Worker + Durable Object
  src/GameRoom.ts      loop de 20 Hz, lobby, snapshots, validación de input
apps/client/         juego
  src/net/             conexión, predicción/reconciliación, interpolación
  src/render/          PixiJS: mundo, texturas generadas por código, minimapa
```

## Cómo se siente fluido

Un shooter en el que el cliente sólo dibuja lo que manda el servidor se siente pesado: cada
movimiento llega con el retraso del ping. Acá hay tres piezas:

1. **Predicción** (`net/prediction.ts`): tu input se aplica localmente al instante, con la misma
   función `stepPlayerMovement` que corre el servidor.
2. **Reconciliación**: cada snapshot trae el último `seq` que el servidor procesó. El cliente vuelve
   a la posición autoritativa y re-aplica los inputs pendientes. Si coincidían, no se ve nada; si no,
   la diferencia se absorbe en ~60 ms en vez de saltar.
3. **Interpolación** (`net/interpolation.ts`): los demás jugadores se dibujan 100 ms en el pasado,
   interpolando entre snapshots, así se mueven suave aunque lleguen a 20 Hz.
4. **Interpolación del propio** (`renderPosition`): la simulación avanza 20 veces por segundo y la
   pantalla dibuja 60 o más, así que el jugador local también se dibuja entre dos pasos, no en el
   último. Sin esto sólo se movía 20 veces por segundo y se veía a los tirones —el resto se veía
   suave y el tuyo no, que es justo el que mirás.
5. **Cámara sin redondear** (`applyCamera`): nada de `Math.round` en la posición de la cámara ni
   `roundPixels` en los sprites. Redondear a píxeles enteros es lo habitual en pixel art, pero acá
   no alinea nada: la escala de la vista es el alto de la ventana dividido `VIEW_HEIGHT` y sale
   fraccionaria casi siempre (1,25 a 800 px de alto, 1,6875 en 1080p). Con la grilla ya desalineada
   el redondeo no daba nitidez y sí cortaba el movimiento. Y como la cámara te sigue, lo que se
   traba es el mundo entero: se nota mucho más que el propio muñeco.

Para probarlo sin desplegar nada, agregá `?lag=200` a la URL: simula 200 ms de ida y vuelta.
Tu personaje tiene que seguir respondiendo al instante.

Y para medirlo:

```bash
WABBR_HEADED=1 npm run smoothness
```

Camina en línea recta y cuenta qué porcentaje de cuadros no avanzó nada. Necesita ventana real y GPU:
en headless con renderizado por software el navegador dibuja a 4 cuadros por segundo y la medición
habla del emulador, no del juego. El script lo detecta y avisa en vez de dar un veredicto falso.

Mide las dos cosas por separado, porque tienen causas distintas. A 145 fps:

| | Cuadros sin moverse | Desvío del avance |
|---|---|---|
| Muñeco, dibujando la posición simulada | 77% | 150% |
| Muñeco, interpolando entre pasos | 0% | 1,7% |
| Cámara, redondeada a píxel entero | 1-35% | 28% |
| Cámara, sin redondear | 0% | 1,6% |

Cuánto daña el redondeo de cámara depende de la velocidad: si el desplazamiento por cuadro queda por
debajo de un píxel, la mayoría de los cuadros redondea a cero. Por eso empeora cuanto más alta es la
tasa de refresco — en un monitor de 144 Hz es donde peor se ve.

## Tests

```bash
npm test
```

Cubren lo que sostiene todo lo demás: que la simulación sea determinista (mismo estado + mismos
inputs = mismo resultado), que no se pueda atravesar un obstáculo, que las balas no atraviesen
jugadores a pesar de moverse 32 px por tick, la zona, y que la reconciliación converja con latencia
y con pérdida de paquetes.

### Ver el juego sin abrirlo a mano

```bash
npm run dev      # en una terminal
npm run shots
```

Abre dos jugadores en Chromium con Playwright, juega una ronda, recoge loot y
deja las capturas en `.shots/`. Además reporta cualquier error de consola: en un
juego de canvas un error de render no se ve como un error, se ve como una
pantalla vacía.

### Echar del lobby

```bash
npm run kick
```

Mezcla navegador y sockets pelados a propósito. El navegador comprueba lo que ve el jugador —que el
botón aparezca sólo en la lista del host, que al echado lo devuelva al menú con el motivo—; los
sockets pelados comprueban el servidor, que es lo único que cuenta: **esconder un botón no es un
control de acceso**, y un cliente modificado manda lo que quiera. La prueba manda un `kick` desde
alguien que no es host y verifica que no pase nada.

### Bots headless

```bash
npm run dev:server                      # en una terminal
npm run bots -- --bots 8 --seconds 40
```

Conecta jugadores falsos, juega una partida entera y reporta el ritmo y el tamaño de los snapshots.
Sirve para medir antes de invitar gente.

### Humo sobre el build de producción

```bash
npm run smoke
```

Compila el cliente, lo sirve y comprueba una sola cosa: que aparezca el canvas.

Parece poco, pero cubre un agujero que costó caro. Todo lo demás —tests, capturas, bots— prueba el
**servidor de desarrollo**, donde Vite sirve los módulos sueltos. Al empaquetar, Rollup los agrupa en
chunks y cambia el orden de evaluación, y ahí vive una familia de fallas que en dev no existe.

La que nos tocó: un `await` de nivel superior en `main.ts`. Deja el módulo de entrada evaluándose
hasta que la promesa se resuelve, y en ESM los chunks que dependen de él tienen que esperar. Como
Rollup mete el núcleo de PixiJS en el chunk de entrada y el renderizador en otro, se armaba un abrazo
mortal: la entrada esperaba a `init()`, `init()` esperaba al chunk del renderizador, y ese chunk
esperaba a que la entrada terminara. Sin error, sin petición fallida, con el chunk descargado en 200
y la página en blanco. Llegó hasta producción.

## Desplegar

### Servidor (Cloudflare)

```bash
npm run deploy:server
```

Anotá la URL que devuelve (`https://wabbr-server.<tu-cuenta>.workers.dev`).

En `apps/server/wrangler.jsonc`:

- `ALLOWED_ORIGINS`: poné tu dominio de Vercel, por ejemplo
  `"https://wabbr.vercel.app,https://*.vercel.app"`. Vacío deja entrar a cualquiera (sólo para dev).
- `DO_LOCATION_HINT`: región donde se crean las salas (`sam` para Sudamérica). Sin esto, la sala se
  crea cerca del primero que entra y el resto paga el ping.

### Cliente (Vercel)

Importá el repo y agregá la variable de entorno:

```
VITE_SERVER_URL = wabbr-server.<tu-cuenta>.workers.dev
```

Sin `https://` ni `wss://`: PartySocket arma el protocolo solo, y usa `ws://` únicamente para
localhost y direcciones de red local. Ojo que **Vite hornea esta variable dentro del bundle al
compilar**, no la lee en vivo: si la cambiás después, hay que volver a desplegar.

#### Por qué hay dos `vercel.json`

Uno en la raíz y otro en `apps/client/`, con la misma intención escrita de dos formas. No es un
descuido: **Vercel busca el `vercel.json` dentro del Root Directory del proyecto**, no en la raíz del
repo. Si ese ajuste apunta a `apps/client`, el archivo de la raíz queda invisible, Vercel cae en el
preset de Vite y busca la salida en `dist` de la raíz, donde no hay nada:

```
Error: No Output Directory named "dist" found after the Build completed.
```

El build había funcionado; lo que falla es dónde se busca el resultado. Con los dos archivos, el
despliegue sale bien tenga el Root Directory en la raíz o en `apps/client`:

| Root Directory | Archivo que lee | Build | Salida |
|---|---|---|---|
| *(vacío)* | `vercel.json` | `npm run build --workspace @wabbr/client` | `apps/client/dist` |
| `apps/client` | `apps/client/vercel.json` | `npm run build` | `dist` |

En los dos casos `npm install` resuelve el monorepo entero: npm sube solo hasta el `package.json` con
`workspaces` y de ahí saca `@wabbr/shared`, que el cliente necesita para compilar.

## Costos

El plan gratuito de Cloudflare da 100.000 requests/día para Durable Objects. Los mensajes WebSocket
entrantes cuentan **20 a 1** y los salientes son gratis, así que con input a 20 Hz y 10 jugadores
(200 mensajes/s → 10 requests/s) rinde alrededor de **2,5 horas de partidas por día**. El plan de
5 USD/mes incluye 1M de requests mensuales, de sobra para un grupo de amigos.

Ese número es el motivo de que el input vaya a 20 Hz y no a 60.
