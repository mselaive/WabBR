# Ideas para WabBR

Lo que se hizo en la rama `noche` (12 de octubre de 2026), lo que quedó en la lista
y por qué, y la pregunta de si vale la pena tener cuentas.

## Lo que se hizo

Todo en commits separados, para poder revisar, revertir o quedarse con una parte.
Ninguno está en `main`: un push a `main` despliega solo a wabbo.org.

| Commit | Qué | Cómo se probó |
|---|---|---|
| Espectador | Click o ←/→ para mirar a otro, `Espacio` cámara libre, el HUD muestra al que mirás, `Tab` funciona muerto | En el navegador, entrando a una partida de bots |
| Estadísticas | Daño hecho, puntería, tiempo vivo en la tabla final; premios de más daño, más kills y mejor puntería | Tests + una partida real de bots hasta el final |
| CI y `.nvmrc` | Typecheck, tests y humo en cada push; Node 22 fijado | Revisado; corre recién cuando se suba la rama |
| Reconexión | Un corte en partida te guarda el lugar 15 s; "Reconectando…" en vez de mandarte al menú | `scripts/reconnect.mjs` (incluye `--largo`) + navegador cortando la conexión |
| Paquetes aéreos | Dos por partida, caen dentro de la próxima zona con botín épico o legendario | Tests + capturas cayendo y en el piso |
| Versión de protocolo | "Hay una versión nueva: recargá la página" en vez de un juego que falla raro | Sockets contra el servidor local |
| HUD | Munición al instante (predicha) y ping visible | Navegador con 200 ms de lag: la munición baja a los 36 ms |
| Bots en el juego | "Agregar bot" en el lobby; lootean, se curan, pelean y encuentran el camino con A* | Tests + `scripts/server-bots.mjs` contra el servidor local |
| Arbustos | Esconden si no disparás; de cerca se te ve | Tests + captura escondido en un arbusto |
| Ballesta | Arma silenciosa: no te saca del arbusto | Tests + ícono revisado |
| Granadas predichas | Salen de la mano al apretar `G`, como las balas | Test cliente/servidor con 200 ms de ping |
| Sonido | Generado por código, posicional, `M` para silenciar | Niveles medidos sin parlantes; **no lo escuché**: probalo |
| Barriles | Explotan a balazos y se encadenan | Tests + captura del barril quemado |
| Ícono y test de echar | Favicon (el navegador pedía uno y daba 404) y el test de echar sin carrera | `scripts/kick.mjs` |
| Doble sombra | Donde se cruzaban las sombras de dos paredes quedaba el doble de oscuro | Capturas antes/después en el mismo momento |
| Revisión de código | Siete arreglos: recargar la página en partida te congelaba, dos pestañas se peleaban el asiento, la ballesta igual delataba dónde estabas, etc. | `scripts/reconnect.mjs` (falla sin el arreglo) |
| Ritmo de la zona | Con 2 jugadores las esperas duran la mitad; desde 8, lo normal | Test |
| Mira del francotirador | Con él en la mano la cámara se aleja un 40 % | Capturas con y sin mira |
| Granada de humo | `H` tira una nube que tapa la vista (no las balas) por 10 s; servidor y bots respetan lo que tapa | 11 tests (con control) + capturas |
| Marcador de la sala | "2/5 ganadas · 11 kills" al lado de cada nombre en el lobby, sumando las partidas de la noche | `scripts/server-bots.mjs` + captura |
| Bots con granadas | Tiran granadas (simulando el tiro), se escapan de las ajenas, no le disparan a un barril que tienen al lado y con poca vida tiran humo para irse a curar: el daño que se hacían solos bajó de 1536 a 109 en 8 partidas | Tests (con control) + medición en 8 partidas |
| Dúos | El host elige "Dúos" en el lobby: parejas al azar que aparecen juntas, no se lastiman, se ven siempre y ganan juntas | 7 tests (con control) + una partida de dúos en el navegador hasta el podio |
| Elegir pareja | En dúos, "Pareja" en cada fila del lobby; si dos se eligen, juegan juntos (un bot acepta solo) | Test de la simulación con 5 sorteos + `scripts/marks.mjs` |
| Caer y levantar | En dúos, a cero con el compañero en pie caés: te arrastrás, te desangrás en 30 s y él te levanta con E en 4 s. Los bots también | 7 tests + 8 partidas de dúos de bots (31 caídas, 3 levantadas) + captura del caído |
| Marcas para la pareja | `F` o click en el minimapa: rombo, flecha en el borde y anillo en el minimapa, sólo para tu compañero | `scripts/marks.mjs` (compañero sí, rival no) + captura |
| Cómo te mataron | Al morir: quién, con qué arma y cuánta vida y chaleco le quedaban | Test + captura |
| Dos revisiones más | Un muerto en dúos veía todo el mapa y se lo podía marcar al compañero (ahora ve con los ojos del vivo); el minimapa se tragaba los tiros; levantar se mezclaba con curarse y tirar granadas; un bot caído se alejaba mientras lo levantaban | Tests nuevos para cada uno |
| Caminos más baratos | Lo inalcanzable se descarta sin buscar: el peor tick con 16 bots bajó de 60 ms a 16 | Test + medición con 16 bots |
| Controles táctiles | Dos sticks flotantes, HUD tocable, Recargar/Tabla, aviso de girar el teléfono | Chrome emulando un teléfono con toques de dos dedos; **no probado en un teléfono real** |

