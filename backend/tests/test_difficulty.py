from app import store
from app.difficulty import rate, effort_miles


def test_all_trails_load_and_rate():
    trails = store.load_all()
    assert len(trails) >= 10
    for t in trails:
        assert 1 <= t.difficulty.level <= 5
        assert t.difficulty.reasons


def test_flat_boardwalk_is_level_1():
    assert store.get("millbrook-marsh").difficulty.level == 1


def test_ridge_loop_gets_terrain_bump():
    t = store.get("shingletown-ridge-loop")
    assert t.difficulty.terrain_bump == 1
    assert t.difficulty.level >= 4


def test_effort_formula():
    t = store.get("mt-nittany-mike-lynch")
    assert effort_miles(t) == round(2.3 + 650 / 500, 2)


def test_car_free_filter_only_returns_reachable():
    for t in store.search(car_free=True, limit=50):
        assert t.car_free
