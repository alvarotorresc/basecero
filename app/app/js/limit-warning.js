/** Aviso de límite de la categoría elegida en Registro (Registro v2 §6). Módulo PURO — sin DOM ni
 *  BD, sin importar i18n — mismo criterio que category-spend.js#budgetStatus, que aquí NO se
 *  reutiliza a propósito: allí el sujeto es el gasto acumulado del periodo; aquí es «lo que queda
 *  después de este gasto», y son dos preguntas distintas.
 *
 *  Gating de tipo: esta función NO recibe `tipo`. Es el llamante (registro.js) quien decide
 *  cuándo tiene sentido preguntar — un ingreso o una transferencia no gastan contra ningún límite,
 *  así que Registro solo llama a `limitWarning` para `tipo === "expense"`. Meterlo aquí obligaría
 *  al módulo a conocer la lista de tipos que "gastan", una decisión de pantalla, no de aritmética. */
import { rootOf } from "./category-colors.js";

/** Umbral del nivel ámbar: por debajo del 10 % del límite tras este gasto. Exportado para que
 *  cambiarlo (o desactivarlo con `Infinity`, §13.1 de la spec) sea una línea. */
export const WARN_FRACTION = 0.10;

/** `categoryId` es la HOJA elegida; el límite y el gasto viven en la RAÍZ (`rootOf`).
 *  `spentByRoot` es el mapa {rootId: céntimos} de SQL.spentByRootCategory, y `budgetByCategory` el
 *  de category-spend.js#budgetMap sobre SQL.budgetsOfPeriod — la MISMA aritmética que «Gasto por
 *  categoría»: aquí no se recalcula nada, se consulta.
 *
 *  `amountCents` es MI PARTE del gasto en curso, no el ticket: es lo que cuenta contra el límite
 *  (MY_AMOUNT, sql.js). Un compartido al 50 % de 45,20 € gasta 22,60 € de la categoría — es
 *  responsabilidad de quien llama pasar ya el importe repartido.
 *
 *  Devuelve `null` si no hay categoría, si su raíz no tiene límite (>0), o el objeto de estado.
 *  Nunca lanza. */
export function limitWarning({ categoryId, amountCents, byId, spentByRoot, budgetByCategory }) {
  if (!categoryId) return null;
  const rootId = rootOf(categoryId, byId);
  const limitCents = budgetByCategory?.[rootId] ?? 0;
  if (!(limitCents > 0)) return null;
  const spentCents = spentByRoot?.[rootId] ?? 0;
  const remainingCents = limitCents - spentCents;
  const remainingAfterCents = remainingCents - (amountCents ?? 0);
  const level = remainingAfterCents < 0 ? "over" : remainingAfterCents < limitCents * WARN_FRACTION ? "warn" : "ok";
  return {
    rootId,
    rootName: byId?.[rootId]?.name ?? "",
    limitCents,
    spentCents,
    remainingCents,
    remainingAfterCents,
    level,
  };
}
