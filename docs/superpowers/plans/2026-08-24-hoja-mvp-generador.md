# BaseCero — Hoja MVP (generador + Apps Script) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generar el `BaseCero.xlsx` completo (8 tablas de datos + 3 dashboards, validaciones, semillas y fórmulas) desde código Python, más el Apps Script que automatiza el registro y el import del CSV de N26 en Google Sheets.

**Architecture:** Un paquete Python (`generator/`) define el contrato de datos como estructuras (`contract.py`, `seeds.py`) y lo materializa en un `.xlsx` con openpyxl (`build_xlsx.py`); este generador es el embrión del motor de export de la futura app. La lógica de Google Apps Script vive en `apps_script/` separada en funciones puras testeables con Node (`pure.js`) y pegamento GAS (`main.js`).

**Tech Stack:** Python 3.14 + openpyxl + pytest (venv en `generator/.venv`); Node 22 (`node --test`, sin dependencias); Google Apps Script.

**Spec:** `docs/specs/2026-08-24-basecero-hoja-calculo-design.md`

## Global Constraints

- Nombres de tablas y columnas EXACTOS del spec §4; enums EXACTOS del spec §4.1 (más `rule_types = [expense, income, transfer]`, extensión de implementación para validar `recurring_rules.type`).
- Convenciones del spec §3: ids ULID; fechas ISO `YYYY-MM-DD`; timestamps ISO 8601; importes positivos salvo `adjustment`; booleanos `TRUE`/`FALSE`; columnas `_*` calculadas e ignoradas por el motor; `created_at`, `updated_at`, `deleted` al final de toda tabla, ocultas; fila 1 = cabeceras, datos desde fila 2.
- Filas con fórmula precargada en `transactions` (`_my_amount`, `_sara_amount`): filas 2–2001 (constante `PREFILLED_ROWS = 2000`).
- Dashboards: pestañas en español, color verde `2E7D32`; datos en gris `9E9E9E`; SOLO fórmulas compatibles Excel+Google Sheets (SUMIFS/SUMPRODUCT/INDEX/MATCH/COUNTIF/IF/IFS/REPT) — nunca QUERY.
- Columnas helper de entrada en `transactions` (`_account`, `_counter_account`, `_category`, `_rule`): desplegables por nombre; los `*_id` reales los resuelve Apps Script (decisión de implementación amparada por la convención `_` del spec §3.8).
- `external_id` = SHA-256 hex truncado a 16 chars de `fecha|céntimos|contraparte|referencia` (spec §6).
- Regla MVP de refunds en dashboards: solo los `refund` con `ref_id` vacío restan gasto de su categoría; los vinculados son entrada de caja (la app implementará la regla completa del spec §4.5).
- Python: solo stdlib + openpyxl; tests con pytest. JS: solo Node stdlib; sintaxis compatible GAS (sin `import`, export condicional vía `module.exports`).
- Commits frecuentes; mensajes `feat:`/`test:`/`docs:` terminados con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
generator/
├── requirements.txt              # openpyxl, pytest
├── basecero_generator/
│   ├── __init__.py
│   ├── contract.py               # tablas, columnas, enums (fuente única del contrato)
│   ├── ulid_gen.py               # ULID en Python (para semillas)
│   ├── seeds.py                  # cuentas y taxonomía de categorías semilla
│   ├── build_xlsx.py             # construye el workbook: datos + dashboards
│   └── cli.py                    # python -m basecero_generator.cli dist/BaseCero.xlsx
└── tests/
    ├── test_contract.py
    ├── test_ulid.py
    ├── test_seeds.py
    ├── test_build_datos.py
    └── test_build_dashboards.py
apps_script/
├── pure.js                       # ULID JS, hash, parser CSV N26, matching, picker→id
├── main.js                       # menú, onEdit instalable, import N26 (pegamento GAS)
├── fixtures/n26_sample.csv
└── tests/pure.test.mjs
README.md                         # puesta en marcha en Google Sheets + checklist QA
dist/                             # BaseCero.xlsx generado (gitignored)
```

---

### Task 1: Entorno + contrato de datos (`contract.py`)

**Files:**
- Create: `generator/requirements.txt`, `generator/basecero_generator/__init__.py`, `generator/basecero_generator/contract.py`
- Test: `generator/tests/test_contract.py`
- Create: `.gitignore`

**Interfaces:**
- Produces: `ENUMS: dict[str, list[str]]`; `SYSTEM_COLUMNS = ["created_at","updated_at","deleted"]`; `TABLES: dict[str, list[Column]]` con `Column = namedtuple("Column", "name kind")` y `kind` ∈ `{"id","text","date","number","bool","calc"}` ∪ `"enum:<enum>"` ∪ `"ref:<tabla>"`; `DATA_SHEET_ORDER: list[str]` (orden de pestañas). `meta` NO está en `TABLES` (estructura especial, la escribe build_xlsx).

- [ ] **Step 1: Crear venv, instalar deps y esqueleto**

```bash
cd ~/Documents/apps/BaseCero
printf 'openpyxl>=3.1\npytest>=8\n' > generator/requirements.txt  # (mkdir -p generator/basecero_generator generator/tests antes)
python3 -m venv generator/.venv
generator/.venv/bin/pip install -r generator/requirements.txt
touch generator/basecero_generator/__init__.py generator/tests/__init__.py
printf 'dist/\ngenerator/.venv/\n__pycache__/\n*.pyc\n' > .gitignore
```

- [ ] **Step 2: Test que fija el contrato (falla)**

`generator/tests/test_contract.py`:

```python
from basecero_generator import contract as c

def cols(t):
    return [col.name for col in c.TABLES[t]]

def test_tablas_y_orden():
    assert c.DATA_SHEET_ORDER == ["meta", "accounts", "categories", "periods",
        "transactions", "recurring_rules", "goals", "budgets"]
    assert set(c.TABLES) == set(c.DATA_SHEET_ORDER) - {"meta"}

def test_enums_del_spec():
    assert c.ENUMS["transaction_types"] == ["expense","income","transfer","refund","adjustment"]
    assert c.ENUMS["account_types"] == ["checking","savings","liability"]
    assert c.ENUMS["need_types"] == ["need","want","savings"]
    assert c.ENUMS["goal_types"] == ["emergency_fund","savings_target","spending_cap","savings_rate","provision"]
    assert c.ENUMS["rule_types"] == ["expense","income","transfer"]
    assert c.ENUMS["tx_status"] == ["pending","reconciled"]
    assert c.ENUMS["period_status"] == ["open","closed"]
    assert c.ENUMS["frequencies"] == ["weekly","monthly","quarterly","yearly"]
    assert c.ENUMS["flow_types"] == ["expense","income"]

def test_transactions_columnas_exactas():
    assert cols("transactions") == ["id","date","period_id","type","amount",
        "_account","account_id","_counter_account","counter_account_id",
        "_category","category_id","merchant","note","is_shared","share_pct_override",
        "_my_amount","_sara_amount","settled","ref_id","_rule","rule_id",
        "external_id","status","created_at","updated_at","deleted"]

def test_toda_tabla_termina_en_system_y_empieza_por_id():
    for t in c.TABLES:
        assert cols(t)[0] == "id" and c.TABLES[t][0].kind == "id"
        assert cols(t)[-3:] == c.SYSTEM_COLUMNS

def test_refs_apuntan_a_tablas_existentes():
    for t, columns in c.TABLES.items():
        for col in columns:
            if col.kind.startswith("ref:"):
                assert col.kind.split(":")[1] in c.TABLES
            if col.kind.startswith("enum:"):
                assert col.kind.split(":")[1] in c.ENUMS
```

- [ ] **Step 3: Ejecutar y ver el fallo**

Run: `cd ~/Documents/apps/BaseCero/generator && .venv/bin/python -m pytest tests/test_contract.py -q`
Expected: FAIL (`No module named 'basecero_generator.contract'`)

- [ ] **Step 4: Implementar `contract.py`**

```python
from collections import namedtuple

Column = namedtuple("Column", "name kind")

SYSTEM_COLUMNS = ["created_at", "updated_at", "deleted"]

