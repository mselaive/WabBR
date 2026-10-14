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

Hace falta **Node 22** o más nuevo: es lo que pide wrangler, el servidor local. Está
fijado en `.nvmrc`, así que con nvm alcanza con `nvm use`. Con uno más viejo
`npm run dev` avisa y no arranca, en vez de levantar sólo el cliente y dejarte un menú que no
conecta con nada.

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
| `H` | tirar una granada de humo |
| `J` | tirar una molotov |
| `F` / click en el minimapa | marcar un lugar para tu compañero (dúos) |
| `6` `7` `8` `9` | frases rápidas: ¡GG!, Jajaja, ¡Cuidado!, Perdón |
| `Tab` | tabla de posiciones |
| `M` | silenciar el sonido |
| Click / `←` `→` (muerto) | mirar a otro jugador |
| `Espacio` (muerto) | cámara libre, que se mueve con `WASD` |

No ves a través de las paredes: mirá la sección de línea de vista.

### En el teléfono

Se juega acostado. Con el primer toque aparecen los controles táctiles (`apps/client/src/touch.ts`):

- **Dedo izquierdo**: un stick que aparece donde apoyás el dedo. Mueve en ocho direcciones, igual
  que el teclado (el servidor sólo acepta -1, 0 o 1 por eje), y empujado a fondo corre.
- **Dedo derecho**: otro stick que apunta. Empujado más de la mitad, dispara; menos, sólo apunta, y
  al soltarlo la mira queda donde estaba.
- **El HUD se toca**: la ranura cambia de arma, cada fila de la mochila usa lo suyo (vendas,
  granada, humo…) y el cartel de "recoger" recoge. Más los botones **Recargar** y **Tabla**.
- Muerto, tocar a un costado cambia a quién mirás.

Usa eventos táctiles y no de puntero, porque cancelarlos es lo único que evita que el navegador
además simule un click: cada toque era un tiro. Con menos de 500 px de alto el HUD se achica
entero, y parado aparece "Girá el teléfono". En una compu con mouse no aparece nada de esto, y si
la compu además tiene pantalla táctil, mover el mouse le devuelve la puntería.

Probado emulando un teléfono en Chrome con toques de dos dedos (moverse, correr, apuntar, disparar,
recargar, y que un toque suelto no dispare); **no lo probé en un teléfono de verdad**.

### Bots

El host puede **agregar bots** desde el lobby, para completar la sala o practicar
solo. Los corre el servidor dentro de la misma sala (`sim/bot.ts`): no se conectan
desde ningún lado, así que no cuestan mensajes de Cloudflare, y mandan inputs como
cualquier jugador, sin hacer nada que un jugador no pueda.

Juegan razonable sin ser perfectos: abren cajas y recogen armas mejores (nunca
cambian una buena por una peor), se curan cuando no hay nadie, pelean moviéndose de
costado a la distancia que le gusta a su arma y respetan la zona. Para que se les
pueda ganar, tardan un instante en reaccionar al verte y apuntan con un error que
va cambiando despacio.

**Tiran granadas** y **se escapan de las que les caen cerca**. Como una granada no
se tira "a" un punto —sale siempre igual y rueda unos 320 px—, el bot simula el
tiro con la misma física del servidor desde tres direcciones y sólo la tira si va a
estallar al lado del otro y lejos suyo; así tampoco la tira contra una caja que se
la devolvería. Después de tirarla no se acerca por dos segundos (antes caminaba
derecho hacia la explosión), y ya no le dispara a un barril que tiene al lado. En
ocho partidas de seis bots, el daño que se hacían solos bajó de 1536 a 109. Con poca
vida tiran **humo** entre ellos y el que les dispara (simulado igual, para que la nube
quede en la línea entre los dos), se alejan y, sin nadie a la vista, se curan.

**Dificultad**: con algún bot en la sala, el host elige *Fácil*, *Normal* o *Difícil* (`BOT_SKILLS`).
Cambia cuánto tardan en reaccionar al verte (fácil 14-25 ticks, normal 7-15, difícil 3-7), cuánto
tiembla su puntería y si tiran granadas (los fáciles, no).

Encuentran el camino con A* sobre una grilla de 10 px (`sim/nav.ts`). Yendo en
línea recta se trababan contra la primera pared, y como casi todas las cajas están
adentro de casas, se quedaban encerrados cuando cerraba la zona: un tercio moría
así. Con caminos, de 48 bots en 12 partidas mueren por la zona uno o dos. La grilla
tiene que ser fina porque hay puertas con un tabique justo detrás que dejan pasillos
de 26 y 34 px; con celdas de 20 px casas enteras quedaban como cerradas.

Cuestan poco: unos 0,1 ms por tick con 12 bots. Las búsquedas de camino tienen un
cupo de dos por tick entre todos —al arrancar la partida todos quieren la suya a la
vez— y una sala con bots solos cuenta como vacía y se apaga. La grilla además sabe qué zonas
están conectadas entre sí (se calcula una vez por mapa): pedir un camino a un lugar encerrado
antes recorría toda la zona alcanzable antes de rendirse, y con dos búsquedas así en el mismo
tick el servidor llegaba a 60 ms (el tick dura 50). Ahora se contesta al instante; con 16 bots el
peor tick de una partida entera baja a unos 16 ms, y es el del arranque.

`node scripts/server-bots.mjs` prueba contra el servidor local que una partida con
bots se juegue entera.

### Si se corta la conexión

