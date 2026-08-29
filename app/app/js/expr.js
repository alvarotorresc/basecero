/** Evaluador puro de la calculadora de cinta del teclado de Registro (Task 3): SIN imports
 *  de DOM/db/repo — así los tests de node pueden importarlo directo, sin worker ni sqlite
 *  de por medio (mismo motivo que prevision.js/onboarding-steps.js). Autocontenido: no
 *  depende ni de format.js.
 *
 *  SEMÁNTICA (ruling 1 del plan): el teclado es una calculadora de cinta izquierda-a-derecha,
 *  SIN precedencia y SIN tecla "=". El estado del teclado es {acc, op, raw}: `acc` es lo ya
 *  confirmado, `op` es el operador pendiente y `raw` es el operando que se está tecleando.
 *  Cada vez que se pulsa un operador, el teclado "pliega" el operando actual dentro del
 *  acumulador llamando a `evalExpr(acc, op, operando)` — esta función es exactamente ese
 *  paso de plegado, nada más. El caso común (solo dígitos, sin operador de por medio) debe
 *  dar EXACTAMENTE el mismo resultado que hoy: por eso `acc === null` (aún no hay nada que
 *  plegar) devuelve el operando tal cual, sin tocarlo.
 *
 *  CÉNTIMOS ENTEROS: todos los importes viajan en céntimos (1250 = 12,50 €), igual que el
 *  resto de la app. Sumar/restar céntimos es directo. Multiplicar y dividir NO lo son: si
 *  ambos operandos están en céntimos (×100 respecto al valor real), multiplicarlos sin más
 *  desplaza el resultado ×100 de más (1250×300 = «12,50 × 3,00», no «12,50 × 3») — por eso
 *  ‘×’ divide entre 100 al final para deshacer ese desplazamiento extra. Dividir, al
 *  contrario, se queda ×100 corto — por eso ‘÷’ multiplica por 100 al final. Ambas casillas
 *  se redondean con Math.round (redondeo "half up": Math.round(-312.5) da -312, no -313 —
 *  es el comportamiento nativo de JS, no un bug de este módulo).
 *
 *  TOKENS DE OPERADOR: el contrato es EXACTAMENTE los símbolos que renderiza el teclado y
 *  que Task 3 guarda en `state.op` — "+", "−" (U+2212 MINUS SIGN, no el guion "-"), "×"
 *  (U+00D7) y "÷" (U+00F7) — así Task 3 puede pasar `state.op` a `evalExpr` sin ninguna capa
 *  de traducción intermedia. También se aceptan como alias tolerados "-", "*", "/" (ASCII)
 *  por si algún llamador teclea el guion normal en vez del signo menos Unicode — un typo de
 *  codificación fácil de cometer y difícil de ver a simple vista — pero el contrato oficial
 *  son los cuatro símbolos Unicode de arriba; no uses los alias como API en código nuevo.
 *
 *  CASOS SIN OPERACIÓN: operador desconocido o `null` con acc ya presente → no hay nada que
 *  aplicar, se devuelve el operando (mismo criterio que "acc === null": nada que plegar
 *  todavía). Dividir por cero es un no-op deliberado — el teclado no tiene estado de error,
 *  así que ‘÷’ entre 0 simplemente no cambia el acumulador. Cualquier entrada o resultado no
 *  finito (NaN/±Infinity) se sanea (mismo criterio Number.isFinite que parseCentsRaw de
 *  format.js): nunca se devuelve NaN ni Infinity. */

// Sanea un valor en céntimos: si no es un número finito, se trata como 0 (mismo criterio
// que parseCentsRaw de format.js — nunca se propaga NaN/Infinity).
const safeCents = (v) => (Number.isFinite(v) ? v : 0);

