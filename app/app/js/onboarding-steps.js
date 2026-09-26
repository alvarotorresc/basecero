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

// Progreso del asistente (stepsHtml): la Bienvenida (paso 0) no lo lleva; Cuentas, Ajustes y
// Periodo son 1, 2 y 3. «Categorías» (B-Onb-Categorias) no cuenta: desmarcar raíces es lógica
// nueva bloqueada (B-8), así que el paso no existe todavía.
export const ONB_STEP_COUNT = 3;
export const stepProgress = (step) => (step >= 1 ? { current: Math.min(step, ONB_STEP_COUNT), total: ONB_STEP_COUNT } : null);

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