ENUMS = {
    "transaction_types": ["expense", "income", "transfer", "refund", "adjustment"],
    "account_types": ["checking", "savings", "liability"],
    "flow_types": ["expense", "income"],
    "need_types": ["need", "want", "savings"],
    "period_status": ["open", "closed"],
    "frequencies": ["weekly", "monthly", "quarterly", "yearly"],
    "goal_types": ["emergency_fund", "savings_target", "spending_cap", "savings_rate", "provision"],
    "tx_status": ["pending", "reconciled"],
    "rule_types": ["expense", "income", "transfer"],
}

def _sys():
    return [Column("created_at", "text"), Column("updated_at", "text"), Column("deleted", "bool")]

TABLES = {
    "accounts": [Column("id", "id"), Column("name", "text"),
        Column("type", "enum:account_types"), Column("opening_balance", "number"),
        Column("display_order", "number"), Column("is_archived", "bool")] + _sys(),
    "categories": [Column("id", "id"), Column("name", "text"),
        Column("parent_id", "ref:categories"), Column("flow", "enum:flow_types"),
        Column("need_type", "enum:need_types"), Column("display_order", "number"),
        Column("is_archived", "bool"), Column("_picker", "calc")] + _sys(),
    "periods": [Column("id", "id"), Column("name", "text"), Column("start_date", "date"),
        Column("end_date", "date"), Column("status", "enum:period_status"),
        Column("my_share_pct", "number"), Column("notes", "text")] + _sys(),
    "transactions": [Column("id", "id"), Column("date", "date"),
        Column("period_id", "ref:periods"), Column("type", "enum:transaction_types"),
        Column("amount", "number"), Column("_account", "calc"),
        Column("account_id", "ref:accounts"), Column("_counter_account", "calc"),
        Column("counter_account_id", "ref:accounts"), Column("_category", "calc"),
        Column("category_id", "ref:categories"), Column("merchant", "text"),
        Column("note", "text"), Column("is_shared", "bool"),
        Column("share_pct_override", "number"), Column("_my_amount", "calc"),
        Column("_sara_amount", "calc"), Column("settled", "bool"),
        Column("ref_id", "ref:transactions"), Column("_rule", "calc"),
        Column("rule_id", "ref:recurring_rules"), Column("external_id", "text"),
        Column("status", "enum:tx_status")] + _sys(),
    "recurring_rules": [Column("id", "id"), Column("name", "text"),
        Column("type", "enum:rule_types"), Column("amount", "number"),
        Column("category_id", "ref:categories"), Column("account_id", "ref:accounts"),
        Column("counter_account_id", "ref:accounts"),
        Column("frequency", "enum:frequencies"), Column("due_day", "number"),
        Column("due_month", "number"), Column("is_shared", "bool"),
        Column("is_active", "bool")] + _sys(),
    "goals": [Column("id", "id"), Column("name", "text"), Column("type", "enum:goal_types"),
        Column("target_amount", "number"), Column("target_months", "number"),
        Column("target_pct", "number"), Column("target_date", "date"),
        Column("account_id", "ref:accounts"), Column("category_id", "ref:categories"),
        Column("is_active", "bool")] + _sys(),
    "budgets": [Column("id", "id"), Column("period_id", "ref:periods"),
        Column("category_id", "ref:categories"), Column("amount", "number")] + _sys(),
}

DATA_SHEET_ORDER = ["meta", "accounts", "categories", "periods", "transactions",
                    "recurring_rules", "goals", "budgets"]

META_KEYS = {"schema_version": "1", "currency": "EUR", "created_with": "basecero-sheets-mvp"}
PREFILLED_ROWS = 2000
COLOR_DATA, COLOR_DASH = "9E9E9E", "2E7D32"
```

Nota: `categories._picker` es la columna calculada de nombres elegibles ("Casa → Luz") que alimenta el desplegable `_category`; queda antes de las de sistema (mismo criterio que `_my_amount` en transactions: las `_` van donde son útiles, las de sistema SIEMPRE al final).

- [ ] **Step 5: Verificar en verde**

Run: `.venv/bin/python -m pytest tests/test_contract.py -q`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add generator .gitignore && git commit -m "feat: contrato de datos del generador (tablas, columnas, enums)"
```

### Task 2: ULID (`ulid_gen.py`) + semillas (`seeds.py`)

**Files:**
- Create: `generator/basecero_generator/ulid_gen.py`, `generator/basecero_generator/seeds.py`
- Test: `generator/tests/test_ulid.py`, `generator/tests/test_seeds.py`

**Interfaces:**
- Produces: `ulid_gen.ulid() -> str` (26 chars Crockford base32). `seeds.SEED_ACCOUNTS: list[dict]` (claves = columnas de `accounts` sin `_`/system, más `id`). `seeds.SEED_CATEGORIES: list[dict]` (ids estables legibles tipo `cat-casa`, `cat-casa-luz` — los seeds usan slugs fijos en vez de ULID para que los tests y las fórmulas del dashboard sean deterministas; el contrato solo exige unicidad e inmutabilidad, y la app generará ULID para filas nuevas). `seeds.NOW_ISO: str`.

- [ ] **Step 1: Tests que fallan**

`generator/tests/test_ulid.py`:

```python
import re
from basecero_generator.ulid_gen import ulid

def test_formato_crockford_26():
    u = ulid()
    assert re.fullmatch(r"[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}", u)

def test_unicos_y_crecientes_en_el_tiempo():
    us = [ulid() for _ in range(200)]
    assert len(set(us)) == 200
    assert us[0][:10] <= us[-1][:10]  # prefijo temporal no decreciente
```

`generator/tests/test_seeds.py`:

```python
from basecero_generator import seeds
from basecero_generator.contract import ENUMS

def test_cuentas_semilla():
    names = [a["name"] for a in seeds.SEED_ACCOUNTS]
    assert names == ["N26", "Revolut", "Trade Republic", "Préstamo coche"]
    prestamo = seeds.SEED_ACCOUNTS[-1]
    assert prestamo["type"] == "liability" and prestamo["opening_balance"] <= 0
    assert all(a["type"] in ENUMS["account_types"] for a in seeds.SEED_ACCOUNTS)

def test_categorias_semilla_integridad():
    by_id = {c["id"]: c for c in seeds.SEED_CATEGORIES}
    assert len(by_id) == len(seeds.SEED_CATEGORIES)  # ids únicos
    for c in seeds.SEED_CATEGORIES:
        if c["parent_id"]:
            parent = by_id[c["parent_id"]]
            assert parent["parent_id"] == ""      # máximo 2 niveles
            assert parent["flow"] == c["flow"]
        assert c["flow"] in ENUMS["flow_types"]
        assert c["need_type"] in ENUMS["need_types"] or c["need_type"] == ""

def test_taxonomia_del_spec():
    names = {c["name"] for c in seeds.SEED_CATEGORIES}
    for esperado in ["Casa", "Luz", "Supermercado", "Comida a domicilio", "Préstamo",
                     "Seguro", "Gimnasio", "Nómina", "Intereses de ahorro", "Otros gastos"]:
        assert esperado in names
    hojas_income = [c for c in seeds.SEED_CATEGORIES if c["flow"] == "income"]
    assert len(hojas_income) == 3
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `.venv/bin/python -m pytest tests/test_ulid.py tests/test_seeds.py -q`
Expected: FAIL (módulos no existen)

- [ ] **Step 3: Implementar `ulid_gen.py`**

```python
import os, time

_B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

def _enc(value, length):
    out = []
    for _ in range(length):
        out.append(_B32[value & 31])
        value >>= 5
    return "".join(reversed(out))

def ulid(now_ms=None):
    t = int(time.time() * 1000) if now_ms is None else now_ms
    rand = int.from_bytes(os.urandom(10), "big")
    return _enc(t, 10) + _enc(rand, 16)
```

- [ ] **Step 4: Implementar `seeds.py`**

```python
from datetime import datetime, timezone

NOW_ISO = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def _acc(id_, name, type_, opening, order):
    return {"id": id_, "name": name, "type": type_, "opening_balance": opening,
            "display_order": order, "is_archived": False}

