"""Simulator uses real check-in endpoints/rules, but only a disposable memory DB."""
import datetime as dt
import pytest
from fastapi.testclient import TestClient

from app import checkins, db, store
from app.main import app as production_app
from dev.badge_lab import create_app, DATABASE

TRAIL = 'mt-nittany-mike-lynch'
RATING = {'accuracy':4,'difficulty':3,'enjoyment':5,'comment':'Simulator test'}


@pytest.fixture
def lab(monkeypatch):
    # Restore every process-wide dependency after this dedicated-app test.
    monkeypatch.setattr(db,'_client',db._client)
    monkeypatch.setattr(db,'_indexed',db._indexed)
    monkeypatch.setattr(checkins,'now',checkins.now)
    monkeypatch.setenv('HIKINGPSU_BADGE_LAB','1')
    monkeypatch.setenv('HIKINGPSU_ENV','development')
    monkeypatch.delenv('RENDER',raising=False)
    monkeypatch.delenv('AWS_EXECUTION_ENV',raising=False)
    monkeypatch.setenv('MONGODB_DB','production_must_not_be_used')
    monkeypatch.setenv('MONGODB_URI','mongodb://production.invalid:27017')
    monkeypatch.setenv('DEMO_MODE','0')
    def forbidden(*args,**kwargs):
        raise AssertionError('Simulator must never create a real MongoClient')
    monkeypatch.setattr(db,'MongoClient',forbidden)
    app = create_app()
    with TestClient(app,base_url='http://127.0.0.1:8010') as client:
        session = client.get('/__lab/session').json()
        yield client, {'Authorization':f"Bearer {session['token']}"}, app


def start(client,headers,trail_id=TRAIL,**changes):
    t=store.get(trail_id)
    body={'trail_id':trail_id,'lat':t.trailhead.lat,'lon':t.trailhead.lon,'accuracy_m':15}
    body.update(changes)
    return client.post('/me/checkins',headers=headers,json=body)


def test_production_never_registers_simulator_routes_and_factory_requires_opt_in(monkeypatch):
    assert not any(getattr(route,'path','').startswith('/__lab') for route in production_app.routes)
    monkeypatch.delenv('HIKINGPSU_BADGE_LAB',raising=False)
    with pytest.raises(RuntimeError,match='requires'):
        create_app()


def test_hosted_environment_refuses_simulator_even_with_flags(monkeypatch):
    monkeypatch.setenv('HIKINGPSU_BADGE_LAB','1');monkeypatch.setenv('HIKINGPSU_ENV','development')
    monkeypatch.setenv('RENDER','true')
    with pytest.raises(RuntimeError,match='hosted'):
        create_app()


def test_real_checkin_finish_rating_badge_and_reset_flow(lab):
    client,headers,app=lab
    created=start(client,headers)
    assert created.status_code==201
    id=created.json()['id']
    assert client.post(f'/me/checkins/{id}/finish',headers=headers,json=RATING).status_code==409
    assert client.post('/__lab/ready',headers=headers,json={}).status_code==200
    done=client.post(f'/me/checkins/{id}/finish',headers=headers,json=RATING)
    assert done.status_code==200,done.text
    assert any(b['key']==f'trail:{TRAIL}' for b in done.json()['new_badges'])
    assert client.get('/me/badges',headers=headers).json()['completed_trails']==1
    assert client.get(f'/trails/{TRAIL}/reviews',headers=headers).json()['summary']['count']==1
    assert client.get('/me/hikes',headers=headers).json()
    app.state.badge_lab_client['unrelated_memory_db'].sentinel.insert_one({'keep':True})
    reset=client.post('/__lab/reset',headers=headers,json={})
    assert reset.status_code==200 and reset.json()['completed']==reset.json()['badges']==0
    assert client.get(f'/trails/{TRAIL}/reviews',headers=headers).json()['summary']['count']==0
    assert client.get('/me/hikes',headers=headers).json()==[]
    assert app.state.badge_lab_client['unrelated_memory_db'].sentinel.count_documents({})==1
    assert db.get_db().name==DATABASE


def test_location_rules_and_expiry_are_not_relaxed(lab):
    client,headers,_=lab
    assert start(client,headers,accuracy_m=250).status_code==422
    assert start(client,headers,lat=41.8).status_code==422
    assert start(client,headers).status_code==201
    assert client.post('/__lab/advance',headers=headers,json={'minutes':1500}).status_code==200
    assert client.get('/me/checkins/active',headers=headers).json() is None
    assert client.get('/me/badges',headers=headers).json()['badges']==[]


def test_daily_limit_still_applies_and_next_day_allows_another_hike(lab):
    client,headers,_=lab
    current=dt.datetime.fromtimestamp(client.get('/__lab/state',headers=headers).json()['now_ms']/1000,dt.timezone.utc)
    tomorrow=current.astimezone(checkins.LOCAL_TZ).date()+dt.timedelta(days=1)
    morning=dt.datetime.combine(tomorrow,dt.time(10),checkins.LOCAL_TZ)
    client.post('/__lab/advance',headers=headers,json={'minutes':(morning-current).total_seconds()/60})
    for _ in range(2):
        created=start(client,headers)
        assert created.status_code==201
        client.post('/__lab/ready',headers=headers,json={})
        assert client.post(f"/me/checkins/{created.json()['id']}/finish",headers=headers,json=RATING).status_code==200
    assert start(client,headers).status_code==429
    client.post('/__lab/advance',headers=headers,json={'minutes':1440})
    assert start(client,headers).status_code==201


def test_dev_controls_require_session_and_reject_cross_site_or_foreign_hosts(lab):
    client,headers,_=lab
    assert client.post('/__lab/reset',json={}).status_code==401
    assert client.post('/__lab/advance',json={'minutes':1},headers={'Authorization':'Bearer wrong'}).status_code==401
    assert client.get('/__lab/session',headers={'Origin':'https://unrelated.example'}).status_code==403
    assert client.get('/__lab/session',headers={'Sec-Fetch-Site':'cross-site'}).status_code==403
    assert client.get('/__lab/session',headers={'Host':'unrelated.example'}).status_code==400
    assert client.post('/__lab/advance',headers=headers,json={'minutes':-1}).status_code==422
    assert client.post('/__lab/advance',headers=headers,json={'minutes':10081}).status_code==422
    assert client.delete('/me',headers=headers).status_code==403


def test_same_lab_token_does_not_authenticate_production_app(lab):
    _,headers,_=lab
    assert not production_app.dependency_overrides
    with TestClient(production_app) as client:
        assert client.get('/__lab/session').status_code==404
        assert client.get('/me/badges',headers=headers).status_code in {401,503}
