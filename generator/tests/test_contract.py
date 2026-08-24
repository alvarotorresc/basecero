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