SEED_ACCOUNTS = [
    _acc("acc-n26", "N26", "checking", 0, 1),
    _acc("acc-revolut", "Revolut", "savings", 0, 2),
    _acc("acc-traderepublic", "Trade Republic", "savings", 0, 3),
    _acc("acc-prestamo-coche", "Préstamo coche", "liability", 0, 4),
]
# opening_balance a 0: el usuario pone los saldos reales el día que estrena la hoja.

def _cat(id_, name, parent, flow, need, order):
    return {"id": id_, "name": name, "parent_id": parent, "flow": flow,
            "need_type": need, "display_order": order, "is_archived": False}

_T = [  # (slug, nombre, hijos [(slug, nombre, need_type)], need_type_por_defecto)
    ("casa", "Casa", [("alquiler", "Alquiler/Hipoteca", "need"), ("luz", "Luz", "need"),
        ("agua", "Agua", "need"), ("gas", "Gas", "need"), ("internet", "Internet", "need"),
        ("hogar", "Hogar", "need")], "need"),
    ("alimentacion", "Alimentación", [("supermercado", "Supermercado", "need"),
        ("domicilio", "Comida a domicilio", "want")], "need"),
    ("restauracion", "Restauración", [("restaurantes", "Restaurantes", "want"),
        ("bares", "Bares y cafés", "want")], "want"),
    ("transporte", "Transporte", [("gasolina", "Gasolina", "need"),
        ("publico", "Transporte público", "need"), ("parking", "Parking/peajes", "want"),
        ("taxi", "Taxi/VTC", "want")], "need"),
    ("coche", "Coche", [("prestamo", "Préstamo", "need"), ("seguro", "Seguro", "need"),
        ("mantenimiento", "Mantenimiento/ITV", "need")], "need"),
    ("salud", "Salud", [("farmacia", "Farmacia", "need"), ("medico", "Médico", "need"),
        ("gimnasio", "Gimnasio", "want")], "need"),
    ("suscripciones", "Suscripciones", [("streaming", "Streaming", "want"),
        ("software", "Software", "want"), ("otras-subs", "Otras", "want")], "want"),
    ("ocio", "Ocio", [("planes", "Planes y eventos", "want"), ("viajes", "Viajes", "want"),
        ("hobbies", "Hobbies", "want")], "want"),
    ("ropa", "Ropa y cuidado personal", [], "want"),
    ("regalos", "Regalos y donaciones", [], "want"),
    ("impuestos", "Impuestos y tasas", [], "need"),
    ("otros", "Otros gastos", [], "want"),
]

SEED_CATEGORIES = []
_order = 0
for slug, nombre, hijos, need_def in _T:
    _order += 10
    SEED_CATEGORIES.append(_cat(f"cat-{slug}", nombre, "", "expense", need_def, _order))
    for i, (hslug, hnombre, hneed) in enumerate(hijos, 1):
        SEED_CATEGORIES.append(_cat(f"cat-{slug}-{hslug}", hnombre, f"cat-{slug}",
                                    "expense", hneed, _order + i))
for i, (slug, nombre) in enumerate([("nomina", "Nómina"), ("puntuales", "Ingresos puntuales"),
                                    ("intereses", "Intereses de ahorro")], 1):
    SEED_CATEGORIES.append(_cat(f"cat-{slug}", nombre, "", "income", "", 900 + i * 10))
```

- [ ] **Step 5: Verificar en verde**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add generator && git commit -m "feat: ULID y datos semilla (cuentas y taxonomía)"
```

### Task 3: `build_xlsx.py` — pestañas de datos

**Files:**
- Create: `generator/basecero_generator/build_xlsx.py`
- Test: `generator/tests/test_build_datos.py`

**Interfaces:**
- Consumes: `contract.TABLES/ENUMS/META_KEYS/DATA_SHEET_ORDER/PREFILLED_ROWS/COLOR_DATA/COLOR_DASH`, `seeds.SEED_ACCOUNTS/SEED_CATEGORIES/NOW_ISO`.
- Produces: `build(path: str) -> None` (escribe el .xlsx completo); helpers reutilizados por Task 4: `col(table, name) -> str` (letra de columna), `tr(name) -> str` (rango `transactions!$X$2:$X$2001`), `saldo_expr(id_expr: str) -> str` (expresión de saldo de una cuenta).

- [ ] **Step 1: Test que fija la estructura de datos (falla)**

`generator/tests/test_build_datos.py`:

