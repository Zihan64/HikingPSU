import base64
import hashlib
import importlib
import json
import time
from dataclasses import replace
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

pytest.importorskip('authlib')
from authlib.integrations.httpx_client import AsyncOAuth2Client
from app import checkins, db
from dev.access import Settings
from dev.badge_lab import create_app, create_simulator
from tests.conftest import KEY
from tests.devtools_helpers import ALICE, BOB, AUDIENCE, DOMAIN, ORIGIN, PERMISSIONS, access_token, configure, login


@pytest.fixture
def portal(monkeypatch,tmp_path):
    monkeypatch.setattr(db,'_client',db._client)
    monkeypatch.setattr(db,'_indexed',db._indexed)
    monkeypatch.setattr(checkins,'now',checkins.now)
    monkeypatch.setenv('MONGODB_DB','production_must_not_be_used')
    monkeypatch.setenv('DEMO_MODE','0')
    policy=configure(monkeypatch,tmp_path)
    app=create_app()
    with TestClient(app,base_url=ORIGIN) as client:
        yield client,app,policy


def test_anonymous_cannot_fetch_html_js_configs_bootstrap_or_call_simulation(portal):
    client,_,_=portal
    response=client.get('/',headers={'Accept':'text/html'})
    assert response.status_code==200 and '/devtools/login' in response.text
    assert 'PRIVATE_DEVELOPER_HTML' not in response.text
    for path in ['/dev/badge-lab.html','/assets/private.js','/__badge_lab_api/__lab/session',
                 '/__badge_lab_api/trails','/backend/.env.devtools.local','/devtools.allowlist.example.json']:
        response=client.get(path,headers={'X-Developer':'true'})
        assert response.status_code==401
        assert 'PRIVATE_DEVELOPER' not in response.text
        assert response.headers['cache-control']=='no-store'
    assert client.post('/__badge_lab_api/__lab/reset',json={}).status_code==401


def test_allowlist_and_auth0_permissions_are_both_required_and_revocation_is_live(portal):
    client,app,policy=portal
    gateway=app.state.devtools
    gateway.jwks.get_signing_key_from_jwt=lambda token:type('Key',(),{'key':KEY.public_key()})()
    with pytest.raises(HTTPException) as denied:
        gateway.issue(gateway.verify(access_token('auth0|not-approved')))
    assert denied.value.status_code==403
    with pytest.raises(HTTPException): login(client,app,permissions=[])
    login(client,app)
    assert client.get('/assets/private.js').text=='PRIVATE_DEVELOPER_JAVASCRIPT'
    assert client.get('/').text=='PRIVATE_DEVELOPER_HTML'
    data=json.loads(policy.read_text());data['users'][ALICE]['enabled']=False
    policy.write_text(json.dumps(data))
    assert client.get('/assets/private.js').status_code==403
    assert client.get('/__badge_lab_api/__lab/session').status_code==403
    policy.write_text('{invalid')
    assert client.get('/dev/badge-lab.html').status_code==503


def test_mutations_need_cookie_csrf_and_exact_origin_and_logout_revokes_session(portal):
    client,app,_=portal
    headers=login(client,app)
    path='/__badge_lab_api/__lab/advance'
    assert client.post(path,json={'minutes':1}).status_code==403
    assert client.post(path,json={'minutes':1},headers={**headers,'Origin':'https://untrusted.invalid'}).status_code==403
    assert client.post(path,json={'minutes':1},headers={**headers,'Authorization':'Bearer wrong'}).status_code==403
    assert client.post(path,json={'minutes':1},headers=headers).status_code==200
    session_id=client.cookies.get(app.state.devtools.cookie)
    assert client.post('/devtools/logout',headers=headers).status_code==204
    client.cookies.set(app.state.devtools.cookie,session_id,domain='127.0.0.1',path='/')
    assert client.get('/assets/private.js').status_code==401


def test_permissions_are_enforced_on_api_even_when_ui_is_bypassed(portal):
    client,app,policy=portal
    data=json.loads(policy.read_text())
    data['users'][ALICE]['permissions']=['devtools:access']
    policy.write_text(json.dumps(data))
    headers=login(client,app)
    assert client.get('/assets/private.js').status_code==200
    assert client.get('/__badge_lab_api/__lab/session').status_code==403
    data['users'][ALICE]['permissions']=['devtools:access','simulation:use']
    policy.write_text(json.dumps(data))
    assert client.get('/__badge_lab_api/__lab/session').status_code==200
    assert client.post('/__badge_lab_api/__lab/reset',headers=headers,json={}).status_code==403