En partida, un corte no te saca del juego: el servidor te guarda el lugar 15 segundos
(`RECONNECT_GRACE_MS`) con el muñeco quieto donde estaba —y lo pueden matar—, el
cliente muestra "Reconectando…" y vuelve solo. Cada pestaña tiene un token en
`sessionStorage` con el que el servidor la reconoce; recargar la página también
vuelve al mismo asiento. Los demás te ven como "sin conexión" en la tabla.

Antes, un corte de un segundo te mataba ahí mismo y al volver entrabas como
espectador. `node scripts/reconnect.mjs` lo prueba contra el servidor local (con
`--largo` también prueba que pasado el plazo se te da por ido).

### El lobby

Si entrás con un link de invitación (`?room=XXXXXX`), el botón grande es **Entrar a la sala** y
crear una sala nueva queda chico abajo: con "Crear sala" en grande, la gente lo apretaba y
terminaba sola en una sala aparte. El menú y el lobby entran en un teléfono parado (antes el
panel medía 471 px en una pantalla de 390 y se cortaba a la derecha).

El que crea la sala es el host: puede forzar el arranque sin esperar a que todos marquen listo, y
puede **echar a cualquiera** con la ✕ de su fila. Si el host se va, el puesto pasa al siguiente.

Al echado lo devuelve al menú con el motivo, y no puede volver a entrar con el mismo nombre. Es un
bloqueo blando y a propósito: sin cuentas no hay identidad estable, así que cambiando el nombre entra
igual. Cubre lo que molesta —el que reentra de un clic— y no pretende ser más que eso. Sólo funciona
en el lobby: en partida, echar sería un arma más.

**Reglas especiales.** Para variar la noche, el host elige entre *Normal*, *Todo legendario*
(toda arma —en el piso, en cajas, en paquetes y la de arranque— sale en su máxima rareza),
*Francotiradores* (todos arrancan con uno y las armas que aparecen son sólo francotirador,
ballesta o revólver), *Relámpago* (la zona espera un tercio en cada fase y todos arrancan con
subfusil y chaleco ligero) y *Caos* (todos arrancan con lanzacohetes, dos granadas y dos
molotovs: partidas cortas y ruidosas para cuando son muchos). Se aplican en la simulación (`ruledLoot`, `startingWeapon`), así que
valen igual para el botín, las cajas y los paquetes.

**Opciones de sí o no.** Abajo de las reglas, una sola fila con tres interruptores que el host
prende y apaga: *Mapa nuevo* (ver El mapa), *Segunda oportunidad* (ver más abajo) y *De noche*.
Antes eran tres filas de "esto o aquello" y el lobby no entraba en un teléfono.

**De noche.** De noche ves unos 230 px alrededor tuyo y el
resto queda en penumbra azul; iluminan las fogatas, el fuego de las molotov, las explosiones y
los fogonazos, así que **disparar de noche te delata**. Los bots también ven menos (330 px en vez
de 700). Es sólo de cómo se dibuja (`updateNight`: un lienzo a un cuarto de la resolución con
agujeros de luz suaves) más la vista de los bots: el servidor sigue mandando lo mismo.

**Dúos.** Arriba de la lista, el host elige *Todos contra todos* o *Dúos*. En dúos cada
fila tiene un botón **Pareja**: si dos se eligen entre sí juegan juntos (al otro le
aparece "Aceptar pareja"; un bot acepta solo). Los que no eligieron se emparejan por
sorteo al empezar (con número impar, uno juega solo; con dos jugadores no hay dúos,
porque serían compañeros). Cada pareja aparece junta en su lugar del anillo. Los compañeros no se lastiman —las balas los atraviesan y
las granadas no les hacen nada, aunque al que la tiró sí—, se ven siempre, aunque haya
una pared o un arbusto en el medio, y el compañero tiene el nombre en verde y un anillo
verde en el minimapa. El puesto es de la pareja: se decide cuando cae el último de los
dos, y si gana, gana entera, también el que cayó antes. Muerto, la cámara sigue a tu
compañero. Los bots juegan en pareja igual (no se tiran entre ellos ni huyen de la
granada del compañero). En la simulación, todos contra todos es lo mismo con equipos de
uno (`PlayerState.team` es el propio id), así que no hay dos caminos para cada regla.

**Caer y levantar.** En dúos, el que llega a cero con el compañero todavía en pie no
muere: **cae**. Queda acostado, con "(caído)" en el nombre, se arrastra a un tercio de la
velocidad, no puede disparar ni usar nada y se desangra en 30 segundos (la barra roja
sobre él y "TE DESANGRÁS" en su HUD). El compañero lo levanta con `E` quedándose quieto a
su lado 4 segundos —moverse, disparar, curarse, recibir un tiro o cualquier otra cosa lo corta— y vuelve con 30 de
vida. Rematar a un caído es la kill del que remata; si se desangra o lo termina la zona,
del que lo tiró. Si cae el último en pie de la pareja, el caído también se termina. En el
registro se ve "(caído)", y el compañero recibe el aviso de ir a levantarlo. Los bots se
arrastran lejos del que les tira, prefieren tirarle al que todavía les puede devolver los
tiros y, sin nadie a la vista, van a levantar al suyo. Todo vive en la simulación
compartida (`downed`, `stepDowned`, `downOrKill`): `downed` viaja en el snapshot, así la
predicción del cliente también se arrastra y no dispara.