```python
import pytest
from openpyxl import load_workbook
from basecero_generator import contract as c
from basecero_generator.build_xlsx import build, col

@pytest.fixture(scope="module")
def wb(tmp_path_factory):
    p = tmp_path_factory.mktemp("out") / "BaseCero.xlsx"
    build(str(p))
    return load_workbook(str(p))

def test_pestanas_de_datos_en_orden(wb):
    assert wb.sheetnames[:8] == c.DATA_SHEET_ORDER
    for name in c.DATA_SHEET_ORDER:
        assert wb[name].sheet_properties.tabColor.rgb.endswith(c.COLOR_DATA)

def test_cabeceras_exactas(wb):
    for t, columns in c.TABLES.items():
        fila1 = [cell.value for cell in wb[t][1][: len(columns)]]
        assert fila1 == [x.name for x in columns], t

def test_meta(wb):
    ws = wb["meta"]
    assert (ws["A1"].value, ws["B1"].value) == ("key", "value")
    keys = {ws.cell(row=r, column=1).value: ws.cell(row=r, column=2).value for r in range(2, 5)}
    assert keys == c.META_KEYS
    cabeceras_enums = [ws.cell(row=1, column=4 + i).value for i in range(len(c.ENUMS))]
    assert set(cabeceras_enums) == set(c.ENUMS)

def test_semillas_escritas(wb):
    assert wb["accounts"]["B2"].value == "N26"
    assert wb["accounts"]["C5"].value == "liability"
    nombres = [wb["categories"].cell(row=r, column=2).value for r in range(2, 60)]
    assert "Supermercado" in nombres and "Nómina" in nombres

def test_columnas_system_ocultas_y_freeze(wb):
    for t, columns in c.TABLES.items():
        ws = wb[t]
        assert ws.freeze_panes == "A2"
        for name in c.SYSTEM_COLUMNS:
            assert ws.column_dimensions[col(t, name)].hidden, (t, name)

def test_formulas_precargadas_en_transactions(wb):
    ws = wb["transactions"]
    assert str(ws["P2"].value).startswith("=IF(")
    assert str(ws[f"Q{c.PREFILLED_ROWS + 1}"].value).startswith("=IF(")

def test_validaciones_presentes(wb):
    ws = wb["transactions"]
    formulas = [dv.formula1 for dv in ws.data_validations.dataValidation]
    assert "=enum_transaction_types" in formulas
    assert "=accounts_names" in formulas and "=categories_pickers" in formulas
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `.venv/bin/python -m pytest tests/test_build_datos.py -q`
Expected: FAIL (`build_xlsx` no existe)

- [ ] **Step 3: Implementar la parte de datos de `build_xlsx.py`**

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from . import contract as c
from . import seeds

N = c.PREFILLED_ROWS

def col(table, name):
    names = [x.name for x in c.TABLES[table]]
    return get_column_letter(names.index(name) + 1)

def tr(name):
    l = col("transactions", name)
    return f"transactions!${l}$2:${l}${N + 1}"

def saldo_expr(id_expr):
    e, g, i_, d, z = tr("amount"), tr("account_id"), tr("counter_account_id"), tr("type"), tr("deleted")
    return (f'VLOOKUP({id_expr},accounts!$A:$D,4,FALSE)'
            f'+SUMIFS({e},{g},{id_expr},{d},"income",{z},FALSE)'
            f'+SUMIFS({e},{g},{id_expr},{d},"refund",{z},FALSE)'
            f'-SUMIFS({e},{g},{id_expr},{d},"expense",{z},FALSE)'
            f'-SUMIFS({e},{g},{id_expr},{d},"transfer",{z},FALSE)'
            f'+SUMIFS({e},{i_},{id_expr},{d},"transfer",{z},FALSE)'
            f'+SUMIFS({e},{g},{id_expr},{d},"adjustment",{z},FALSE)')

def _head(ws, names, color):
    ws.sheet_properties.tabColor = color
    ws.freeze_panes = "A2"
    for j, name in enumerate(names, 1):
        cell = ws.cell(row=1, column=j, value=name)
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="EEEEEE")

def _dv(ws, formula, letra, boolean=False):
    dv = DataValidation(type="list", formula1=formula, allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv)
    dv.add(f"{letra}2:{letra}{N + 1}")

def _write_meta(wb):
    ws = wb.create_sheet("meta")
    _head(ws, ["key", "value"], c.COLOR_DATA)
    for r, (k, v) in enumerate(c.META_KEYS.items(), 2):
        ws.cell(row=r, column=1, value=k); ws.cell(row=r, column=2, value=v)
    for j, (name, values) in enumerate(c.ENUMS.items()):
        letra = get_column_letter(4 + j)
        ws.cell(row=1, column=4 + j, value=name).font = Font(bold=True)
        for r, v in enumerate(values, 2):
            ws.cell(row=r, column=4 + j, value=v)
        wb.defined_names[f"enum_{name}"] = DefinedName(f"enum_{name}",
            attr_text=f"meta!${letra}$2:${letra}${len(values) + 1}")

def _write_rows(ws, table, rows):
    names = [x.name for x in c.TABLES[table]]
    for r, row in enumerate(rows, 2):
        for j, name in enumerate(names, 1):
            if name in row:
                ws.cell(row=r, column=j, value=row[name])
        ws.cell(row=r, column=names.index("created_at") + 1, value=seeds.NOW_ISO)
        ws.cell(row=r, column=names.index("updated_at") + 1, value=seeds.NOW_ISO)
        ws.cell(row=r, column=names.index("deleted") + 1, value=False)

def _write_data_sheets(wb):
    for t in c.DATA_SHEET_ORDER:
        if t == "meta":
            continue
        ws = wb.create_sheet(t)
        names = [x.name for x in c.TABLES[t]]
        _head(ws, names, c.COLOR_DATA)
        for x in c.TABLES[t]:                     # validaciones por tipo de columna
            letra = col(t, x.name)
            if x.kind.startswith("enum:"):
                _dv(ws, f"=enum_{x.kind.split(':')[1]}", letra)
            elif x.kind == "bool":
                _dv(ws, '"TRUE,FALSE"', letra)
        for x in c.TABLES[t]:                     # system y _picker ocultas
            if x.name in c.SYSTEM_COLUMNS or x.name == "_picker":
                ws.column_dimensions[col(t, x.name)].hidden = True
    _write_rows(wb["accounts"], "accounts", seeds.SEED_ACCOUNTS)
    _write_rows(wb["categories"], "categories", seeds.SEED_CATEGORIES)
    ws = wb["categories"]                          # _picker: elegible si es hoja
    for r in range(2, 202):
        ws.cell(row=r, column=8, value=(
            f'=IF($A{r}="","",IF(COUNTIF($C:$C,$A{r})>0,"",'
            f'IF($C{r}="",$B{r},VLOOKUP($C{r},$A:$B,2,FALSE)&" → "&$B{r})))'))
    ws = wb["transactions"]                        # _my_amount y _sara_amount
    for r in range(2, N + 2):
        ws.cell(row=r, column=16, value=(
            f'=IF($E{r}="",0,IF($N{r}=TRUE,ROUND($E{r}*IF($O{r}="",'
            f'IFERROR(VLOOKUP($C{r},periods!$A:$F,6,FALSE),100),$O{r})/100,2),$E{r}))'))
        ws.cell(row=r, column=17, value=f'=IF($N{r}=TRUE,ROUND($E{r}-$P{r},2),0)')
    _dv(ws, "=accounts_names", col("transactions", "_account"))
    _dv(ws, "=accounts_names", col("transactions", "_counter_account"))
    _dv(ws, "=categories_pickers", col("transactions", "_category"))
    _dv(ws, "=rules_names", col("transactions", "_rule"))
    for nombre, ref in [("accounts_names", "accounts!$B$2:$B$100"),
                        ("categories_pickers", "categories!$H$2:$H$201"),
                        ("rules_names", "recurring_rules!$B$2:$B$100"),
                        ("periods_names", "periods!$B$2:$B$100")]:
        wb.defined_names[nombre] = DefinedName(nombre, attr_text=ref)

def build(path):
    wb = Workbook()
    wb.remove(wb.active)
    _write_meta(wb)
    _write_data_sheets(wb)
    from .dashboards import write_dashboards   # Task 4; hasta entonces, stub
    write_dashboards(wb)
    wb.save(path)
```

Y un stub temporal `generator/basecero_generator/dashboards.py` para que Task 3 pase en verde solo con datos:

```python
def write_dashboards(wb):
    pass
```

- [ ] **Step 4: Verificar en verde**

Run: `.venv/bin/python -m pytest tests/test_build_datos.py -q`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add generator && git commit -m "feat: generador de pestañas de datos con validaciones y semillas"
```

### Task 4: `dashboards.py` — las 3 pestañas verdes

**Files:**
- Create: `generator/basecero_generator/dashboards.py` (reemplaza el stub)
- Test: `generator/tests/test_build_dashboards.py`

**Interfaces:**
- Consumes: `build_xlsx.col/tr/saldo_expr`, `contract`, `seeds.SEED_CATEGORIES/SEED_ACCOUNTS`.
- Produces: `write_dashboards(wb) -> None` creando las hojas `Resumen del periodo`, `Patrimonio y objetivos`, `Previsión` (en ese orden, tras las de datos).

- [ ] **Step 1: Test que fija los dashboards (falla)**

`generator/tests/test_build_dashboards.py`:

```python
import pytest
from openpyxl import load_workbook
from basecero_generator.build_xlsx import build
from basecero_generator import contract as c

@pytest.fixture(scope="module")
def wb(tmp_path_factory):
    p = tmp_path_factory.mktemp("out") / "BaseCero.xlsx"
    build(str(p))
    return load_workbook(str(p))

def test_orden_y_color(wb):
    assert wb.sheetnames == c.DATA_SHEET_ORDER + \
        ["Resumen del periodo", "Patrimonio y objetivos", "Previsión"]
    for name in wb.sheetnames[8:]:
        assert wb[name].sheet_properties.tabColor.rgb.endswith(c.COLOR_DASH)

def test_resumen(wb):
    ws = wb["Resumen del periodo"]
    assert "INDEX(periods" in str(ws["B2"].value)
    assert "SUMIFS" in str(ws["B5"].value)          # ingresos
    assert "_" not in str(ws["B6"].value) and "SUMPRODUCT" in str(ws["B6"].value)
    assert "SUMPRODUCT" in str(ws["B13"].value)     # pendiente Sara
    fila_super = [r for r in range(18, 60) if ws.cell(row=r, column=2).value == "Supermercado"]
    assert fila_super and "cat-alimentacion-supermercado" in str(
        ws.cell(row=fila_super[0], column=3).value)

def test_patrimonio(wb):
    ws = wb["Patrimonio y objetivos"]
    assert "VLOOKUP(\"acc-n26\"" in str(ws["B3"].value)
    assert str(ws["B7"].value).startswith("=SUM(")   # patrimonio neto
    assert "REPT" in str(ws["D31"].value)            # barra de objetivos, fila 1 de plantilla

def test_prevision(wb):
    ws = wb["Previsión"]
    assert 'MATCH("open"' in str(ws["B1"].value)
    assert "COUNTIFS" in str(ws["F4"].value)         # estado pagado/pendiente
    assert "Disponible real" in [ws.cell(row=r, column=1).value for r in range(25, 32)]
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `.venv/bin/python -m pytest tests/test_build_dashboards.py -q`
Expected: FAIL (stub no crea hojas)

- [ ] **Step 3: Implementar `dashboards.py`**

