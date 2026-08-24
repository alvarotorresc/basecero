import re
from basecero_generator.ulid_gen import ulid

def test_formato_crockford_26():
    u = ulid()
    assert re.fullmatch(r"[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}", u)

def test_unicos_y_crecientes_en_el_tiempo():
    us = [ulid() for _ in range(200)]
    assert len(set(us)) == 200
    assert us[0][:10] <= us[-1][:10]  # prefijo temporal no decreciente