**Frases rápidas.** Con `6` a `9` (o el botón "¡GG!" en el teléfono) aparece un globito arriba
de tu muñeco por dos segundos y medio: "¡GG!", "Jajaja", "¡Cuidado!" o "Perdón". Le llega sólo a
los que te ven —un "¡Cuidado!" no puede decir dónde estás— y a lo sumo una por segundo.

**Marcas.** En dúos, `F` marca donde apunta el cursor y un click (o un toque) en el
minimapa marca ese lugar: a tu compañero le aparece un rombo del color tuyo encima del
lugar —o una flecha en el borde si está fuera de pantalla—, un anillo en el minimapa y
un sonido corto, durante 5 segundos. Una por persona (la nueva reemplaza a la anterior)
y a lo sumo dos por segundo. El servidor se la manda sólo a la pareja: a un rival le
diría dónde estás mirando. Se puede marcar también muerto, mirando: el compañero sigue
jugando por los dos. `node scripts/marks.mjs` lo prueba contra el servidor local.

**Marcador de la sala.** Al lado de cada nombre, cuántas ganó de las que jugó en esa sala y cuántas
kills lleva sumadas ("2/5 ganadas · 11 kills"). Para la noche en que se juegan varias rondas entre
amigos. Vive en la sala, en el asiento de cada uno: sobrevive a un corte de conexión pero no a salir
de la sala, y no se guarda en ningún lado. Es lo que daría un perfil sin tener cuentas (ver
`IDEAS.md`). El que entra a mirar con la partida empezada no suma una partida jugada.

**El campeón de la sala.** El que viene dominando la noche —al menos 3 partidas ganadas en la
sala y 2 más que el que le sigue— arranca cada partida con una desventaja: **todos lo ven siempre en el minimapa**, con una corona roja que lo
sigue, y su nombre lleva ♛. Al empezar, un aviso le dice a todos quién es. Es para que el que
viene ganando toda la noche no gane siempre: le da a todos un objetivo. Lo decide el servidor con
el marcador de la sala (`roomChampion`), y su posición viaja en el snapshot (`ch`).

## El mapa

Arena circular de 3000 px de diámetro, generada con una semilla en
`packages/shared/src/map/arena.ts`. No viaja por la red: cliente y servidor
corren la misma función y llegan al mismo resultado.

**Un mapa nuevo cada partida.** En el lobby el host elige *Mapa de siempre* o *Uno nuevo cada
partida*. Hay 12 mapas (`MAPS`): las mismas piezas —distritos, casas, fogatas, hongos—
acomodadas de otra forma, cada uno con nombre ("Mapa: Laguna Seca"). Por la red viaja sólo el
número; cliente y servidor generan el mismo mapa. El mapa cambia en el lobby, nunca en partida:
con *Uno nuevo cada partida*, al volver de una partida ya toca otro distinto, y el botón dice
cuál. El cliente arma el escenario de nuevo ahí, en el lobby, y no al empezar.

No son semillas al azar: probando 40, una de cada diez dejaba alguna caja donde los bots no
llegan, y algunas tenían hongos que te dejaban adentro de un montón de cajas (eso se arregló para
todas, ver Hongos saltarines). Cada mapa de la lista pasa por `sim/maps.test.ts`: los seis
distritos, todas las casas con entrada, las 16 apariciones libres, el 95 % de las cajas al alcance
de los bots y los saltos de cada hongo en 32 direcciones. Y la prueba de bots del servidor juega
su partida en un mapa nuevo.

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

Se aparece en un anillo cerca del muro (`spawnPoint`), repartidos parejo para que
nadie arranque al lado de otro. El anillo gira con cada partida y el lugar de cada
uno se sortea: antes salía del orden de llegada a la sala, así que el que la creaba
aparecía siempre al este y el segundo siempre enfrente.

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

- **Nueve armas** (`packages/shared/src/items.ts`): pistola, subfusil, rifle,
  escopeta, francotirador, ballesta, lanzacohetes, revólver y ametralladora. Dos ranuras, así que hay que elegir. La escopeta es
  para pelear de cerca: dos tiros matan hasta unos 100 px, y de ahí para afuera
  pierde contra el rifle. Su cono abría el doble y a 120 px entraban tres
  perdigones de ocho; hay tests que fijan las dos cosas.
- **El revólver** es la pistola pesada, lenta y precisa: tres tiros matan, y ni en legendario
  mata de dos (hace 57). **La ametralladora** tiene 60 balas para tapar una puerta o una calle, abre
  más que el rifle y su recarga es eterna (4 segundos).
- **El lanzacohetes** es el arma rara: **sólo existe legendario** y sólo lo trae uno de cada
  ~8 paquetes aéreos (en vez de la otra arma); nunca sale de una caja. El cohete es lento (se ve venir, con su estela de humo, y se esquiva) y no pega:
  estalla donde toca o al final de su alcance, con la misma explosión que la granada. De
  lleno deja a cualquiera con unos 10 de vida, nunca lo mata de un tiro; te lastima a vos si
  lo tirás pegado a alguien, y hace estallar barriles. Los bots lo usan de lejos y no lo
  disparan contra el que tienen encima.
- **La ballesta es silenciosa**: sin fogonazo y sin delatarte, así que se puede
  tirar desde un arbusto sin salir de él. Dos flechas matan, pero hay que recargar
  después de cada una y la flecha es lenta. Sale sólo de las cajas.
