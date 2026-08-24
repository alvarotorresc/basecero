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
