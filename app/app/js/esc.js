// Escapado HTML compartido por toda la app. Hasta esta PR, `escHtml`/`escAttr` vivían copiados a
// mano en 18 ficheros (16 pantallas + recibo.js + modal.js + ui.js) — el mismo patrón repetido en
// cada uno, con pequeñas diferencias entre copias: algunas versiones de `escHtml` escapaban
// también `>` (recibo.js, modal.js) y otras no (el resto); ninguna copia escapaba `'`. Este
// módulo es el superconjunto seguro de todas ellas: escapa siempre `& < > " '`, así que sirve
// tanto para texto (`escHtml`) como para el interior de un atributo entre comillas dobles o
// simples (`escAttr`) sin tener que recordar qué caracteres cubre cada una. Escapar de más no
// cambia lo que se ve en pantalla — el navegador decodifica `&#39;`/`&gt;` al mismo carácter que
// el original, ya sea en un nodo de texto o en un atributo — así que unificar aquí es un cambio
// de implementación, no de comportamiento visible.
const ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeAll = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);

/** Para insertar valores dinámicos en un nodo de texto/HTML (p.ej. dentro de un `innerHTML`). */
export const escHtml = escapeAll;

/** Para insertar valores dinámicos dentro de un atributo HTML entre comillas. */
export const escAttr = escapeAll;
