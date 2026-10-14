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
está en `main`.

| Commit | Qué | Cómo se probó |
|---|---|---|
| Bombardeo | La "zona roja" de PUBG: círculo marcado, aviso con sirena y bombas 5 s después; bajo techo no te alcanza | 5 tests + captura del círculo |
| Lanzacohetes | Arma rara, sólo legendaria y sólo en ~1 de cada 8 paquetes; estalla donde pega, nunca mata de un tiro | 7 tests + capturas del cohete con su estela |
| El más buscado | (De Warzone) Sólo si domina (4+ kills y 2 de ventaja) aparece en el mapa de todos cada 5 s; matarlo te cura entero | 6 tests |
| Recoger al pasar | Curaciones y granadas se juntan solas si entran enteras | 3 tests |
| Récords | En el navegador: partidas, ganadas, récord de kills, tiro más largo; "¡Récord personal!" en el resultado | 4 tests + capturas |
| Títulos para todos | Cada jugador se lleva uno: "Carnicero", "Ciego: no dio una bala", "Pacifista", "Turista"... | 5 tests + partida real |
| Caja dorada | 1 por partida, con botín de paquete aéreo; brilla pero no sale en el minimapa | 3 tests + captura |
| Fogatas | 6 en el mapa, curan de a poco al que está tranquilo | 4 tests + captura |
| Campeón de la sala | El que domina la noche (3+ ganadas y 2 de ventaja) aparece siempre en el minimapa de todos | `scripts/server-bots.mjs` |
| Minimapa sin radar | Ya no muestra rivales fuera de la pantalla (lo de los puntitos desde el arbusto) | Captura |
| Rachas | "¡Doble kill!", "¡Triple kill!", "¡Imparable!" | Captura del cartel |
| Frases rápidas | 6-9: ¡GG!, Jajaja, ¡Cuidado!, Perdón, sólo para los que te ven | `scripts/marks.mjs` + captura |
| Dificultad de los bots | Fácil / Normal / Difícil en el lobby: reacción, puntería y granadas | Test + captura del lobby |
| Revólver y ametralladora | Dos armas más: la pistola pesada y la de 60 balas | Tests de todas las armas + íconos revisados |
| De noche | Opción del host: ves poco alrededor; fogatas, fuego, explosiones y fogonazos iluminan | Capturas |
| Reglas especiales | Normal / Todo legendario / Francotiradores / Relámpago / Caos, las elige el host | 4 tests + captura del lobby + 3 partidas de 16 bots en Caos |
| Logros y gorros | 9 logros que desbloquean gorros que todos ven, sin cuentas | 4 tests + capturas del menú y del gorro en partida |
| Hongos saltarines | 10 en el mapa: te lanzan por encima de lo que haya, predicho en el cliente | 6 tests (incluye predicción con ping) + capturas |
| Molotov | `J`: charco de fuego 6 s que quema al que lo pisa | 7 tests + captura |
| Mapa nuevo cada partida | Opción del host: 12 mapas con nombre, el de siempre es el primero; cambia en el lobby | Un test por mapa (casas, apariciones, cajas, saltos) + bots del servidor en otro mapa + predicción sin correcciones |
| Segunda oportunidad | (De Warzone) Opción del host: el que muere temprano vuelve una vez a los 8 s, lejos de los rivales; título "Gato" | 9 tests (mutaciones incluidas) + partida en el navegador |
| Opciones en una fila | Mapa nuevo, segunda oportunidad y noche como interruptores: el lobby entra en el teléfono | Capturas en PC y teléfono |
| Gallina dorada | (Llama de Fortnite) Aparece con la primera zona, escapa corriendo, cazada suelta botín de caja dorada; pista en el minimapa; los bots la cazan | 7 tests + captura en partida |
| Radar | (UAV de Warzone) Objeto raro: al levantarlo, 10 s marcando cada 2 s a los rivales cercanos en el minimapa de tu equipo; avisa al detectado | 5 tests + capturas del ícono y del minimapa |
| Bots que festejan | Después de una kill, a veces "¡GG!" o "Jajaja" (sólo lo ve quien los ve) | Partida de bots por socket |
| Apuestas de espectador | Muerto, apostás quién gana; al final ✓/✗, aciertos en el marcador de la sala y título "Adivino" | Test del título + partida en el navegador (apuesta y resultado) |
| Mochila | Objeto que deja cargar la mitad más de curaciones y granadas; se ve sobre el muñeco | 5 tests + captura del muñeco |
| Tiros que se oyen | (Sonidos visualizados de Fortnite) Un tiro detrás de una pared suena apagado y marca la dirección en pantalla, con el lugar redondeado | Partida por socket: 21 tiros oídos, todos en la grilla y a menos de 1150 px |
| Volumen y silencio en el teléfono | Control de volumen en el menú; botón Sonido en los controles táctiles (no hay M) | Capturas + prueba con pantalla táctil |
| Lo mejor de la noche | En el lobby: más ganadas, más kills y mejor apostador de la sala | Captura después de una partida |
| Cuarta revisión | El que esperaba la segunda oportunidad veía a todos; bots volándose con la gallina a cohetazos; el aviso de vuelta decía dónde; cortarse no la hacía perder; cohete a la gallina estallando donde estaba; la vuelta se deslizaba | Tests nuevos con mutaciones + partida en el navegador |

## Ideas que quedaron, en el orden en que las haría

La zona según cuántos juegan, la mira, el humo, los dúos con sus marcas y los
controles táctiles ya están (arriba). De la lista anterior quedaron:

1. **Cascos.** La mochila ya está; un casco sería otra capa de equipo, pero sin tiros a la
   cabeza (es vista de arriba) no tiene un efecto que no se pise con el chaleco.
2. **Killcam.** Ver los últimos segundos desde los ojos del que te mató. Ya al
   morir la cámara sigue al que te mató, que da casi lo mismo; la repetición de
   verdad pide guardar historia de snapshots por jugador.

Y uno que descarté: **cuerpo a cuerpo**. Lo había anotado para "el que se queda sin
balas", pero acá la munición es infinita (se recarga siempre) y nunca te quedás
sin arma: arrancás con la pistola y al morir es cuando la soltás.

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