- **El francotirador tiene mira**: con él en la mano la cámara se aleja un 40 %
  (en unos 0,3 s, para no marear). Su bala llega a unos 1400 px y la pantalla
  mostraba 570 hacia cada costado: tenía más alcance que lo que se veía. El
  servidor no recorta por distancia, sólo por línea de vista, así que no hubo que
  tocarlo; sí se buscan sombras más lejos para que lleguen a las esquinas.
- **Cinco rarezas** (común → legendaria), que multiplican daño, recarga,
  cargador y precisión. No tocan la cadencia ni el alcance a propósito: un rifle
  legendario sigue siendo un rifle, no una escopeta mejor.
- **Curación con canalización**: vendas, botiquín y adrenalina. Te quedás quieto
  unos segundos y si te movés o te pegan se cancela. Eso es lo que la convierte
  en una decisión y no en un botón.
- **Chalecos**: una barra de escudo que se gasta antes que la vida. La zona la
  ignora, para que un chaleco no te deje sobrevivir afuera.
- Al morir soltás todo lo que llevabas: matar a alguien tiene que valer la pena.
- **Curaciones y granadas se juntan solas** al pasarles por encima, si entran enteras en la
  mochila (como la munición en surviv.io). Armas y chalecos siguen pidiendo `E`: ahí hay que
  elegir, y nadie quiere soltar su arma sin querer.

Cada arma tiene un **techo de rareza** (`maxTier`). El francotirador tope en
épica: con el multiplicador legendario haría 104 de daño y mataría de un tiro
desde fuera de la pantalla, que no es una pelea sino una lotería. Hay un test
que recorre todas las armas en su rareza máxima y falla si alguna puede matar de
un disparo a alguien con la vida llena, así que tocar los multiplicadores sin
pensarlo avisa solo.

Todo eso vive en `packages/shared/src/sim/step.ts`, para que cliente y servidor
no puedan discrepar. Las acciones (recoger, cambiar de arma, curarse) viajan en
el campo `act` del mensaje de input que ya se manda 20 veces por segundo: no
agregan ni un mensaje nuevo, que es lo que importa para la factura de Cloudflare.

## Fogatas

Copiadas de Fortnite. Hay **6 fogatas** en el mapa, una en cada uno de los distritos más
grandes, al aire libre (un puntito naranja en el minimapa). Quedándote a menos de 70 px de una,
y si no te pegaron en los últimos 3 segundos, recuperás 3 de vida por segundo hasta llenarte.
Lento a propósito: es para el respiro entre peleas, no para curarte en medio de una. El HUD avisa
"Al calor de la fogata". Los bots heridos y sin curaciones van a la más cercana. Se ubican al
final del generador del mapa y con su propio azar, así el resto del mapa queda idéntico.

## Hongos saltarines

Copiados de Fortnite. Hay **10 hongos** repartidos por el anillo del mapa (y en el minimapa, un
puntito rojo). Pisar uno te lanza unos 400 px para donde ibas —o para donde apuntás, si estabas
quieto— **por encima de lo que haya en el camino**: paredes, cajas, contenedores. Sirven para
escapar de una pelea o de la zona. En el aire el muñeco se agranda como si subiera y suena un
"boing". Si al caer quedás encima de algo, volvés por donde viniste, de a 8 px, hasta un lugar
libre: empujar para afuera alcanza si caés rozando una caja, pero no en el medio de un montón
(cada empujón te mete en la de al lado). Así sirve para cualquier mapa, no sólo para el que se
probó a mano: un test tira de cada hongo de cada mapa en 32 direcciones y nadie queda adentro
de nada.

El salto vive en `stepPlayerMovement`, que es compartido: el cliente lo predice igual que el
servidor, y el estado del salto viaja en el snapshot (la velocidad, sólo al dueño) para
reconciliar. Un test lo prueba con 150 ms de ping: el cliente vuela y cae donde el servidor sin
corregir nada. El test de reconciliación con inputs perdidos usa el mapa sin hongos: un input
perdido justo al pisar uno cambia todo el salto, y en el juego no pasa porque los inputs van por
TCP.

## La caja dorada

En cada partida se sortea **una caja dorada** entre todas las del mapa (distinta cada vez, con
su propio azar, así no cambia nada más del reparto). Es de oro y larga destellos, pero **no sale
en el minimapa**: hay que encontrarla. Trae botín de paquete aéreo:
un arma épica o legendaria (nunca el lanzacohetes), el chaleco pesado y un botiquín.

## Paquetes aéreos

Cuando la zona empieza a cerrarse en las dos primeras fases, cae un paquete con
botín de lujo: un arma épica o legendaria (hasta el techo de cada una), el chaleco
pesado, un botiquín y dos granadas. Cae en un lugar despejado **adentro de la
próxima zona**, tarda 10 segundos en llegar y mientras tanto se lo ve bajar con su
paracaídas, con un anillo dorado en el piso y un cuadrado que late en el minimapa.

Es lo que más ayuda con pocos jugadores en un mapa pensado para 16: todos saben
dónde va a caer lo mejor, y eso los junta. Al tocar el piso el botín queda en
corona, como el de las cajas, y se recoge con `E`. Dónde cae no es secreto: viaja a
todos en el snapshot (`ad`), aunque no lo tengan a la vista.

## Bombardeo