@pytest.mark.parametrize('changes',[
    {'aud':'https://api.example.invalid/production'},
    {'aud':[AUDIENCE,'https://api.example.invalid/production']},
    {'iss':'https://wrong-tenant.invalid/'}, {'exp':1}, {'azp':'production-spa'}, {'azp':None},
])
def test_invalid_or_production_tokens_are_refused(portal,changes):
    client,app,_=portal
    gateway=app.state.devtools
    gateway.jwks.get_signing_key_from_jwt=lambda token:type('Key',(),{'key':KEY.public_key()})()
    with pytest.raises(HTTPException) as denied: gateway.verify(access_token(**changes))
    assert denied.value.status_code==401
    assert not gateway.sessions


def test_expired_sessions_do_not_serve_assets(portal):
    client,app,_=portal
    login(client,app)
    app.state.devtools.sessions[client.cookies.get(app.state.devtools.cookie)]['expires']=time.time()-1
    assert client.get('/assets/private.js').status_code==401


def test_shipped_contributor_policy_authorizes_only_listed_signed_identities(portal,monkeypatch):
    client,app,_=portal
    gateway=app.state.devtools
    policy=Path(__file__).resolve().parents[1]/'devtools.allowlist.json'
    monkeypatch.setattr(gateway,'settings',replace(gateway.settings,allowlist=policy))
    users=gateway.settings.policy()
    assert len(users)==4
    for sub in users:
        login(client,app,sub)
        assert client.get('/assets/private.js').status_code==200
        with pytest.raises(HTTPException) as denied:
            login(client,app,sub,permissions=[])
        assert denied.value.status_code==403
    with pytest.raises(HTTPException) as denied:
        login(client,app,'google-oauth2|not-on-the-contributor-list')
    assert denied.value.status_code==403


def test_empty_or_missing_policy_cannot_reuse_an_existing_session(portal):
    client,app,policy=portal
    login(client,app)
    policy.write_text(json.dumps({'users':{}}))
    assert client.get('/assets/private.js').status_code==403
    policy.unlink()
    assert client.get('/__badge_lab_api/__lab/state').status_code==503


def test_only_a_csrf_capability_cannot_authenticate_without_the_session_cookie(portal):
    client,app,_=portal
    headers=login(client,app)
    client.cookies.clear()
    assert client.post('/__badge_lab_api/__lab/advance',json={'minutes':1},headers=headers).status_code==401


def test_configuration_fails_closed_for_missing_values_shared_audience_or_insecure_host(monkeypatch,tmp_path):
    configure(monkeypatch,tmp_path)
    monkeypatch.setenv('DEVTOOLS_AUTH0_AUDIENCE','https://api.example.invalid/production')
    with pytest.raises(RuntimeError,match='separate'): Settings.from_env()
    monkeypatch.setenv('DEVTOOLS_AUTH0_AUDIENCE',AUDIENCE)
    monkeypatch.setenv('DEVTOOLS_AUTH0_CLIENT_ID','production-spa')
    with pytest.raises(RuntimeError,match='separate'): Settings.from_env()
    monkeypatch.setenv('DEVTOOLS_AUTH0_CLIENT_ID','developer-web-client')
    monkeypatch.setenv('DEVTOOLS_ORIGIN','http://developer.example.invalid')
    with pytest.raises(RuntimeError,match='HTTPS'): Settings.from_env()
    monkeypatch.setenv('DEVTOOLS_ORIGIN',ORIGIN)
    monkeypatch.delenv('DEVTOOLS_SESSION_SECRET')
    with pytest.raises(RuntimeError,match='incomplete'): Settings.from_env()


def test_internal_simulator_has_no_standalone_anonymous_bypass(portal):
    _,app,_=portal
    with TestClient(app.state.simulator) as direct:
        assert direct.get('/__lab/session').status_code==401
        assert direct.get('/trails').status_code==401
        assert direct.post('/__lab/reset',json={}).status_code==401