### Para subirlo

- Revisar: `git log main..noche` (un commit por cosa) y probar con
  `PATH="$HOME/.local/node22/bin:$PATH" npm run dev`.
- El humo cambió el protocolo (versión 2): **primero el servidor**
  (`npm run deploy:server` o el push, si Cloudflare lo despliega solo) y después el
  cliente. Quien tenga la pestaña abierta durante el cambio ve "recargá la página".
- El sonido y los controles táctiles no los probé con oídos ni con un teléfono de
  verdad: son lo primero que conviene mirar.

## Segunda noche (14 de octubre de 2026), rama `noche2`

Arranca de la rama `invitacion` (el botón grande de "Entrar a la sala" con link), que tampoco
está en `main`. Protocolo **v3** (producción está en v2): al desplegar, primero el servidor.

### Cómo empieza y cómo termina una partida

| Qué | Detalle | Cómo se probó |
|---|---|---|
| Paracaídas | Se empieza cayendo: 8 s planeando para elegir dónde, E para bajar ya; en el aire nadie te pega; los bots eligen una caja. Opción del host (prendida) | 9 tests (con mutaciones) + predicción con ping + capturas |
| Segunda oportunidad | (Warzone) Opción del host: el que muere temprano vuelve una vez a los 8 s, cayendo en paracaídas y lejos de los rivales; título "Gato" | 11 tests (con mutaciones) + partida en el navegador |
| Mapa nuevo cada partida | Opción del host: 12 mapas con nombre, probados uno por uno; cambia en el lobby, donde se ve el que toca | Un test por mapa + bots del servidor en otro mapa + predicción sin correcciones |
| La próxima arranca sola | Al volver, los que jugaron siguen listos y la siguiente arranca a los 12 s, salvo que alguien se desmarque | Partida por socket |
| Títulos para todos | Cada uno se lleva uno: "Carnicero", "Ciego: no dio una bala", "Gato", "Adivino", "Turista"... | Tests + partidas |
| Repetición de tu muerte | Si te mata alguien, los últimos 3 s en cámara lenta; click o Espacio la saltea | Test de la copia + partida en el navegador |
| Apuestas de espectador | Muerto, apostás quién gana (no por tu pareja); ✓/✗ al final y en el marcador de la sala | Test + partida en el navegador |
| Récords y logros | Récords en el navegador; 11 logros que desbloquean gorros que todos ven | Tests + capturas |
| "¡Quedan dos!" | Aviso cuando quedan los dos últimos (si arrancaron más de dos) | 2 tests + partida |

### Cosas en el mapa

| Qué | Detalle | Cómo se probó |
|---|---|---|
| Tirolesas | 6 por mapa: desde un poste, caminando hacia el cable, te lleva al otro (podés disparar) | 3 tests + los 12 mapas ida y vuelta + predicción con ping + captura |
| Hongos saltarines | 10 por mapa: te lanzan por encima de lo que haya; al caer, siempre en un lugar libre | Tests en los 12 mapas, 32 direcciones + predicción con ping |
| Gallina dorada | (Llama de Fortnite) Aparece con la primera zona, escapa; cazada suelta botín de caja dorada | 9 tests + captura |
| Fogatas | 6 por mapa, curan de a poco al que está tranquilo | 4 tests + captura |
| Caja dorada | 1 por partida, con botín de paquete aéreo; no sale en el minimapa | 3 tests + captura |
| Bombardeo | (PUBG) Círculo rojo, sirena y bombas; bajo techo no alcanza | 5 tests + captura |
| De noche, con tormenta | Ves poco; fuego, explosiones y fogonazos iluminan; relámpagos cada ~20 s | Test + capturas |

### Armas y objetos