```python
from openpyxl.styles import Font
from openpyxl.worksheet.datavalidation import DataValidation
from . import contract as c
from . import seeds
from .build_xlsx import col, tr, saldo_expr

B = Font(bold=True)

def _sheet(wb, name):
    ws = wb.create_sheet(name)
    ws.sheet_properties.tabColor = c.COLOR_DASH
    ws["A1"].font = B
    return ws

def _gasto(cat_id_expr, period_cell):
    p, e, d, z, k, s, cc = (tr("_my_amount"), tr("amount"), tr("type"), tr("deleted"),
                            tr("category_id"), tr("ref_id"), tr("period_id"))
    base = f'({cc}={period_cell})*({z}=FALSE)'
    filtro = f'({k}={cat_id_expr})*' if cat_id_expr else ""
    return (f'SUMPRODUCT({filtro}{base}*({d}="expense")*{p})'
            f'-SUMPRODUCT({filtro}{base}*({d}="refund")*({s}="")*{e})')

def _resumen(wb):
    ws = _sheet(wb, "Resumen del periodo")
    ws["A1"] = "Periodo:"
    dv = DataValidation(type="list", formula1="=periods_names", allow_blank=True)
    ws.add_data_validation(dv); dv.add("B1")
    ws["B2"] = '=IFERROR(INDEX(periods!$A:$A,MATCH($B$1,periods!$B:$B,0)),"")'
    ws["B3"] = '=IFERROR(INDEX(periods!$A:$A,MATCH($B$1,periods!$B:$B,0)-1),"")'
    e, d, z, cc, n, q, r2, v, k = (tr("amount"), tr("type"), tr("deleted"), tr("period_id"),
        tr("is_shared"), tr("_sara_amount"), tr("settled"), tr("external_id"), tr("category_id"))
    ws["A5"], ws["B5"] = "Ingresos", (f'=SUMIFS({e},{cc},$B$2,{d},"income",{z},FALSE)')
    ws["A6"], ws["B6"] = "Gasto (mi parte)", "=" + _gasto("", "$B$2")
    ws["A7"], ws["B7"] = "Ahorro €", "=B5-B6"
    ws["A8"], ws["B8"] = "Tasa de ahorro", '=IF(B5=0,"",B7/B5)'
    comp = f'({cc}=$B$2)*({n}=TRUE)*({d}="expense")*({z}=FALSE)'
    ws["A10"], ws["B10"] = "Compartido total", f'=SUMPRODUCT({comp}*{e})'
    ws["A11"], ws["B11"] = "Mi parte", f'=SUMPRODUCT({comp}*{tr("_my_amount")})'
    ws["A12"], ws["B12"] = "Parte de Sara", f'=SUMPRODUCT({comp}*{q})'
    ws["A13"], ws["B13"] = "Pendiente de cobro (global)", \
        f'=SUMPRODUCT(({n}=TRUE)*({r2}=FALSE)*({d}="expense")*({z}=FALSE)*{q})'
    ws["A15"], ws["B15"] = "Sin categorizar", \
        f'=SUMPRODUCT(({v}<>"")*({k}="")*({z}=FALSE)*1)'
    for j, t in enumerate(["Categoría", "Subcategoría", "Este periodo", "Anterior", "Δ"], 1):
        ws.cell(row=17, column=j, value=t).font = B
    by_id = {x["id"]: x for x in seeds.SEED_CATEGORIES}
    hojas = [x for x in seeds.SEED_CATEGORIES if x["flow"] == "expense"
             and not any(y["parent_id"] == x["id"] for y in seeds.SEED_CATEGORIES)]
    for i, cat in enumerate(hojas):
        r = 18 + i
        raiz = by_id[cat["parent_id"]]["name"] if cat["parent_id"] else cat["name"]
        ws.cell(row=r, column=1, value=raiz)
        ws.cell(row=r, column=2, value=cat["name"])
        ws.cell(row=r, column=3, value="=" + _gasto(f'"{cat["id"]}"', "$B$2"))
        ws.cell(row=r, column=4, value="=" + _gasto(f'"{cat["id"]}"', "$B$3"))
        ws.cell(row=r, column=5, value=f'=IF(OR(D{r}="",D{r}=0),"",C{r}/D{r}-1)')

def _patrimonio(wb):
    ws = _sheet(wb, "Patrimonio y objetivos")
    ws["A1"] = "Cuentas"
    for i, acc in enumerate(seeds.SEED_ACCOUNTS):
        r = 3 + i
        ws.cell(row=r, column=1, value=acc["name"])
        ws.cell(row=r, column=2, value="=" + saldo_expr(f'"{acc["id"]}"'))
    ws["A7"], ws["B7"] = "PATRIMONIO NETO", "=SUM(B3:B6)"
    ws["A7"].font = B
    ws["A9"] = "Evolución por periodo"
    b, e, d, z = tr("date"), tr("amount"), tr("type"), tr("deleted")
    for i in range(12):                      # 12 periodos de serie
        r, pr = 10 + i, 2 + i
        ws.cell(row=r, column=1, value=f'=IF(periods!$B{pr}="","",periods!$B{pr})')
        ws.cell(row=r, column=2, value=(
            f'=IF(periods!$D{pr}="","",SUM(accounts!$D$2:$D$100)'
            f'+SUMPRODUCT(({b}<=periods!$D{pr})*(({d}="income")+({d}="refund")+({d}="adjustment"))*({z}=FALSE)*{e})'
            f'-SUMPRODUCT(({b}<=periods!$D{pr})*({d}="expense")*({z}=FALSE)*{e}))'))
    ws["A29"] = "Objetivos"
    ws["B28"] = '=IFERROR(INDEX(periods!$A:$A,MATCH("open",periods!$E:$E,0)),"")'
    gasto_medio = (f'(SUMPRODUCT(({tr("type")}="expense")*({tr("deleted")}=FALSE)*{tr("_my_amount")})'
                   f'/MAX(1,COUNTIF(periods!$E:$E,"closed")))')
    for j, t in enumerate(["Objetivo", "Tipo", "Progreso", "Barra"], 1):
        ws.cell(row=30, column=j, value=t).font = B
    for i in range(10):                      # 10 goals de plantilla
        r, gr = 31 + i, 2 + i
        saldo = saldo_expr(f"goals!$H{gr}")
        gasto_cap = _gasto(f"goals!$I{gr}", "$B$28")
        ws.cell(row=r, column=1, value=f'=IF(goals!$B{gr}="","",goals!$B{gr})')
        ws.cell(row=r, column=2, value=f'=IF(goals!$B{gr}="","",goals!$C{gr})')
        ws.cell(row=r, column=3, value=(
            f'=IF(goals!$B{gr}="","",IFERROR(IFS('
            f'goals!$C{gr}="savings_target",({saldo})/goals!$D{gr},'
            f'goals!$C{gr}="provision",({saldo})/goals!$D{gr},'
            f'goals!$C{gr}="emergency_fund",({saldo})/(goals!$E{gr}*{gasto_medio}),'
            f'goals!$C{gr}="spending_cap",({gasto_cap})/goals!$D{gr},'
            f'goals!$C{gr}="savings_rate",1),""))'))
        ws.cell(row=r, column=4, value=(
            f'=IF(C{r}="","",REPT("█",MIN(10,ROUND(C{r}*10,0)))&" "&TEXT(C{r},"0%"))'))
    # savings_rate=1 es un marcador honesto del MVP: la tasa objetivo se compara a ojo
    # con la tasa del Resumen; la app lo calculará de verdad. Documentado en README.

def _prevision(wb):
    ws = _sheet(wb, "Previsión")
    ws["A1"], ws["B1"] = "Periodo abierto", \
        '=IFERROR(INDEX(periods!$A:$A,MATCH("open",periods!$E:$E,0)),"")'
    ws["A2"], ws["B2"] = "Mi % este periodo", \
        '=IFERROR(VLOOKUP($B$1,periods!$A:$F,6,FALSE),100)'
    for j, t in enumerate(["Regla", "Frecuencia", "¿Aplica este mes?", "Mi importe", "", "Estado"], 1):
        ws.cell(row=3, column=j, value=t).font = B
    u, cc, k, e = tr("rule_id"), tr("period_id"), tr("category_id"), tr("amount")
    for i in range(20):                      # 20 reglas de plantilla
        r, rr = 4 + i, 2 + i
        ws.cell(row=r, column=1, value=f'=IF(recurring_rules!$B{rr}="","",recurring_rules!$B{rr})')
        ws.cell(row=r, column=2, value=f'=IF(recurring_rules!$B{rr}="","",recurring_rules!$H{rr})')
        ws.cell(row=r, column=3, value=(
            f'=IF(recurring_rules!$B{rr}="","",IF(recurring_rules!$L{rr}=FALSE,"no",'
            f'IF(OR(recurring_rules!$H{rr}="monthly",recurring_rules!$H{rr}="weekly"),"sí",'
            f'IF(recurring_rules!$H{rr}="yearly",IF(recurring_rules!$J{rr}=MONTH(TODAY()),"sí","no"),'
            f'IF(MOD(MONTH(TODAY())-recurring_rules!$J{rr},3)=0,"sí","no")))))'))
        ws.cell(row=r, column=4, value=(
            f'=IF(recurring_rules!$B{rr}="","",IF(recurring_rules!$K{rr}=TRUE,'
            f'ROUND(recurring_rules!$D{rr}*$B$2/100,2),recurring_rules!$D{rr}))'))
        ws.cell(row=r, column=6, value=(
            f'=IF(recurring_rules!$B{rr}="","",'
            f'IF(OR(COUNTIFS({u},recurring_rules!$A{rr},{cc},$B$1)>0,'
            f'COUNTIFS({k},recurring_rules!$E{rr},{e},recurring_rules!$D{rr},{cc},$B$1)>0),'
            f'"✅ pagado","⏳ pendiente"))'))
    ws["A26"], ws["B26"] = "Comprometido restante", \
        '=SUMPRODUCT(($C$4:$C$23="sí")*($F$4:$F$23="⏳ pendiente")*($D$4:$D$23))'
    n, q, r2, d, z = tr("is_shared"), tr("_sara_amount"), tr("settled"), tr("type"), tr("deleted")
    ws["A27"], ws["B27"] = "Pendiente de Sara", \
        f'=SUMPRODUCT(({n}=TRUE)*({r2}=FALSE)*({d}="expense")*({z}=FALSE)*{q})'
    ws["A28"], ws["B28"] = "Saldo N26", "=" + saldo_expr('"acc-n26"')
    ws["A29"], ws["B29"] = "Disponible real", "=B28-B26+B27"
    ws["A29"].font = B

def write_dashboards(wb):
    _resumen(wb); _patrimonio(wb); _prevision(wb)
```

