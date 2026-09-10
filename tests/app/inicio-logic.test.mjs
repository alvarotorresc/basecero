import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextAccountId, daysLeftOfPeriod, dailyAllowanceCents, foldedMovements, groupByDay,
  savingsSentence, streakDays, daysSinceLastEntry, nextDueDateIso, huchaMessage, HUCHA,
} from "../../app/app/js/inicio-logic.js";

const ACC = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("nextAccountId: cicla y vuelve al principio", () => {
  assert.equal(nextAccountId(ACC, "a"), "b");
  assert.equal(nextAccountId(ACC, "c"), "a");
  assert.equal(nextAccountId(ACC, "zz"), "a");   // id desconocido: empieza el ciclo
  assert.equal(nextAccountId([{ id: "a" }], "a"), "a");
  assert.equal(nextAccountId([], "a"), null);
});

// Hoja de datos de SISTEMA §5: periodo del 1 sep, hoy 9 sep, día 9 de 30.
test("daysLeftOfPeriod: 30 − 9 = 21, el mismo «21 días» del artboard", () => {
  assert.equal(daysLeftOfPeriod("2026-09-01", "2026-09-09"), 21);
  assert.equal(daysLeftOfPeriod("2026-09-01", "2026-09-30"), 0);   // último día
  assert.equal(daysLeftOfPeriod("2026-09-01", "2026-10-05"), -5);  // periodo alargado
});

test("dailyAllowanceCents: (35280 − 13689) / 22 = 981 céntimos (+1 día porque hoy cuenta)", () => {
  assert.equal(dailyAllowanceCents(35280, 13689, "2026-09-01", "2026-09-09"), 981);
});

test("dailyAllowanceCents: día 29 de 30 con 200 € de margen → 100 € (quedan hoy y mañana)", () => {
  assert.equal(dailyAllowanceCents(20000, 0, "2026-09-01", "2026-09-29"), 10000);
});

test("dailyAllowanceCents: el último día no divide por cero y da todo lo que queda", () => {
  assert.equal(dailyAllowanceCents(35280, 13689, "2026-09-01", "2026-09-30"), 21591);
  assert.equal(dailyAllowanceCents(35280, 13689, "2026-09-01", "2026-10-05"), 21591);
});

test("dailyAllowanceCents: sin margen devuelve negativo (lo capa la pantalla, no el cálculo)", () => {
  assert.ok(dailyAllowanceCents(1000, 5000, "2026-09-01", "2026-09-09") < 0);
});

const row = (date, id) => ({ id, date, type: "expense", amount_cents: 100 });

test("foldedMovements: todos los de hoy cuando son 5", () => {
  const rows = [row("2026-09-09","1"),row("2026-09-09","2"),row("2026-09-09","3"),
                row("2026-09-09","4"),row("2026-09-09","5"),row("2026-09-08","6")];
  assert.deepEqual(foldedMovements(rows, "2026-09-09").map((r) => r.id), ["1","2","3","4","5"]);
});

test("foldedMovements: 2 hoy + 1 de ayer para llegar al mínimo de 3 (el artboard)", () => {
  const rows = [row("2026-09-09","1"),row("2026-09-09","2"),row("2026-09-08","3"),row("2026-09-07","4")];
  assert.deepEqual(foldedMovements(rows, "2026-09-09").map((r) => r.id), ["1","2","3"]);
});

test("foldedMovements: sin nada hoy, los 3 más recientes; con menos de 3 en total, todos", () => {
  const rows = [row("2026-09-08","1"),row("2026-09-07","2"),row("2026-09-06","3"),row("2026-09-05","4")];
  assert.deepEqual(foldedMovements(rows, "2026-09-09").map((r) => r.id), ["1","2","3"]);
  assert.equal(foldedMovements([row("2026-09-08","1")], "2026-09-09").length, 1);
  assert.deepEqual(foldedMovements([], "2026-09-09"), []);
});

test("savingsSentence: 1.002,80 de 1.850,00 → 54 %", () => {
  const s = savingsSentence(185000, 84720);
  assert.equal(s.kind, "saves");
  assert.equal(Math.round(s.ratio * 100), 54);
  assert.equal(savingsSentence(100000, 120000).kind, "overspends");
  assert.equal(savingsSentence(0, 5000), null);
});

test("streakDays: cuenta hacia atrás desde hoy o desde ayer, y se corta en el hueco", () => {
  assert.equal(streakDays(["2026-09-09","2026-09-08","2026-09-07"], "2026-09-09"), 3);
  assert.equal(streakDays(["2026-09-08","2026-09-07"], "2026-09-09"), 2);   // hoy aún sin apuntar
  assert.equal(streakDays(["2026-09-07","2026-09-06"], "2026-09-09"), 0);   // se rompió ayer
  assert.equal(streakDays(["2026-09-09","2026-09-07"], "2026-09-09"), 1);
  assert.equal(streakDays([], "2026-09-09"), 0);
});

test("daysSinceLastEntry", () => {
  assert.equal(daysSinceLastEntry(["2026-09-06"], "2026-09-09"), 3);
  assert.equal(daysSinceLastEntry(["2026-09-09"], "2026-09-09"), 0);
  assert.equal(daysSinceLastEntry([], "2026-09-09"), null);
});

