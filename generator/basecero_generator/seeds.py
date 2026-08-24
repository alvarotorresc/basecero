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