/** Aplica UNA operación de la cinta: pliega `operandCents` dentro de `accCents` según `op`,
 *  y devuelve el nuevo acumulador (en céntimos enteros). Es el paso que el teclado llama al
 *  pulsar un operador (y de nuevo al guardar, para plegar el operando pendiente).
 *
 *  - `accCents === null` (o no finito): todavía no hay nada plegado — devuelve el operando
 *    tal cual. Es el camino "solo dígitos, sin operador" = paridad con el comportamiento
 *    histórico (state.cents = parseCentsRaw(raw)).
 *  - `op` desconocido o `null` (con acc ya presente): no hay operación que aplicar — mismo
 *    criterio, se devuelve el operando.
 *  - `"+"` / `"−"` (o alias `"-"`): suma / resta directa en céntimos.
 *  - `"×"` (o alias `"*"`): `Math.round(acc * operand / 100)`.
 *  - `"÷"` (o alias `"/"`): `operand === 0 ? acc : Math.round(acc * 100 / operand)`
 *    (división por cero = no-op, devuelve el acumulador intacto).
 */
export function evalExpr(accCents, op, operandCents) {
  const operand = safeCents(operandCents);
  if (accCents == null || !Number.isFinite(accCents)) return operand;
  const acc = accCents;

  let result;
  switch (op) {
    case "+":
      result = acc + operand;
      break;
    case "−":
    case "-":
      result = acc - operand;
      break;
    case "×":
    case "*":
      result = Math.round((acc * operand) / 100);
      break;
    case "÷":
    case "/":
      result = operand === 0 ? acc : Math.round((acc * 100) / operand);
      break;
    default:
      result = operand; // op desconocido/null: nada que aplicar todavía
  }
  return Number.isFinite(result) ? result : acc;
}

/** Pliega el operando PENDIENTE (el que Task 3 está tecleando ahora mismo, o acaba de dejar de
 *  teclear) dentro del acumulador. Es el mismo pliegue que hace `evalExpr`, pero con UNA
 *  distinción extra que `evalExpr` no puede hacer por sí solo porque solo ve céntimos, nunca el
 *  texto tecleado: `hasOperand` dice si YA se ha tecleado algo para el operando actual
 *  (`state.raw !== ""`), no si su valor en céntimos da cero. "" (nada tecleado desde el último
 *  operador) y "0" (un cero tecleado a propósito) deben comportarse distinto — plegar "" a
 *  través de un ‘×’/‘÷’ pendiente NO debe poner a cero el acumulador (el mismo peligro que el
 *  handoff de Task 2 señaló para el guardado, aquí generalizado también al pulsar/cambiar de
 *  operador en caliente), pero plegar un "0" tecleado de verdad SÍ debe aplicar la operación con
 *  0. Por eso esta función recibe `hasOperand` ya decidido en vez de inferirlo de
 *  `operandCents === 0` (que no basta para distinguir ambos casos) — parsear `raw` a céntimos y
 *  decidir `hasOperand` sigue siendo trabajo del llamador (registro.js); aquí solo llega el
 *  booleano ya resuelto, así el módulo se queda sin imports.
 *
 *  - `accCents == null` (o no finito, nada plegado todavía): sin operando tecleado (`hasOperand`
 *    false) → 0 (paridad con una pantalla en blanco); con operando tecleado → el operando tal
 *    cual saneado (mismo camino de identidad que `evalExpr` con acc null — el caso "solo
 *    dígitos, sin operador" de Task 3).
 *  - `accCents` presente y SIN operando tecleado: no hay nada que aplicar todavía — se devuelve
 *    el acumulador intacto (evita el ‘×’/‘÷’ fantasma al pulsar dos operadores seguidos).
 *  - `accCents` presente y CON operando tecleado: `evalExpr(accCents, op, operandCents)`, el
 *    pliegue normal. */
export function foldPending(accCents, op, operandCents, hasOperand) {
  const operand = safeCents(operandCents);
  if (accCents == null || !Number.isFinite(accCents)) return hasOperand ? operand : 0;
  if (!hasOperand) return accCents;
  return evalExpr(accCents, op, operand);
}