Copiado de la "zona roja" de PUBG. A mitad de la espera de las fases 1 a 3 se marca un
círculo rojo de 210 px adentro de la zona, con una cruz en el medio, en el piso y en el
minimapa, y suena una sirena con el aviso "¡Bombardeo!". Cinco segundos después caen bombas
en puntos al azar durante seis segundos: una cada medio segundo, con la misma explosión que
la granada (también hacen estallar barriles). **Adentro de una casa no te alcanzan**: ninguna
bomba cae bajo techo y las paredes frenan la explosión, igual que con las granadas. Saca a
la gente de donde está acampando y el ruido tapa los tiros. Las muertes se anotan al
bombardeo (nadie suma la kill) y los bots se van del círculo. Todo es de la simulación
compartida con el azar de la partida (`launchStrike`, `stepStrikes`); el cliente sólo dibuja
lo que llega en el snapshot (`rz`).

## El minimapa no es un radar

El servidor te manda a los que tenés en línea de vista hasta 1150 px, también los que quedan
fuera de la pantalla (para que aparezcan sin saltos al entrar en ella). El minimapa los dibujaba
a todos, y eso era un radar: desde un arbusto se veían puntitos de gente que en la pantalla no
estaba. Ahora, jugando, el minimapa muestra sólo a vos y a tu compañero, más lo que es público a
propósito: el más buscado, el campeón de la sala, los bombardeos, los paquetes y las fogatas. Muerto o mirando, sí se ve a todos.

## El más buscado

Copiado de Warzone. Sólo el que domina de verdad —al menos 4 kills y 2 más que el que le sigue—
es **el más buscado**: le aparece a todos una estrella dorada en el minimapa donde se lo vio, que se
refresca cada 5 segundos (es una pista, no un radar), y su nombre va en dorado con una ★. El
que lo mata **cobra la recompensa: vida llena**, y todos se enteran por el aviso. Lo sigue siendo
mientras vaya primero solo; si alguien lo alcanza, deja de serlo. Le da a todos un objetivo y un precio
a ir ganando. Los bots que ya tienen algo mejor que la pistola van a buscarlo si está cerca;
con la pistola de arranque, no: sería regalarle otra kill.

## Segunda oportunidad

Copiado de Warzone (Resurgimiento), y opcional: lo prende el host. El que muere temprano —antes de
que la zona empiece a cerrarse por segunda vez— **vuelve una vez**, a los 8 segundos, con lo de
arranque. Mientras espera mira al que lo mató con una cuenta regresiva ("Segunda oportunidad: volvés
en 6 s"), pero su minimapa sigue siendo el de un vivo: si no, volvería sabiendo dónde está cada uno.

- Suelta todo al morir, como cualquiera: matarlo sigue valiendo la pena, y quien lo mató se anota
  la kill. Las suyas, el daño y el resto de sus números siguen contando.
- Vuelve adentro de la zona (de la próxima, si se está cerrando) y lejos de los rivales: de seis
  lugares libres al azar, el que tenga al rival más cercano más lejos.
- La partida no termina mientras alguien espera para volver, y su equipo no queda afuera. El que
  se desconecta mientras espera la pierde.
- Todos se enteran ("X volvió con su segunda oportunidad"), y al final se lleva el título **Gato:
  volvió de la muerte** si no ganó otro.

Vive en la simulación compartida (`secondChanceOpen`, `stepRespawns`): el cliente no predice nada
especial, al volver el predictor se planta donde apareció como al empezar la partida.

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

**Molotov** (`J`): rueda igual y al romperse deja un charco de fuego de 72 px por 6 segundos
que quema 12 por segundo al que esté adentro —al que la tiró también, a su compañero no—, a
cuenta del que la tiró. Sirve para sacar a alguien de atrás de una caja o cerrar una puerta. No
hay un "hit" por tick (serían veinte por segundo): se ve en la vida que baja y en las llamas. Las
paredes lo frenan igual que a la vista (del otro lado de una casa no quema); detrás de una caja sí.
Los bots salen del fuego y, si no les quedan granadas, tiran la molotov igual que una granada.

**Humo** (`H`): rueda igual que la granada y a los 2 segundos suelta una nube de
115 px de radio que dura 10 segundos. Tapa la vista, no las balas: nadie ve a
través de la nube, ni de afuera hacia adentro ni al revés, salvo que estén a
menos de 70 px. Sirve para cruzar una calle abierta, para curarte o para escapar
de un francotirador. Adentro, disparar no te delata (en un arbusto sí): desde
afuera se ven las balas salir, no quién tira.

Funciona con la misma regla que los arbustos, `concealedFrom`, así que el
servidor no te manda a los que el humo tapa y los bots tampoco los ven. La nube
crece en medio segundo y se achica en los últimos dos, y lo que tapa sigue ese
radio (`smokeRadius`) tal como se dibuja. Las nubes viajan en el snapshot a
todos, porque se ven de lejos y son lo que explica que de golpe no veas a nadie.
Sale de las cajas y del piso; los bots la usan para escapar (ver Bots). Con esto
el protocolo pasó a la versión 2: un cliente viejo ve "recargá la página".

**Los barriles explotan.** Tres tiros de pistola (`BARREL_HP`) y estallan igual que
una granada, con el daño a cuenta del que los hizo estallar: tirarle al barril que
tiene alguien al lado es una forma de pelear, y tirarle al que tenés al lado tuyo te
cuesta caro. Una explosión lastima a los barriles de alrededor, así que los que están
juntos se encadenan. Después quedan quemados: siguen siendo cobertura y ya no
estallan, y así no hubo que tocar las colisiones, ni la predicción ni los caminos.
Los clientes los dibujan quemados por el evento `barrel`, y el que entra tarde los
recibe en el mensaje de objetos, igual que las cajas abiertas.

El daño en área vive en `applyExplosion`, separado de las granadas a propósito:
cualquier cosa que estalle —un barril, un cohete— lo va a usar igual, y así el
balance de las explosiones queda en un solo lugar.

## Feedback de combate

**Rachas**: varias kills en menos de 4,5 segundos son "¡Doble kill!", "¡Triple kill!",
"¡Cuádruple kill!" y "¡Masacre!"; 5 kills sin morir, "¡Imparable!", y 8, "¡Leyenda!". La tuya sale
en grande en el medio de la pantalla con unas notas que suben; la de los demás, en el registro,
para que se sepa a quién hay que frenar. Se arma en el cliente con los eventos de kill.

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

### Récords personales

Sin cuentas: tus números se guardan en este navegador (`apps/client/src/records.ts`). En el
menú aparece "12 partidas · 3 ganadas · récord: 6 kills · tiro más largo: 32 m", y al terminar
una partida en la que superaste algo, el resultado lo dice: "¡Récord personal! 5 kills (antes
3)". Si borrás los datos del navegador o cambiás de compu, empezás de cero. La primera partida
no rompe récords: no había nada que romper. Los metros son 20 px cada uno (un muñeco mide
~1,2 m).

