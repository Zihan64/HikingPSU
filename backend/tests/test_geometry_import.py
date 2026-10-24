import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('osm_import', Path(__file__).parents[1]/'scripts/fetch_osm_trails.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_shared_endpoints_merge_but_disconnected_geometry_never_gets_a_connector():
    a, b, c, far, end = (40.,-77.), (40.001,-77.), (40.002,-77.), (41.,-78.), (41.001,-78.)
    lines = module.connected_lines([[a,b], [c,b], [far,end]])
    assert len(lines) == 2
    assert [a,b,c] in lines
    assert [far,end] in lines


def test_samples_have_cumulative_distances_and_endpoints():
    line = [(40.,-77.), (40.01,-77.), (40.01,-77.01)]
    points, distances = module.profile_samples(line)
    assert points[0] == line[0] and points[-1] == line[-1]
    assert distances[0] == 0
    assert all(a < b for a,b in zip(distances,distances[1:]))
    assert all(abs(d-i*.1) < .0001 for i,d in enumerate(distances[:-1]))
