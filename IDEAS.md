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

## Ideas que quedaron, en el orden en que las haría

1. **Zona según cuántos juegan.** Con 3 o 4 personas en un mapa pensado para 16, se
   camina mucho antes de encontrarse. Acortar las esperas de la zona cuando hay pocos
   (por ejemplo a la mitad con 4 o menos) es cambiar un número en `ZONE_PHASES`.
   Ahora que hay bots para completar la sala pesa menos, por eso no lo toqué.
2. **Cuerpo a cuerpo.** Hoy, sin balas y sin arma, no hay nada que hacer. Una sartén
   o un cuchillo de corto alcance le da algo al que perdió su arma, y en surviv.io
   es de lo más querido.
3. **Miras.** Que el francotirador aleje un poco la cámara (y que el servidor amplíe
   lo que te manda en la misma medida). Hoy tiene más alcance que la pantalla.
4. **Pings en el minimapa.** Con amigos por voz igual sirve marcar "acá hay alguien"
   o "voy para el paquete". Es un mensaje chico y un dibujo en el minimapa.
5. **Granada de humo.** Tapa la vista por unos segundos. Encaja con la línea de vista
   que ya existe, pero hay que meter obstáculos que cambian con el tiempo en
   `hasLineOfSight`, y eso toca al servidor, al cliente y a los bots.
6. **Cascos y mochilas.** Más capas de equipo para lootear. Más contenido que
   sistema: vale la pena si las partidas se sienten cortas de cosas para encontrar.
7. **Killcam.** Ver los últimos segundos desde los ojos del que te mató. Lindo pero
   caro: hay que guardar historia de snapshots por jugador.
8. **Controles táctiles.** Hoy es teclado y mouse. Si alguien quiere jugar desde el
   celular es todo un trabajo aparte (dos joysticks, botones, HUD distinto).

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