### Logros y gorros

Tampoco con cuentas: en el menú, abajo del nombre, está **tu gorro** (`apps/client/src/achievements.ts`).
Hay 9 logros y cada uno desbloquea un gorro que todos ven sobre tu muñeco (y en el podio):

| Logro | Cómo | Gorro |
|---|---|---|
| Primera sangre | Tu primera kill | Galera |
| Campeón | Ganar una partida | Corona |
| Masacre | 5 kills en una partida | Casco |
| Ojo de águila | Una kill a 40 m o más | Sombrero vaquero |
| Veterano | Jugar 10 partidas | Gorro de fiesta |
| Demolición | Una kill con el lanzacohetes | Cuernos |
| Pirómano | Una kill con una molotov | Bandana |
| Ángel guardián | Levantar a tu compañero | Aureola |
| Búho | Ganar de noche | Gorro de mago |

Al conseguir uno, un aviso lo dice. Los bloqueados se ven apagados y dicen cómo se consiguen. El
gorro viaja como un número con el nombre al conectarse (`?hat=`), el servidor sólo comprueba que
exista. Se guarda en el navegador: alguien que edite su almacenamiento puede ponerse cualquiera,
y para un juego de amigos está bien así. Los bots llevan uno al azar.

### Cómo te mataron

Al morir, arriba de la vista de espectador queda **quién te mató, con qué y cómo lo
dejaste**: "Te mató Lola con el rifle. Le quedaban 12 de vida y 20 de chaleco." Es la
diferencia entre "me ganó" y "casi lo tengo". La vida del que mató viaja en el evento
`kill` (`killerHp`, `killerShield`), así que no depende de que lo estuvieras viendo.

### Fuera de la zona

Si quedás afuera, el borde de la pantalla se tiñe de rojo y late, aparece el cartel
**FUERA DE LA ZONA** con cuánto te saca por segundo y cuántos segundos aguantás así,
y una flecha del color del borde de la zona sale de tu muñeco apuntando para volver.
En los últimos cinco segundos el cartel late más rápido.

Los segundos salen sólo de la vida, porque la zona no mira el chaleco. Y se mide con
tu posición predicha contra la zona tal como se dibuja: el aviso salta justo cuando
ves que cruzás la línea, no un ping después.

### Ritmo según cuántos juegan

El mapa está pensado para 16. Con 2 o 3 personas se caminaba mucho antes de
cruzarse con alguien, así que las **esperas** de la zona se acortan según cuántos
arrancaron la partida (bots incluidos): con 2 duran la mitad, y crecen parejo
hasta lo normal con 8 o más. Las contracciones no cambian: la zona no corre más
rápido, sólo empieza a cerrar antes. Una partida de dos dura unos 3 minutos y
medio en vez de 5. Los números están en `ZONE_MIN_PACE` y
`ZONE_FULL_PACE_PLAYERS`.

## Fin de la partida

**Un título para cada uno** (`apps/client/src/titles.ts`), abajo de su nombre en la tabla:
nadie se va sin nada. Primero los que ganaron ("Último en pie") y los mejores de verdad en algo
("Carnicero", "Demoledor", "Ojo de halcón", "Francotirador"); después, según lo que hizo cada
uno, para bien o para mal —"Kamikaze: se sacó 45 de vida solo", "Ciego: no dio una bala",
"Pacifista: no disparó ni una vez"—, que pueden repetirse; después "Enfermero", "Esponja",
"Granadero", "Gatillo fácil", "Maratonista" y "Primero en caer" entre los que quedaron; y al
final "Luchador" o "Turista: paseó 1:12 sin hacer nada". Para esto el resultado trae además
cuánto se curó cada uno, cuánto daño se hizo solo, cuánto caminó y cuántas granadas tiró.

El resultado se ordena por **puesto**, que es lo que decide un battle royale: el
último en pie es el 1, el último en caer el 2, y así. Las kills van al lado y
desempatan. Arriba hay un podio con los tres primeros —cada uno con su muñeco y su
color— y abajo la tabla completa, con tu fila marcada.

Además de las kills, la tabla tiene el **daño hecho**, la **puntería** y cuánto
**aguantó vivo** cada uno, y entre el podio y la tabla hay tres premios: más daño,
más kills y mejor puntería. Los cuenta el servidor (`damageDealt`, `shotsFired`,
`shotsHit`... en `PlayerState`) porque el cliente no ve todo: los eventos se filtran
por línea de vista y con lo que le llega a cada uno los números saldrían mal. Viajan
una sola vez, con la partida terminada (`res` en el snapshot).

