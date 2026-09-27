// Lógica pura del onboarding de primera ejecución (PR F). SIN imports de db/repo — así los
// tests de node pueden importarla directo, sin worker ni sqlite de por medio (mismo motivo
// que prevision.js y category-order.js). Importa parseCentsRaw de format.js: sigue siendo
// puro (format.js tampoco importa db/repo). i18n/index.js también es puro (sin DOM/db/repo),
// así que t() es igual de seguro de importar aquí: en Node, sin initI18n() de por medio, el
// idioma por defecto del módulo es "es" — el assert literal en español de
// tests/app/onboarding.test.mjs:18 sigue viendo el texto castellano.
import { parseCentsRaw } from "./format.js";
import { t } from "./i18n/index.js";

// Gate del onboarding: cero periodos. Una BD virgen no tiene ninguno; un usuario a mitad de
// onboarding (creó cuentas pero aún no abrió periodo) debe RETOMARLO al reabrir; y una BD
// real siempre tiene periodos (abiertos o cerrados), así que jamás lo ve.
export const needsOnboarding = (periods) => periods.length === 0;

// El paso Cuentas no se puede abandonar sin al menos una cuenta creada.
export const canLeaveAccounts = (accountCount) => accountCount >= 1;

// Las cuatro baldosas de B-Onb-Cuentas (S13). `id` es lo que elige la baldosa; `type` es el tipo
// de BD (CHECK de accounts.type) y `fam` la familia con la que se pinta (account-colors.js). La
// Hucha NO es un tipo nuevo: es una savings con familia imp guardada en meta.account_style
// (D-impl-2, repo.setAccountFamily); las otras tres llevan la familia por defecto de su tipo.
export const ACCOUNT_KINDS = [
  { id: "checking", type: "checking", fam: "tra", icon: "card" },
  { id: "savings", type: "savings", fam: "ali", icon: "bank" },
  { id: "hucha", type: "savings", fam: "imp", icon: "piggy" },
  { id: "liability", type: "liability", fam: "coc", icon: "debt" },
];
const HUCHA = ACCOUNT_KINDS.find((k) => k.id === "hucha");

// Baldosa a la que corresponde una cuenta ya creada, con su familia final (familyForAccount):
// una savings pintada de imp es una Hucha; el resto, su propio tipo.
export const accountKindOf = (account, fam) =>
  (account.type === HUCHA.type && fam === HUCHA.fam ? HUCHA.id : account.type);

// Pasos del asistente (B-8): la Bienvenida (0) no lleva progreso; Cuentas, Ajustes, Categorías y
// Periodo son 1, 2, 3 y 4 — «3 de 4» en B-Onb-Categorias.
export const ONB_STEP = { welcome: 0, accounts: 1, prefs: 2, categories: 3, period: 4 };
export const ONB_STEP_COUNT = 4;
export const stepProgress = (step) => (step >= 1 ? { current: Math.min(step, ONB_STEP_COUNT), total: ONB_STEP_COUNT } : null);

// ---- Paso «Categorías» (B-8, B-Onb-Categorias): las raíces de gasto semilla, marcadas; desmarcar
// = archivar (recuperable en Categorías). El estado vive en la BD (is_archived), no en un borrador:
// si se cierra la pestaña a mitad, el paso se retoma con lo ya guardado.

/** Raíces de gasto vivas (listCategoriesAdmin: todas, archivadas incluidas) en su orden, con cuántas
 *  subcategorías vivas tienen (archivadas incluidas: desmarcar archiva la raíz y sus hijas en
 *  cascada, y volver a marcar las recupera) y si están marcadas (no archivadas). */
export function onbCategoryRoots(rows) {
  const live = rows.filter((c) => !c.deleted);
  return live
    .filter((c) => c.flow === "expense" && !c.parent_id)
    .sort((a, b) => a.display_order - b.display_order)
    .map((c) => ({
      id: c.id,
      name: c.name,
      subCount: live.filter((h) => h.parent_id === c.id).length,
      checked: !c.is_archived,
    }));
}

/** Sin ninguna categoría de gasto no hay dónde apuntar un gasto: al menos una marcada. */
export const canLeaveCategories = (checkedCount) => checkedCount >= 1;

/** Qué cambia al salir del paso: `archive`, las raíces marcadas en la BD que el usuario desmarcó;
 *  `restore`, las archivadas en la BD que volvió a marcar. `roots` sale de is_archived al cargar el
 *  paso (onbCategoryRoots), no de un estado en memoria: con 0 periodos nada más que este paso puede
 *  haber archivado, así que tras recargar la pestaña a mitad volver a marcar también recupera. */
export function categoryArchiveDiff(roots, checkedIds) {
  return {
    archive: roots.filter((r) => r.checked && !checkedIds.has(r.id)).map((r) => r.id),
    restore: roots.filter((r) => !r.checked && checkedIds.has(r.id)).map((r) => r.id),
  };
}

// Borrador del form de cuenta del paso 2 → cuenta lista para createAccount, o {error}.
// "liability" guarda el saldo en negativo aunque se teclee en positivo: es lo que debes.
// `type` admite también "hucha" (la baldosa): sale como savings + `fam: "imp"`, que la pantalla
// guarda con setAccountFamily tras crearla. Solo la Hucha lleva `fam`.
export function accountDraft({ name, type, raw }) {
  if (!name.trim()) return { error: t("onboarding.account.nameRequired") };
  const parsed = parseCentsRaw(raw);
  const hucha = type === HUCHA.id;
  const dbType = hucha ? HUCHA.type : type;
  const draft = { name: name.trim(), type: dbType, openingBalanceCents: dbType === "liability" ? -Math.abs(parsed) : parsed };
  return hucha ? { ...draft, fam: HUCHA.fam } : draft;
}