Nota sobre `SUMPRODUCT` con rangos que contienen `""`: las fórmulas multiplican rangos calculados (`_my_amount`, `_sara_amount`) que devuelven `""` en filas vacías; el patrón `SUMPRODUCT(cond*rango)` con `""` da error `#VALUE!` en Excel. Solución aplicada en TODAS las fórmulas de `_gasto` y similares al implementar: envolver el rango calculado con `N(...)`... `N()` no vectoriza en Excel clásico. La solución REAL y portable: las fórmulas precargadas de Task 3 devuelven `0` en vez de `""` cuando la fila está vacía (`=IF($E2="",0,...)` y `=IF($N2=TRUE,...,0)`), y los dashboards no cambian. **Al implementar Task 3, usa `0`, no `""`, en `_my_amount` y `_sara_amount`** (el listado de Task 3 se corrige en su Step 3 al escribirlo; este es el comportamiento contractual: columnas `_` con 0 en vacío).

- [ ] **Step 4: Verificar en verde**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add generator && git commit -m "feat: dashboards Resumen, Patrimonio y Previsión con fórmulas portables"
```

### Task 5: CLI + test de integración

**Files:**
- Create: `generator/basecero_generator/cli.py`
- Test: `generator/tests/test_cli.py`

**Interfaces:**
- Produces: `python -m basecero_generator.cli [ruta]` → genera el xlsx (por defecto `dist/BaseCero.xlsx`).

- [ ] **Step 1: Test (falla)**

`generator/tests/test_cli.py`:

```python
import subprocess, sys
from openpyxl import load_workbook

def test_cli_genera_el_archivo(tmp_path):
    out = tmp_path / "BaseCero.xlsx"
    res = subprocess.run([sys.executable, "-m", "basecero_generator.cli", str(out)],
                         capture_output=True, text=True)
    assert res.returncode == 0 and out.exists()
    wb = load_workbook(str(out))
    assert len(wb.sheetnames) == 11
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `.venv/bin/python -m pytest tests/test_cli.py -q` → FAIL (módulo cli no existe)

- [ ] **Step 3: Implementar `cli.py`**

```python
import pathlib, sys
from .build_xlsx import build

def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "dist/BaseCero.xlsx")
    out.parent.mkdir(parents=True, exist_ok=True)
    build(str(out))
    print(f"Generado: {out}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Verificar en verde y generar el real**

Run: `.venv/bin/python -m pytest tests/ -q` → PASS
Run: `cd ~/Documents/apps/BaseCero && generator/.venv/bin/python -m basecero_generator.cli` → `Generado: dist/BaseCero.xlsx`

- [ ] **Step 5: Commit**

```bash
git add generator && git commit -m "feat: CLI del generador"
```

### Task 6: `apps_script/pure.js` — lógica pura con tests en Node

**Files:**
- Create: `apps_script/pure.js`, `apps_script/fixtures/n26_sample.csv`
- Test: `apps_script/tests/pure.test.mjs`

**Interfaces:**
- Produces (todas con prefijo `bc` para no chocar con GAS): `bcUlid(nowMs, randByteFn) -> string(26)`; `bcBuildExternalId(dateIso, amountCents, partner, reference, sha256HexFn) -> string(16)`; `bcParseN26Csv(text) -> [{bookingDate, partnerName, paymentReference, amountCents}]` (céntimos CON signo); `bcDecideImportAction(row, existing) -> {action: "skip"|"reconcile"|"create", matchId?}` con `existing: [{id, dateIso, type, amountCents, externalId, status}]`; `bcResolvePickerToId(picker, categories) -> string|""` con `categories: [{id, name, parentId}]`; `bcDaysBetween(isoA, isoB) -> number`.
- Export condicional Node: `if (typeof module !== "undefined") module.exports = {...}`.

- [ ] **Step 1: Fixture del CSV de N26**

`apps_script/fixtures/n26_sample.csv` (formato de export de N26; el duplicado final prueba el skip):

```csv
"Booking Date","Value Date","Partner Name","Partner Iban","Type","Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"
"2026-08-20","2026-08-20","MERCADONA","","Presentment","Compra tarjeta","Cuenta principal","-45.20","","",""
"2026-08-21","2026-08-21","Sara","ES9121000000000000000000","MoneyBeam","Bizum alquiler","Cuenta principal","360.00","","",""
"2026-08-27","2026-08-27","EMPRESA SL","ES0000000000000000000000","Credit Transfer","Nomina agosto","Cuenta principal","1800.00","","",""
"2026-08-20","2026-08-20","MERCADONA","","Presentment","Compra tarjeta","Cuenta principal","-45.20","","",""
```

- [ ] **Step 2: Tests que fallan**

`apps_script/tests/pure.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const p = require("../pure.js");

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const csv = readFileSync(new URL("../fixtures/n26_sample.csv", import.meta.url), "utf8");

test("ulid: 26 chars Crockford y prefijo temporal estable", () => {
  const u = p.bcUlid(1756000000000, () => 128);
  assert.match(u, /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  assert.equal(u, p.bcUlid(1756000000000, () => 128)); // determinista con rand fijo
});

test("externalId: 16 hex estables", () => {
  const a = p.bcBuildExternalId("2026-08-20", -4520, "MERCADONA", "Compra tarjeta", sha256hex);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, p.bcBuildExternalId("2026-08-20", -4520, "MERCADONA", "Compra tarjeta", sha256hex));
  assert.notEqual(a, p.bcBuildExternalId("2026-08-21", -4520, "MERCADONA", "Compra tarjeta", sha256hex));
});

test("parser N26: 4 filas con céntimos con signo", () => {
  const rows = p.bcParseN26Csv(csv);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    [rows[0].bookingDate, rows[0].partnerName, rows[0].amountCents],
    ["2026-08-20", "MERCADONA", -4520]);
  assert.equal(rows[2].amountCents, 180000);
});