// Revisión de código: una fecha futura (reloj del dispositivo adelantado, o un apunte mal
// tecleado) no debe apagar la regla 3 de la hucha silenciando el "sin apuntar" con un apunte que
// en realidad todavía no ha pasado.
test("daysSinceLastEntry: ignora las fechas futuras (> todayIso)", () => {
  assert.equal(daysSinceLastEntry(["2026-10-01", "2026-09-06"], "2026-09-09"), 3);
  assert.equal(daysSinceLastEntry(["2026-10-01"], "2026-09-09"), null);
});

const rule = (o) => ({ frequency: "monthly", due_day: 14, due_month: null, is_active: 1, ...o });

test("nextDueDateIso: mensual este mes y el que viene", () => {
  assert.equal(nextDueDateIso(rule({}), "2026-09-09"), "2026-09-14");
  assert.equal(nextDueDateIso(rule({}), "2026-09-20"), "2026-10-14");
  assert.equal(nextDueDateIso(rule({}), "2026-09-14"), "2026-09-14");   // hoy cuenta
});

test("nextDueDateIso: el día 31 se acota al largo del mes", () => {
  assert.equal(nextDueDateIso(rule({ due_day: 31 }), "2026-02-05"), "2026-02-28");
});

test("nextDueDateIso: semanal se trata como mensual (RULING de prevision.js:5-8)", () => {
  assert.equal(nextDueDateIso(rule({ frequency: "weekly" }), "2026-09-09"), "2026-09-14");
});

test("nextDueDateIso: trimestral, anual y sin due_day", () => {
  assert.equal(nextDueDateIso(rule({ frequency: "quarterly", due_month: 3, due_day: 5 }), "2026-09-09"), "2026-12-05");
  assert.equal(nextDueDateIso(rule({ frequency: "yearly", due_month: 3, due_day: 5 }), "2026-09-09"), "2027-03-05");
  assert.equal(nextDueDateIso(rule({ due_day: null }), "2026-09-09"), null);
});

const CTX = {
  renewals: [{ id: "r1", name: "Spotify Duo", amountCents: 1299, dueDateIso: "2026-09-14" }],
  categories: [{ id: "cat-ocio", name: "Ocio", pct: 112 }],
  daysSinceLastEntry: 5,
  daysLeftOfPeriod: 2,
  todayIso: "2026-09-09",
  dismissed: new Set(),
};

test("huchaMessage: la renovación gana a todo lo demás", () => {
  const m = huchaMessage(CTX);
  assert.equal(m.kind, "renewal");
  assert.equal(m.key, "renewal:r1");
  assert.equal(m.params.name, "Spotify Duo");
});

test("huchaMessage: el orden de prioridad completo, quitando candidatos", () => {
  assert.equal(huchaMessage({ ...CTX, renewals: [] }).kind, "limit");
  assert.equal(huchaMessage({ ...CTX, renewals: [], categories: [] }).kind, "idle");
  assert.equal(huchaMessage({ ...CTX, renewals: [], categories: [], daysSinceLastEntry: 0 }).kind, "periodEnd");
  assert.equal(huchaMessage({ ...CTX, renewals: [], categories: [], daysSinceLastEntry: 0, daysLeftOfPeriod: 20 }), null);
});

// DESVIACIÓN respecto al plan: el plan escribía estas dos fechas como "2026-09-17"/"2026-09-18",
// pero con HUCHA.RENEWAL_DAYS=7 y todayIso 2026-09-09 esas dos caen a 8 y 9 días — ninguna dispara
// "renewal", contradiciendo el resultado esperado. Se desplazan un día antes (7 y 8 días) para que
// el umbral "≤ 7" de la spec §8 quede realmente probado en su frontera exacta.
test("huchaMessage: umbrales exactos", () => {
  assert.equal(huchaMessage({ ...CTX, renewals: [{ id: "r", name: "X", amountCents: 1, dueDateIso: "2026-09-16" }] }).kind, "renewal");
  assert.equal(huchaMessage({ ...CTX, renewals: [{ id: "r", name: "X", amountCents: 1, dueDateIso: "2026-09-17" }] }).kind, "limit");
  assert.equal(huchaMessage({ ...CTX, renewals: [], categories: [{ id: "c", name: "Y", pct: HUCHA.LIMIT_PCT }] }).kind, "limit");
  assert.equal(huchaMessage({ ...CTX, renewals: [], categories: [{ id: "c", name: "Y", pct: 89 }] }).kind, "idle");
});

test("huchaMessage: «Ahora no» salta ese candidato y sigue con el siguiente", () => {
  const m = huchaMessage({ ...CTX, dismissed: new Set(["renewal:r1"]) });
  assert.equal(m.kind, "limit");
});

test("huchaMessage: periodo pasado de largo dispara la variante «hoy»", () => {
  const m = huchaMessage({ ...CTX, renewals: [], categories: [], daysSinceLastEntry: 0, daysLeftOfPeriod: -4 });
  assert.equal(m.kind, "periodEnd");
  assert.equal(m.params.n, 0);
});

test("groupByDay: bloques en el orden de llegada", () => {
  const g = groupByDay([row("2026-09-09","1"),row("2026-09-09","2"),row("2026-09-08","3")]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].rows.map((r) => r.id), ["1","2"]);
});
