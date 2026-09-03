/** Frontera entre «error que el usuario puede leer» y «incidencia técnica».
 *
 *  Hasta ahora cada banner pintaba `e.message` crudo, así que un fallo de SQLite se le enseñaba al
 *  usuario tal cual («SQLITE_CONSTRAINT: CHECK constraint failed…») mientras que los mensajes que
 *  SÍ estaban escritos para él (los guards de repo.js, n26.js y backup-crypto.js, ya traducidos)
 *  viajaban en el mismo `Error` sin forma de distinguirlos. UserError es esa marca.
 *
 *  Regla: se lanza UserError cuando el mensaje ya está traducido Y escrito para una persona. Todo
 *  lo demás —errores de la base, bugs, fallos del Worker— sale por userMessage como el mensaje
 *  genérico, con el error entero en console.error (la ÚNICA salida técnica de la app; mismo
 *  criterio que main.js#boot).
 *
 *  Módulo PURO: solo importa el t de i18n (también puro). Sin DOM, sin BD. */
import { t } from "./i18n/index.js";

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
    // Marcador duplicado a propósito: userMessage acepta también un Error corriente con
    // userFacing=true, para no obligar a que TODA capa futura importe esta clase.
    this.userFacing = true;
  }
}

/** Texto que se le enseña al usuario por un error cualquiera. Nunca lanza: acepta lo que sea
 *  (incluido null, un string o un objeto que no es Error) porque un catch no controla lo que
 *  recibe. */
export function userMessage(e) {
  if (e instanceof UserError || e?.userFacing === true) return e.message;
  console.error(e);
  return t("errors.generic");
}