- El daño es el que **de verdad entró**, escudo incluido: rematar con un escopetazo
  de 64 a alguien con 10 de vida suma 10. Las granadas propias no cuentan.
- La puntería es por proyectil, así que cada perdigón de la escopeta cuenta. Para
  el premio hacen falta al menos 20: con dos tiros y uno adentro cualquiera tendría
  50 % y le ganaría al que se pasó la partida peleando.

El puesto lo calcula el servidor (`PlayerState.place`) al final de cada tick y no al
morir, por dos motivos: así también le toca al que se desconecta en el medio (que
figura con "se fue"), y dos que caen en el mismo tick —una granada, la zona— empatan
en vez de quedar ordenados por casualidad. Si no sobrevive nadie, los últimos en caer
comparten el primer puesto. El que entró a mirar con la partida empezada no figura.

## Sonido

Se genera por código, igual que el arte (`apps/client/src/audio.ts`): ruido filtrado
para los disparos —cada arma con su voz— y las explosiones, tonos cortos para los
avisos (acierto, te pegan, kill, recarga, recoger, fuera de la zona, paquete). Los
sonidos del mundo se oyen según dónde pasan: más bajo cuanto más lejos (nada pasados
1100 px) y del lado de donde vienen. Con la línea de vista tapando lo que pasa detrás
de una pared, oír un tiro a la izquierda es información. La ballesta no hace ruido
para los demás.

`M` lo silencia y se recuerda en el navegador. Los niveles están medidos —se pueden
renderizar sin parlantes pasándole un `OfflineAudioContext` a `unlock()`—: ninguno
pasa de 0,41 de pico, y un tiro a media pantalla a la derecha llega al oído izquierdo
a un tercio.

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

**Los arbustos esconden.** Metido en uno, los demás dejan de verte: el servidor no te
manda en su snapshot, igual que detrás de una pared. Tres reglas lo mantienen justo
(`concealedFrom` en `sight.ts`): de muy cerca (90 px) se te ve igual, disparar te
delata un segundo y medio, y esconderse no frena las balas —el que tira a ciegas al
arbusto te puede pegar—. Los bots respetan lo mismo. Tu muñeco se ve medio
transparente y aparece "Escondido en el arbusto" sobre la vida, así sabés que
funciona. Es lo que hace útil al Parque: cruzar el mapa sin que te vean.

Al morir se sigue a quien te mató. Con click o con las flechas se pasa a otro
jugador vivo, y el HUD muestra su vida, su arma y su mochila; con `Espacio` se
suelta la cámara y se recorre el mapa con `WASD`. La tabla con `Tab` también
funciona muerto: antes, al morir se apagaba todo el teclado.

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
movimiento llega con el retraso del ping. Acá hay seis piezas:

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
6. **Disparos predichos** (`net/shots.ts`): tu bala, el fogonazo y el retroceso salen en el mismo
   input en que apretás el gatillo. Ver la sección siguiente.

Para probarlo sin desplegar nada, agregá `?lag=200` a la URL: simula 200 ms de ida y vuelta.
Tu personaje tiene que seguir respondiendo al instante, y tus balas también.

### Por qué las balas salían con retraso

Las balas eran lo único tuyo que no se predecía. Entre el click y verla salir se sumaban:

| | Cuánto |
|---|---|
| Esperar al próximo input (salen a 20 Hz) | 0-50 ms |
| Ida y vuelta al servidor | el ping |
| Esperar al próximo tick del servidor | 0-50 ms |
| Dibujarla con el atraso de la interpolación, como a los demás | 100 ms |
| La cola de inputs del servidor atrasada (ver abajo) | 0-350 ms |

Y como mientras tanto te seguías moviendo, salía de donde estabas hace un rato: de atrás tuyo.

Ahora el cliente decide el disparo con la misma función que el servidor (`stepWeaponState`: cadencia,
munición, recarga, cambio de arma, curación) y lo dibuja al toque. Para que la bala dibujada vaya
por el mismo camino que la real, la dispersión ya no sale del rng de la partida —que el cliente no
conoce— sino de quién disparó, el `seq` del input y el número de perdigón (`shotPellets`). Por lo
mismo el ángulo se redondea antes de predecir, igual que viaja por la red.

El evento `shot` trae el `seq` y los ids de las balas que creó. Con eso el cliente empareja su tiro
con el del servidor y deja de dibujar las del servidor, que serían un duplicado atrasado. Si predijo
un tiro que el servidor no hizo —recogiste un arma en ese mismo instante, por ejemplo—, lo borra en
cuanto el servidor confirma ese input sin el `shot`; si el servidor hizo uno que no se predijo, sus
balas se dibujan como las de cualquiera. Para esto la tupla de tu propio jugador trae, al final, los
ticks de cadencia y de recarga que faltan; a los demás no se les mandan.

Las **granadas** tenían el mismo atraso y tienen el mismo arreglo: salen de la mano
en el input en que apretás `G` y ruedan con la misma física que en el servidor
(`advanceGrenade`), así que rebotan igual y estallan en el mismo lugar —hay un test
que lo compara con 200 ms de ping—. El evento `throw` las empareja con las del
servidor, como `shot` a las balas. La explosión se dibuja al acabarse la mecha
acá; el daño lo sigue decidiendo el servidor.

