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
