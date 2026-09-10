/** Registro de un solo puntero para que una pantalla pida un cambio de pestaña sin importar
 *  `main.js` (spec §6.4). `main.js` importa las cuatro pantallas de pestaña (inicio.js entre
 *  ellas) y ejecuta `boot()` al cargarse: si una pantalla importara `main.js` para llamar a
 *  `nav()` directamente, arrastraría ese `boot()` a su propio grafo de módulos por un ciclo que
 *  «funciona» solo por hoisting — frágil y nada evidente al leerlo. Tres líneas y un registro
 *  evitan el ciclo del todo, y de paso quedan bajo test sin DOM.
 *
 *  `main.js` llama a `setTabNavigator(nav)` justo después de definir `nav`; hasta que eso ocurra
 *  (o en Node, donde nunca ocurre) `goToTab` es un no-op silencioso, no un throw.
 *
 *  `opts` (Etiquetas, N11): viaja tal cual al `nav(tab, opts)` real — hoy solo lo usa
 *  screens/etiquetas.js para abrir Movimientos con su filtro puesto (goToTab("movimientos",
 *  { tagId })), sin que etiquetas.js tenga que importar main.js. */
let go = () => {};
export const setTabNavigator = (fn) => { go = fn; };
export const goToTab = (tab, opts) => go(tab, opts);