test("decide: skip por externalId, reconcile por pending, create el resto", () => {
  const rows = p.bcParseN26Csv(csv).map((r) => ({
    ...r, externalId: p.bcBuildExternalId(r.bookingDate, r.amountCents, r.partnerName, r.paymentReference, sha256hex)}));
  const existing = [
    { id: "t1", dateIso: "2026-08-19", type: "expense", amountCents: 4520, externalId: "", status: "pending" },
    { id: "t2", dateIso: "2026-08-21", type: "refund", amountCents: 36000, externalId: rows[1].externalId, status: "reconciled" },
  ];
  assert.deepEqual(p.bcDecideImportAction(rows[0], existing), { action: "reconcile", matchId: "t1" });
  assert.deepEqual(p.bcDecideImportAction(rows[1], existing), { action: "skip" });
  assert.deepEqual(p.bcDecideImportAction(rows[2], existing), { action: "create" });
});

test("picker → id", () => {
  const cats = [
    { id: "cat-casa", name: "Casa", parentId: "" },
    { id: "cat-casa-luz", name: "Luz", parentId: "cat-casa" },
    { id: "cat-ropa", name: "Ropa y cuidado personal", parentId: "" },
  ];
  assert.equal(p.bcResolvePickerToId("Casa → Luz", cats), "cat-casa-luz");
  assert.equal(p.bcResolvePickerToId("Ropa y cuidado personal", cats), "cat-ropa");
  assert.equal(p.bcResolvePickerToId("No existe", cats), "");
});
```

- [ ] **Step 3: Ejecutar y ver el fallo**

Run: `cd ~/Documents/apps/BaseCero && node --test apps_script/tests/`
Expected: FAIL (`Cannot find module '../pure.js'`)

- [ ] **Step 4: Implementar `pure.js`**

```js
// Lógica pura de BaseCero, compartida entre Google Apps Script y Node (tests).
// Sintaxis compatible GAS: var + function, sin import/export.

var BC_B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function bcEncodeB32(value, length) {
  var out = "";
  for (var i = 0; i < length; i++) {
    out = BC_B32.charAt(value % 32) + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function bcUlid(nowMs, randByteFn) {
  var t = nowMs === undefined ? Date.now() : nowMs;
  var rb = randByteFn || function () { return Math.floor(Math.random() * 256); };
  var rand = "";
  for (var i = 0; i < 16; i++) rand += BC_B32.charAt(rb() % 32);
  return bcEncodeB32(t, 10) + rand;
}

function bcBuildExternalId(dateIso, amountCents, partner, reference, sha256HexFn) {
  var payload = dateIso + "|" + amountCents + "|" + (partner || "") + "|" + (reference || "");
  return sha256HexFn(payload).slice(0, 16);
}

function bcParseCsvLine(line) {
  var out = [], cur = "", inQ = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line.charAt(i);
    if (inQ) {
      if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function bcParseN26Csv(text) {
  var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
  var head = bcParseCsvLine(lines[0]);
  var ix = {
    date: head.indexOf("Booking Date"),
    partner: head.indexOf("Partner Name"),
    ref: head.indexOf("Payment Reference"),
    amount: head.indexOf("Amount (EUR)"),
  };
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var f = bcParseCsvLine(lines[i]);
    rows.push({
      bookingDate: f[ix.date],
      partnerName: f[ix.partner],
      paymentReference: f[ix.ref],
      amountCents: Math.round(parseFloat(f[ix.amount]) * 100),
    });
  }
  return rows;
}

function bcDaysBetween(isoA, isoB) {
  return Math.abs(new Date(isoA + "T00:00:00Z") - new Date(isoB + "T00:00:00Z")) / 86400000;
}

function bcDecideImportAction(row, existing) {
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].externalId && existing[i].externalId === row.externalId) {
      return { action: "skip" };
    }
  }
  var quiereGasto = row.amountCents < 0;
  for (var j = 0; j < existing.length; j++) {
    var t = existing[j];
    if (t.status === "pending" && !t.externalId &&
        Math.abs(t.amountCents) === Math.abs(row.amountCents) &&
        (t.type === "expense") === quiereGasto &&
        bcDaysBetween(t.dateIso, row.bookingDate) <= 3) {
      return { action: "reconcile", matchId: t.id };
    }
  }
  return { action: "create" };
}

function bcResolvePickerToId(picker, categories) {
  var parts = picker.split(" → ");
  for (var i = 0; i < categories.length; i++) {
    var cat = categories[i];
    if (parts.length === 1 && cat.name === parts[0] && cat.parentId === "") return cat.id;
    if (parts.length === 2 && cat.name === parts[1] && cat.parentId !== "") {
      for (var j = 0; j < categories.length; j++) {
        if (categories[j].id === cat.parentId && categories[j].name === parts[0]) return cat.id;
      }
    }
  }
  return "";
}

if (typeof module !== "undefined") {
  module.exports = { bcUlid: bcUlid, bcBuildExternalId: bcBuildExternalId,
    bcParseCsvLine: bcParseCsvLine, bcParseN26Csv: bcParseN26Csv,
    bcDaysBetween: bcDaysBetween, bcDecideImportAction: bcDecideImportAction,
    bcResolvePickerToId: bcResolvePickerToId };
}
```

- [ ] **Step 5: Verificar en verde**

Run: `node --test apps_script/tests/`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add apps_script && git commit -m "feat: lógica pura del Apps Script (ULID, hash, parser N26, matching) con tests Node"
```

### Task 7: `apps_script/main.js` (pegamento GAS) + README de puesta en marcha

**Files:**
- Create: `apps_script/main.js`, `README.md`

**Interfaces:**
- Consumes: todas las funciones `bc*` de `pure.js` (en GAS ambos archivos comparten ámbito global).
- Produces: `onOpen()` (menú), `onEditInstalable(e)` (a instalar como trigger), `abrirDialogoImport()`, `processN26Csv(text)`.

- [ ] **Step 1: Implementar `main.js`**