| Qué | Detalle | Cómo se probó |
|---|---|---|
| Lanzacohetes | Sólo legendario y rarísimo (paquetes aéreos) | 7 tests + capturas |
| Revólver y ametralladora | Dos armas más | Tests + íconos |
| Molotov (`J`) | Charco de fuego 6 s | 7 tests + captura |
| Minas (`K`) | Se tiran como granada, se arman donde se frenan; los rivales las ven sólo de cerca; los bots rodean las que ven | 6 tests + captura |
| Mochila | La mitad más de curaciones y granadas; se ve puesta | 5 tests + captura |
| Radar | (UAV de Warzone) 10 s marcando a los rivales cercanos en el minimapa de tu equipo | 5 tests + capturas |
| Bengala | Pide un paquete aéreo a tu lado, que todos ven venir | Test + captura |
| Recoger al pasar | Curaciones y granadas se juntan solas si entran enteras | 3 tests |
| Reglas especiales | Normal / Todo legendario / Francotiradores / Relámpago / Caos / Escopetas | Tests + partidas de 16 bots en Caos |

### Información y sonido

| Qué | Detalle | Cómo se probó |
|---|---|---|
| Minimapa sin radar | No muestra rivales fuera de la pantalla (lo de los puntitos desde el arbusto) | Captura |
| El más buscado | (Warzone) El que domina aparece en el mapa de todos; matarlo te cura | 6 tests |
| Campeón de la sala | El que domina la noche aparece siempre en el minimapa | Script de bots |
| Tiros que se oyen | Un tiro detrás de una pared suena apagado y marca la dirección (rumbo y distancia aproximados) | Partidas por socket |
| Pasos que se oyen | El rival que corre cerca y no se ve se delata; caminar es silencioso | Partida por socket |
| Rachas, frases rápidas, bots que festejan | "¡Doble kill!"; 6-9 frases; los bots a veces dicen "¡GG!" | Scripts + capturas |
| Latido | Con menos de 30 de vida | Typecheck |

### Lobby, teléfono y otros

| Qué | Detalle | Cómo se probó |
|---|---|---|
| Opciones en una fila | Mapa nuevo, segunda oportunidad, noche y paracaídas como interruptores | Capturas en PC y teléfono |
| Lo mejor de la noche + resumen | Quién ganó más, mató más y apostó mejor; "Copiar resumen" para el grupo | Tests + capturas |
| Chat del lobby y de los muertos | Una línea para la sala fuera de partida; en partida, los muertos entre ellos | Test del filtro + dos navegadores + muerto escribiendo |
| Elegir tu color | Tocar tu cuadradito pasa al siguiente color libre; se recuerda | Prueba en el navegador |
| Dificultad de los bots | Fácil / Normal / Difícil | Test + captura |
| Tríos | Equipos de tres, por sorteo | 2 tests + partida de tríos por socket |
| Teléfono | Ayuda de puntería con el stick; botón Sonido; botones de a dos y sin filas vacías | Tests + capturas emulando un teléfono |
| Volumen | Control en el menú | Captura |
| Practicar con bots | Un botón en el menú: sala propia con 5 bots que arranca sola | Prueba en el navegador |
| Novedades | En el menú, lo nuevo de esta noche | Captura |
| Ayuda del menú | "Qué hay en el mapa" y las teclas nuevas | Captura |

### Revisiones

Siete revisiones independientes esta noche (subagentes que leen el diff y prueban en una copia aparte). Lo
más importante que encontraron y quedó arreglado: el que esperaba la segunda oportunidad veía a
todos; los bots le tiraban al que caía en paracaídas y se volaban con la gallina a cohetazos; el
tiro oído ubicaba al tirador a 80 px; el seq de la partida anterior hacía saltar la predicción al
empezar; un tick sin input en el aire adelantaba la caída; "¡Quedan dos!" salía al empezar un 2
contra 2; los que se iban en partida aparecían en los resultados siguientes; el que dejaba de
mandar inputs (la pestaña de fondo) quedaba colgado en el paracaídas, invulnerable, y podía ganar
así; los bots iban y venían por las tirolesas sin querer; la repetición no se podía saltear (y
las teclas apretadas durante ella se disparaban al volver); en tríos de 4 quedaba 3 contra 1; el
chat de los muertos dejaba entrar al que tenía un compañero vivo (le podía marcar lo que le
contaba alguien que ve todo). Cada arreglo tiene su
test, y la mayoría se probó a la inversa (romper el arreglo y ver que el test falla).

## Ideas que quedaron, en el orden en que las haría

1. **Killcam desde los ojos del otro.** La repetición de esta noche es desde tus ojos (lo que te
   llegó). Verla desde el que te mató pide que el servidor guarde historia por jugador.
2. **Bots que usan lo nuevo.** Ya rodean las minas que ven, pero no las tiran ni buscan
   tirolesas u hongos a propósito. Es lo que más haría que una partida contra bots se parezca a
   una entre amigos.
3. **Puestos de compra** (Warzone): plata por kills y cajas, para comprar chaleco, radar o la
   vuelta de tu pareja. Es un sistema grande; vale la pena si las partidas se sienten repetidas.
