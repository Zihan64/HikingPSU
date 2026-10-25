"""Authorized simulator still uses the actual badge rules and only memory data."""
import datetime as dt
import pytest
from fastapi.testclient import TestClient

pytest.importorskip('authlib')
from app import checkins, db, store
from app.main import app as production_app
from dev.badge_lab import create_app, DATABASE
from tests.devtools_helpers import configure, login, ALICE, BOB, ORIGIN

TRAIL = 'mt-nittany-mike-lynch'
RATING = {'accuracy':4,'difficulty':3,'enjoyment':5,'comment':'Simulator test'}
API = '/__badge_lab_api'


@pytest.fixture
def lab(monkeypatch,tmp_path):
    monkeypatch.setattr(db,'_client',db._client)
    monkeypatch.setattr(db,'_indexed',db._indexed)
    monkeypatch.setattr(checkins,'now',checkins.now)
    monkeypatch.setenv('MONGODB_DB','production_must_not_be_used')
    monkeypatch.setenv('MONGODB_URI','mongodb://production.invalid:27017')
    monkeypatch.setenv('DEMO_MODE','0')
    configure(monkeypatch,tmp_path)
    def forbidden(*args,**kwargs): raise AssertionError('Must never connect to a real MongoDB')
    monkeypatch.setattr(db,'MongoClient',forbidden)
    app=create_app()
    with TestClient(app,base_url=ORIGIN) as client:
        yield client,login(client,app),app


def start(client,headers,trail_id=TRAIL,**changes):
    t=store.get(trail_id)
    body={'trail_id':trail_id,'lat':t.trailhead.lat,'lon':t.trailhead.lon,'accuracy_m':15}
    body.update(changes)
    return client.post(API+'/me/checkins',headers=headers,json=body)


def test_production_has_no_developer_routes_and_factory_requires_complete_config(monkeypatch):
    assert not any(getattr(route,'path','').startswith(('/__lab','/devtools','/__badge_lab_api')) for route in production_app.routes)
    monkeypatch.delenv('DEVTOOLS_ENABLED',raising=False)
    with pytest.raises(RuntimeError,match='require'): create_app()


def test_real_finish_rating_badge_reset_and_other_contributor_isolation(lab):
    client,headers,app=lab
    bob_headers=login(client,app,BOB)
    bob=start(client,bob_headers)
    assert bob.status_code==201
    headers=login(client,app,ALICE)
    created=start(client,headers)
    assert created.status_code==201
    id=created.json()['id']
    assert client.post(API+f'/me/checkins/{id}/finish',headers=headers,json=RATING).status_code==409
    assert client.post(API+'/__lab/ready',headers=headers,json={}).status_code==200
    done=client.post(API+f'/me/checkins/{id}/finish',headers=headers,json=RATING)
    assert done.status_code==200,done.text
    assert any(b['key']==f'trail:{TRAIL}' for b in done.json()['new_badges'])
    assert client.get(API+'/me/badges').json()['completed_trails']==1
    assert client.get(API+f'/trails/{TRAIL}/reviews').json()['summary']['count']==1
    assert client.get(API+'/me/hikes').json()
    state=client.post(API+'/__lab/reset',headers=headers,json={}).json()
    assert state['completed']==state['badges']==state['offset_ms']==0
    assert client.get(API+'/me/hikes').json()==[]
    assert db.get_db().name==DATABASE
    bob_headers=login(client,app,BOB)
    bob_state=client.get(API+'/__lab/state').json()
    assert bob_state['active']['id']==bob.json()['id']
    assert bob_state['offset_ms']==0


def test_real_location_rules_expiry_and_no_badges_for_expired_hike(lab):
    client,headers,_=lab
    assert start(client,headers,accuracy_m=250).status_code==422
    assert start(client,headers,lat=41.8).status_code==422
    assert start(client,headers).status_code==201
    assert client.post(API+'/__lab/advance',headers=headers,json={'minutes':1500}).status_code==200
    assert client.get(API+'/me/checkins/active').json() is None
    assert client.get(API+'/me/badges').json()['badges']==[]


def test_daily_limit_and_next_day_continue_to_use_actual_rules(lab):
    client,headers,_=lab
    current=dt.datetime.fromtimestamp(client.get(API+'/__lab/state').json()['now_ms']/1000,dt.timezone.utc)
    tomorrow=current.astimezone(checkins.LOCAL_TZ).date()+dt.timedelta(days=1)
    morning=dt.datetime.combine(tomorrow,dt.time(10),checkins.LOCAL_TZ)
    client.post(API+'/__lab/advance',headers=headers,json={'minutes':(morning-current).total_seconds()/60})
    for _ in range(2):
        created=start(client,headers)
        assert created.status_code==201
        client.post(API+'/__lab/ready',headers=headers,json={})
        assert client.post(API+f"/me/checkins/{created.json()['id']}/finish",headers=headers,json=RATING).status_code==200
    assert start(client,headers).status_code==429
    client.post(API+'/__lab/advance',headers=headers,json={'minutes':1440})
    assert start(client,headers).status_code==201


def test_private_app_cannot_delete_real_accounts_and_csrf_cannot_login_to_production(lab):
    client,headers,_=lab
    assert client.delete(API+'/me',headers=headers).status_code==403
    assert client.post(API+'/__lab/advance',headers=headers,json={'minutes':-1}).status_code==422
    assert not production_app.dependency_overrides
    with TestClient(production_app) as production:
        assert production.get('/__lab/session').status_code==404
        assert production.get('/me/badges',headers=headers).status_code in {401,503}