def install_fake_oidc(app,nonce_error=False):
    remote=app.state.devtools.remote
    # Authlib supports both httpx generations; use its actual transport types.
    http=importlib.import_module(next(cls.__module__.split('.')[0] for cls in AsyncOAuth2Client.__mro__ if cls.__name__=='AsyncClient'))
    expected={}
    public_key=jwt.algorithms.RSAAlgorithm.to_jwk(KEY.public_key(),as_dict=True)
    public_key.update(kid='test-signing-key',use='sig',alg='RS256')
    def provider(request):
        expected.setdefault('requests',[]).append(request.url.path)
        if request.url.path=='/.well-known/openid-configuration':
            return http.Response(200,json={'issuer':f'https://{DOMAIN}/','authorization_endpoint':f'https://{DOMAIN}/authorize',
                'token_endpoint':f'https://{DOMAIN}/oauth/token','jwks_uri':f'https://{DOMAIN}/.well-known/jwks.json',
                'id_token_signing_alg_values_supported':['RS256']})
        if request.url.path=='/.well-known/jwks.json': return http.Response(200,json={'keys':[public_key]})
        if request.url.path=='/oauth/token':
            form=parse_qs(request.content.decode())
            challenge=base64.urlsafe_b64encode(hashlib.sha256(form['code_verifier'][0].encode()).digest()).rstrip(b'=').decode()
            assert challenge==expected['code_challenge']
            assert form['redirect_uri']==[ORIGIN+'/devtools/callback']
            assert form['client_secret']==['fake-server-side-client-secret']
            now=int(time.time())
            id_token=jwt.encode({'iss':f'https://{DOMAIN}/','aud':'developer-web-client','sub':ALICE,
                'iat':now,'exp':now+3600,'nonce':'incorrect' if nonce_error else expected['nonce'],'name':'Approved developer'},
                KEY,algorithm='RS256',headers={'kid':'test-signing-key'})
            return http.Response(200,json={'access_token':access_token(),'id_token':id_token,'token_type':'Bearer','expires_in':3600})
        raise AssertionError('Unexpected identity provider request')
    class MockOAuthClient(AsyncOAuth2Client):
        def __init__(self,*args,**kwargs):
            kwargs['transport']=http.MockTransport(provider)
            super().__init__(*args,**kwargs)
    remote.client_cls=MockOAuthClient
    app.state.devtools.jwks.get_signing_key_from_jwt=lambda token:type('Key',(),{'key':KEY.public_key()})()
    return expected


def test_actual_oidc_state_nonce_pkce_exchange_and_secure_session_cookie(portal):
    client,app,_=portal
    expected=install_fake_oidc(app)
    response=client.get('/devtools/login',follow_redirects=False)
    assert response.status_code==302,expected
    query=parse_qs(urlparse(response.headers['location']).query)
    expected.update({key:value[0] for key,value in query.items()})
    assert expected['audience']==AUDIENCE and expected['code_challenge_method']=='S256'
    assert 'client_secret' not in query
    done=client.get('/devtools/callback',params={'code':'one-use-test-code','state':expected['state']},follow_redirects=False)
    assert done.status_code==303,done.text
    assert 'HttpOnly' in done.headers['set-cookie'] and 'SameSite=lax' in done.headers['set-cookie']
    assert 'access_token' not in done.headers['set-cookie']
    assert client.get('/assets/private.js').status_code==200
    # A callback cannot be replayed or initiated from another browser without state.
    assert client.get('/devtools/callback',params={'code':'replay','state':expected['state']}).status_code==401


def test_oidc_wrong_state_or_nonce_never_creates_an_authorized_session(portal):
    client,app,_=portal
    expected=install_fake_oidc(app,nonce_error=True)
    assert client.get('/devtools/callback',params={'code':'forged','state':'invalid'}).status_code==401
    response=client.get('/devtools/login',follow_redirects=False)
    expected.update({key:value[0] for key,value in parse_qs(urlparse(response.headers['location']).query).items()})
    denied=client.get('/devtools/callback',params={'code':'wrong-nonce','state':expected['state']},follow_redirects=False)
    assert denied.status_code in {401,503}
    assert not app.state.devtools.sessions
    assert client.get('/assets/private.js').status_code==401