4. **Cascos.** Sin tiros a la cabeza (es vista de arriba) no tienen un efecto que no se pise con
   el chaleco.

Una limitación que quedó: muerto en tríos, el servidor te manda lo que ve uno de tus dos
compañeros (el que está en pie); si mirás al otro, no ves a los rivales que sólo ve él.

Para decidir: el paracaídas quedó **prendido** de entrada y la segunda oportunidad **apagada**.
Si en la prueba con amigos el paracaídas se siente largo, son 8 s (`AIR_TICKS`).

Y uno que descarté: **cuerpo a cuerpo**. La munición es infinita (se recarga siempre) y nunca te
quedás sin arma.

### Un detalle del mapa

En una casa del sur (la de la caja 2, en x≈1105, y≈1727) un barril quedó parado en el
paso del tabique interior, encima de la pared. Deja un hueco de 31 px: un jugador
pasa justo (necesita 24), pero es incómodo. El mobiliario respeta 52 px contra las
paredes de afuera pero no contra el tabique. Lo encontré porque los bots no llegaban
a esa caja; no lo toqué porque cambiar el generador mueve el mapa de todos.

## ¿Cuentas para guardar stats y cosméticos?

**Sí, pero livianas, y en dos pasos.** Una cuenta con contraseña sería mucho trabajo
para un juego de amigos y espanta al que entra por primera vez con un link.

### Paso 1: perfil anónimo (lo recomendado)

- La primera vez, el navegador genera una clave larga al azar y la guarda en
  `localStorage` (no en `sessionStorage` como el token de reconexión: esta tiene
  que durar). La manda al conectarse.
- Al terminar cada partida, el servidor suma al perfil de esa clave: partidas,
  victorias, kills, daño, puntería, mejor puesto. Con eso alcanza para una pantalla
  de "mis estadísticas" y para niveles por experiencia.
- **Cosméticos por logros, no por plata**: gorros, colores de remera, rastro de las
  balas. Se dibujan como la remera, en capas sobre el muñeco, así que agregar uno es
  un dibujo más. El servidor sólo tiene que validar que el cosmético elegido esté
  desbloqueado en ese perfil (y para un juego de amigos ni siquiera es grave si no).
- Dónde guardarlo: **Cloudflare D1** (una base SQLite administrada) o un Durable
  Object de perfiles. Las escrituras son una por jugador por partida: el plan
  gratuito sobra por lejos.
- El punto débil: si borrás los datos del navegador o cambiás de dispositivo,
  perdés el perfil.

### Paso 2: vincular con Discord o Google (cuando haga falta)

Para recuperar el perfil en otro dispositivo, un botón "Vincular con Discord" (que
para un grupo de amigos es lo más natural) asocia la clave anónima a una cuenta.
Diseñando bien el paso 1 —la clave es el perfil, la cuenta externa es un dato más
del perfil— esto se agrega después sin migrar nada. Con cuentas reales también se
vuelve real el bloqueo de jugadores, que hoy es por nombre y se esquiva cambiándolo.

### Lo que no haría

- **Contraseñas propias**: es seguridad que hay que mantener (hashes,
  recuperación, filtraciones) sin ningún beneficio sobre Discord o Google.
- **Cosméticos pagos**, por ahora: obligan a cuentas reales, pagos, impuestos y
  términos y condiciones. Si algún día, recién después del paso 2.
- **Ranking competitivo**: con un grupo chico no tiene con quién compararse; los
  premios por partida y el historial personal dan esa satisfacción sin el estrés.

### Lo que costaría

El paso 1 es un día o dos: la tabla, el guardado al final de la partida, la
pantalla de perfil y un par de cosméticos. Necesita crear la base en Cloudflare, que
es lo único que yo no pude hacer desde acá porque requiere tu cuenta.

## Fuentes

- surviv.io: [descripción oficial en la App Store](https://apps.apple.com/app/id1401727934)
  (paquetes aéreos con el botín más raro) y
  [TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/Survivio) (arbustos que
  esconden pero no frenan balas).
- Ritmo con pocos jugadores:
  [reseña de The Culling 2](https://www.pressreader.com/ireland/bray-people/20180718/283227328883579)
  (mapa demasiado grande para la cantidad de gente) y
  [Warzone al bajar de 150 a 100 jugadores](https://www.techradar.com/gaming/warzone-developers-explain-decision-to-move-from-150-player-to-100-player-matches-for-an-optimal-and-fun-experience).
- Cuentas de invitado y vinculación:
  [Brawlhalla](https://brawlhalla.wiki.gg/wiki/Cross_Inventory) (progreso e inventario
  separados al vincular) y
  [Hive](https://developers.withhive.com/?p=13311) (cuándo pedir que se vincule).