Lo que decide si le pegaste sigue siendo el servidor. Tu bala se frena contra el jugador tal como lo
ves, pero la sangre y el número de daño llegan sólo con el evento `hit`. Para que los dos coincidan
está la compensación de lag (abajo).

Las balas de los demás también cambiaron. Se tomaban del último snapshot y se corrían 100 ms para
atrás, así que una recién disparada aparecía metida dentro del que la tiró y una que ya había
chocado desaparecía antes de llegar a la pared, con la chispa adelantada. Ahora viven en el mismo
reloj atrasado que los jugadores: nacen en el caño cuando el otro dispara en pantalla y se van
cuando llegan a la pared. El fogonazo, la chispa y la sangre de lo que no te toca se atrasan lo
mismo.

### La cola de inputs del servidor

El servidor procesa **cada input exactamente una vez y en orden** (`InputQueue`), igual que la
predicción. Antes sacaba uno por tick y, si no había ninguno, repetía el último. Eso tenía dos
problemas:

- **La cola sólo crecía.** El cliente manda 20 inputs por segundo y el servidor sacaba exactamente
  20, así que cada pico de la red que juntaba varios dejaba la cola más larga para siempre. Simulando
  5 minutos de WiFi normal, el input se procesaba 200 ms después de mandarse en vez de 56; con una
  WiFi mala, 400 ms. Tu movimiento no lo notaba —está predicho—, pero tus disparos, tus recogidas y
  lo que los demás ven de vos llegaban con todo ese atraso. Ahora, si hay más de uno esperando, se
  procesa uno extra en ese tick: con la misma WiFi queda en 106 y 117 ms.
- **Repetir inventaba pasos.** Se repetía pensando en paquetes perdidos, pero el WebSocket es TCP y
  no pierde nada: sólo los atrasa. Repetir hacía que el servidor diera un paso, o un disparo, que el
  cliente nunca dio. Ahora, si no llegó nada, el jugador espera.

Ponerse al día sólo recupera ticks en que no llegó nada. Si no, un cliente modificado que mandara
inputs al doble de ritmo caminaría al doble de velocidad; hay un test que lo comprueba.

### Compensación de lag

A los demás los ves atrasados: 100 ms de interpolación más lo que tarda el snapshot, y tu input
tarda otro tanto en llegar. Sumado, con 100 ms de ping, el que tenés en la mira ya está unos 250 ms
más adelante cuando el servidor procesa tu tiro. Si la bala se probara contra donde está ahora, le
pegarías a algo distinto de lo que viste: había que adelantar el tiro todo ese tiempo, y la bala que
en tu pantalla le pegaba no hacía daño.

Por eso cada input dice qué tick del servidor tenías en pantalla (`view`, con fracción, porque se
dibuja entre dos snapshots). El servidor guarda dónde estuvo cada jugador en los últimos ticks
(`PlayerState.trail`) y cada bala lleva cuánto rebobinar (`rewind`): a lo largo de todo el vuelo se
prueba contra los demás tal como los veía el que disparó (`pastPosition`). Lo que ves es lo que pasa.

El costo lo paga el que recibe: le pueden pegar un instante después de haberse metido detrás de una
pared, porque en la pantalla del otro todavía no se había metido. Por eso el rebobinado tiene tope,
`LAG_COMP_MAX_TICKS` (400 ms): alcanza para pings de hasta unos 200 ms, y mentir sobre el tick que
veías no da más que eso.

`lagComp.test.ts` lo prueba de punta a punta: un francotirador con 200 ms de ping le apunta a alguien
que corre de costado tal como lo ve en su pantalla. Sin compensar, el servidor cuenta 1 impacto de
40; compensando, 33. Los 7 que fallan salen justo cuando el otro da la vuelta, con la bala ya en el
aire, y el test comprueba que no falle ninguno más.

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

En GitHub corren solos en cada push (`.github/workflows/ci.yml`): typecheck, tests y
el humo sobre el build de producción. No despliegan nada.

Cubren lo que sostiene todo lo demás: que la simulación sea determinista (mismo estado + mismos
inputs = mismo resultado), que no se pueda atravesar un obstáculo, que las balas no atraviesen
jugadores a pesar de moverse 32 px por tick, la zona, y que la reconciliación converja con latencia
y con pérdida de paquetes.

`shots.test.ts` pone a jugar al cliente y al servidor de verdad —predicción, cola de inputs, `step`
y el codec del snapshot— con latencia y con jitter, y comprueba que cada bala del servidor ya
estuviera dibujada y por el mismo camino. Con el servidor repitiendo inputs como antes, falla.

Contra el servidor local (`npm run dev` en otra terminal) hay scripts con sockets de verdad:
`scripts/server-bots.mjs` (una partida de bots entera y el marcador de la sala),
`scripts/reconnect.mjs` (cortes de conexión), `scripts/marks.mjs` (las marcas le llegan sólo a
la pareja, y las parejas elegidas se respetan) y `scripts/kick.mjs` (echar del lobby).

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

### Si cambiás el protocolo

Desplegá **primero el servidor** y después el cliente, y mantené el servidor nuevo
compatible con clientes viejos (campos nuevos opcionales). Si un cambio no se puede
hacer compatible, subí `PROTOCOL_VERSION` en `constants.ts`: el cliente la manda al
conectarse y el servidor rechaza las que no coinciden con "Hay una versión nueva del
juego: recargá la página", en vez de dejar jugar a un cliente que va a fallar raro.

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