```js
// Pegamento de Google Apps Script. Requiere pure.js en el mismo proyecto.
var BC_DATA_SHEETS = ["accounts", "categories", "periods", "transactions",
                      "recurring_rules", "goals", "budgets"];

function onOpen() {
  SpreadsheetApp.getUi().createMenu("BaseCero")
    .addItem("Importar CSV de N26…", "abrirDialogoImport")
    .addToUi();
}

function gasSha256Hex(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s,
                                      Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    return ((b + 256) % 256).toString(16).padStart(2, "0");
  }).join("");
}

function bcNowIso() {
  return Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function bcHeaderIndex(sheet) {
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var ix = {};
  head.forEach(function (h, i) { ix[h] = i + 1; });
  return ix;
}

function bcLookupIdByName(sheetName, name) {
  var vals = SpreadsheetApp.getActive().getSheetByName(sheetName)
    .getRange("A2:B200").getValues();
  for (var i = 0; i < vals.length; i++) if (vals[i][1] === name) return vals[i][0];
  return "";
}

function bcOpenPeriodId() {
  var vals = SpreadsheetApp.getActive().getSheetByName("periods")
    .getRange("A2:E100").getValues();
  for (var i = 0; i < vals.length; i++) if (vals[i][4] === "open") return vals[i][0];
  return "";
}

function bcCategoriesForPicker() {
  var vals = SpreadsheetApp.getActive().getSheetByName("categories")
    .getRange("A2:C300").getValues();
  return vals.filter(function (v) { return v[0] !== ""; })
    .map(function (v) { return { id: v[0], name: v[1], parentId: v[2] || "" }; });
}

// Trigger INSTALABLE (Editor GAS > Triggers > onEditInstalable, evento "Al editar").
function onEditInstalable(e) {
  var sheet = e.range.getSheet();
  if (BC_DATA_SHEETS.indexOf(sheet.getName()) < 0 || e.range.getRow() < 2) return;
  var ix = bcHeaderIndex(sheet);
  var row = e.range.getRow();
  var now = bcNowIso();
  if (sheet.getRange(row, ix["id"]).getValue() === "") {
    sheet.getRange(row, ix["id"]).setValue(bcUlid());
    sheet.getRange(row, ix["created_at"]).setValue(now);
    if (ix["deleted"]) sheet.getRange(row, ix["deleted"]).setValue(false);
  }
  sheet.getRange(row, ix["updated_at"]).setValue(now);
  if (sheet.getName() !== "transactions") return;
  if (sheet.getRange(row, ix["date"]).getValue() === "") {
    sheet.getRange(row, ix["date"]).setValue(
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"));
  }
  if (sheet.getRange(row, ix["period_id"]).getValue() === "") {
    sheet.getRange(row, ix["period_id"]).setValue(bcOpenPeriodId());
  }
  if (sheet.getRange(row, ix["status"]).getValue() === "") {
    sheet.getRange(row, ix["status"]).setValue("pending");
  }
  var pares = [["_account", "account_id", "accounts"],
               ["_counter_account", "counter_account_id", "accounts"],
               ["_rule", "rule_id", "recurring_rules"]];
  pares.forEach(function (par) {
    var visible = sheet.getRange(row, ix[par[0]]).getValue();
    if (visible !== "" && sheet.getRange(row, ix[par[1]]).getValue() === "") {
      sheet.getRange(row, ix[par[1]]).setValue(bcLookupIdByName(par[2], visible));
    }
  });
  var picker = sheet.getRange(row, ix["_category"]).getValue();
  if (picker !== "" && sheet.getRange(row, ix["category_id"]).getValue() === "") {
    sheet.getRange(row, ix["category_id"]).setValue(
      bcResolvePickerToId(picker, bcCategoriesForPicker()));
  }
}

function abrirDialogoImport() {
  var html = HtmlService.createHtmlOutput(
    '<textarea id="t" rows="15" style="width:100%"></textarea><br>' +
    '<button onclick="google.script.run.withSuccessHandler(function(m){' +
    'document.body.innerHTML=m;}).processN26Csv(' +
    'document.getElementById(\'t\').value)">Importar</button>')
    .setWidth(520).setHeight(360);
  SpreadsheetApp.getUi().showModalDialog(html, "Pega aquí el CSV de N26");
}

function processN26Csv(text) {
  var sheet = SpreadsheetApp.getActive().getSheetByName("transactions");
  var ix = bcHeaderIndex(sheet);
  var last = sheet.getLastRow();
  var existing = [];
  if (last >= 2) {
    var vals = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    vals.forEach(function (v, i) {
      if (v[ix["id"] - 1] === "") return;
      existing.push({ id: v[ix["id"] - 1], rowNum: i + 2,
        dateIso: String(v[ix["date"] - 1]).slice(0, 10),
        type: v[ix["type"] - 1],
        amountCents: Math.round((parseFloat(v[ix["amount"] - 1]) || 0) * 100) *
          (v[ix["type"] - 1] === "expense" ? -1 : 1),
        externalId: v[ix["external_id"] - 1], status: v[ix["status"] - 1] });
    });
  }
  var rows = bcParseN26Csv(text);
  var res = { skip: 0, reconcile: 0, create: 0 };
  var now = bcNowIso();
  rows.forEach(function (r) {
    r.externalId = bcBuildExternalId(r.bookingDate, r.amountCents, r.partnerName,
                                     r.paymentReference, gasSha256Hex);
    var d = bcDecideImportAction(r, existing);
    res[d.action]++;
    if (d.action === "reconcile") {
      var m = existing.filter(function (t) { return t.id === d.matchId; })[0];
      sheet.getRange(m.rowNum, ix["external_id"]).setValue(r.externalId);
      sheet.getRange(m.rowNum, ix["status"]).setValue("reconciled");
      sheet.getRange(m.rowNum, ix["updated_at"]).setValue(now);
      m.externalId = r.externalId;
    } else if (d.action === "create") {
      var newRow = sheet.getLastRow() + 1;
      var set = function (colName, value) {
        sheet.getRange(newRow, ix[colName]).setValue(value);
      };
      set("id", bcUlid()); set("date", r.bookingDate);
      set("period_id", bcOpenPeriodId());
      set("type", r.amountCents < 0 ? "expense" : "income");
      set("amount", Math.abs(r.amountCents) / 100);
      set("_account", "N26"); set("account_id", bcLookupIdByName("accounts", "N26"));
      set("merchant", r.partnerName); set("note", r.paymentReference);
      set("external_id", r.externalId); set("status", "reconciled");
      set("created_at", now); set("updated_at", now); set("deleted", false);
      existing.push({ id: "nuevo", rowNum: newRow, dateIso: r.bookingDate,
        type: r.amountCents < 0 ? "expense" : "income", amountCents: r.amountCents,
        externalId: r.externalId, status: "reconciled" });
    }
  });
  return "Importado. Nuevas: " + res.create + " · Conciliadas: " + res.reconcile +
         " · Duplicadas (saltadas): " + res.skip +
         ". Revisa la bandeja «sin categorizar» y reclasifica a refund los Bizum de Sara.";
}
```

- [ ] **Step 2: Comprobar sintaxis con Node**

Run: `node --check apps_script/pure.js && node --check apps_script/main.js && echo SINTAXIS-OK`
Expected: `SINTAXIS-OK`

- [ ] **Step 3: Escribir `README.md`** (puesta en marcha + QA)

Contenido (redactar en prosa a partir de estos puntos, todos obligatorios): qué es BaseCero y el papel de contrato de datos del xlsx (enlazar spec); cómo regenerar (`generator/.venv/bin/python -m basecero_generator.cli`); puesta en marcha en Google Sheets:
1. Importar `dist/BaseCero.xlsx` en sheets.new → Archivo > Importar > Subir > "Reemplazar hoja de cálculo".
2. Extensiones > Apps Script → crear `pure.gs` y `main.gs` pegando `apps_script/pure.js` y `apps_script/main.js`; guardar.
3. Activadores (⏰): añadir activador → función `onEditInstalable`, evento "De hoja de cálculo / Al editar" (los instalables funcionan también editando desde la app móvil).
4. Poner los `opening_balance` reales en `accounts` (el préstamo en negativo) y crear el primer periodo en `periods` (name, start_date hoy, status `open`, my_share_pct del mes).
5. Opcional: convertir `is_shared`/`settled` en casillas (Insertar > Casilla de verificación).

Checklist de QA manual (marcar en el primer uso):
- [ ] Registrar un gasto (fecha+importe+_category+_account) → `id`, `period_id`, `status`, timestamps se rellenan solos y `category_id` se resuelve.
- [ ] Gasto compartido con `is_shared=TRUE` → `_my_amount`/`_sara_amount` correctos según `my_share_pct`; con `share_pct_override=50` → mitad.
- [ ] `transfer` N26 → Revolut → los dos saldos se mueven en "Patrimonio y objetivos" y el patrimonio neto no cambia.
- [ ] Regla mensual en `recurring_rules` → aparece "⏳ pendiente" en Previsión; tras registrarla eligiendo `_rule` → "✅ pagado".
- [ ] Menú BaseCero > Importar CSV con `apps_script/fixtures/n26_sample.csv` → 3 nuevas, 1 saltada; re-importar → 0 nuevas, 4 saltadas.
- [ ] Gasto manual de 45,20 € del 19-08 + import del fixture → queda `reconciled` sin duplicarse.
- [ ] Reclasificar el Bizum de Sara importado: `type=refund`, `ref_id` del gasto original, `settled=TRUE` en aquel → "Pendiente de cobro" baja.
- [ ] Cerrar periodo (end_date + closed) y abrir el siguiente → nueva fila en la serie de patrimonio.

Limitaciones documentadas del MVP (del plan y spec): dashboards leen 2000 filas de transactions y plantillas fijas (12 periodos, 10 goals, 20 reglas, 200 categorías); objetivo `savings_rate` muestra progreso fijo 100 % (comparar a ojo con la tasa del Resumen); solo los `refund` sin `ref_id` restan gasto; el import clasifica todo como expense/income (los refund se reclasifican a mano).

- [ ] **Step 4: Commit final**

```bash
git add apps_script README.md && git commit -m "feat: Apps Script (autofill e import N26) y README de puesta en marcha"
```
