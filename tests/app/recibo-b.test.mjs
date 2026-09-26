// Recibo del sistema B (B-Recibo): lo que S2 añade a ticketHtml sobre recibo.test.mjs — título y
// tipo, ficha de categoría, muestra de cuenta, sello por familia y el segundo grupo de líneas del
// periodo. Datos inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ticketHtml } from "../../app/app/js/recibo.js";

const BASE = {
  dateTime: "19:30",
  title: "Bar Pepe",
  subtitle: "Gasto",
  badge: { fam: "res", icon: "res", label: "Restauración › Bares y cafés" },
  lines: [{ label: "Cuenta", value: "Cuenta corriente", fam: "tra" }, { label: "Fecha", value: "Hoy" }],
  total: { main: "18,", cents: "50", suffix: " €" },
  stampDate: "13 sep 2026",
  stampFam: "res",
  labels: { brand: "BaseCero", stamp: "Guardado", total: "Total" },
};
const count = (html, re) => (html.match(re) || []).length;

test("ticketHtml B: el total va en UN Display (una sola .disp-value) y sin tokens --paper", () => {
  const html = ticketHtml(BASE);
  assert.equal(count(html, /\bdisp-value(?![-\w])/g), 1);
  assert.ok(html.includes("18,50 €"));
  assert.ok(!html.includes("--paper"));
});

test("ticketHtml B: título, tipo, ficha de 28 con familia, muestra de cuenta y sello de su familia", () => {
  const html = ticketHtml(BASE);
  assert.match(html, /recibo-title">Bar Pepe</);
  assert.match(html, /recibo-sub">Gasto</);
  assert.match(html, /class="ent-badge fam-res"/);
  assert.match(html, /recibo-swatch fam-tra/);
  assert.match(html, /class="recibo-stamp fam-res"/);
});

test("ticketHtml B: sin familia, el sello va sin clase de familia y no hay ficha si no hay categoría", () => {
  const html = ticketHtml({ ...BASE, badge: null, stampFam: null });
  assert.match(html, /class="recibo-stamp"/);
  assert.ok(!html.includes("ent-badge"));
});

test("ticketHtml B: periodLines es un segundo grupo con su perforación; vacío, no se pinta", () => {
  const con = ticketHtml({ ...BASE, periodLines: [{ label: "Quedan en septiembre", value: "539,79 €", num: true }, { label: "Hoy puedes gastar", value: "31,75 €", num: true }] });
  assert.equal(count(con, /recibo-value num/g), 2, "los importes van en la mono");
  assert.equal(count(con, /recibo-perf/g), 2);
  assert.ok(con.includes("Quedan en septiembre") && con.includes("31,75 €"));
  const sin = ticketHtml({ ...BASE, periodLines: [{ label: "Quedan en septiembre", value: "" }] });
  assert.equal(count(sin, /recibo-perf/g), 1);
  assert.ok(!sin.includes("Quedan en septiembre"));
});
