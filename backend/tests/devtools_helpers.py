import json
import time

import jwt

from tests.conftest import KEY

ALICE = 'auth0|approved-alice'
BOB = 'google-oauth2|approved-bob'
ORIGIN = 'http://127.0.0.1:5176'
DOMAIN = 'developer-tenant.us.auth0.com'
AUDIENCE = 'https://api.example.invalid/developer-tools'
PERMISSIONS = ['devtools:access','simulation:use','testdata:reset']


def configure(monkeypatch,tmp_path):
    assets = tmp_path/'private-assets'
    (assets/'dev').mkdir(parents=True)
    (assets/'assets').mkdir()
    (assets/'dev/badge-lab.html').write_text('PRIVATE_DEVELOPER_HTML',encoding='utf-8')
    (assets/'assets/private.js').write_text('PRIVATE_DEVELOPER_JAVASCRIPT',encoding='utf-8')
    policy = tmp_path/'allowlist.json'
    policy.write_text(json.dumps({'users':{sub:{'enabled':True,'permissions':PERMISSIONS} for sub in [ALICE,BOB]}}),encoding='utf-8')
    values = {'HIKINGPSU_ENV':'development','DEVTOOLS_ENABLED':'1','DEVTOOLS_ORIGIN':ORIGIN,
        'DEVTOOLS_AUTH0_DOMAIN':DOMAIN,'DEVTOOLS_AUTH0_CLIENT_ID':'developer-web-client',
        'DEVTOOLS_AUTH0_CLIENT_SECRET':'fake-server-side-client-secret','DEVTOOLS_AUTH0_AUDIENCE':AUDIENCE,
        'DEVTOOLS_PRODUCTION_AUDIENCE':'https://api.example.invalid/production',
        'DEVTOOLS_PRODUCTION_CLIENT_ID':'production-spa',
        'DEVTOOLS_SESSION_SECRET':'fake-session-secret-for-tests-only-'*2,
        'DEVTOOLS_ALLOWLIST_FILE':str(policy),'DEVTOOLS_ASSET_DIR':str(assets)}
    for name,value in values.items(): monkeypatch.setenv(name,value)
    return policy


def access_token(sub=ALICE,**overrides):
    now=int(time.time())
    claims={'iss':f'https://{DOMAIN}/','aud':AUDIENCE,'sub':sub,'iat':now,'exp':now+3600,
            'azp':'developer-web-client','permissions':PERMISSIONS}
    claims.update(overrides)
    return jwt.encode(claims,KEY,algorithm='RS256',headers={'kid':'test-signing-key'})


def login(client,app,sub=ALICE,**overrides):
    gateway=app.state.devtools
    gateway.jwks.get_signing_key_from_jwt=lambda token:type('SigningKey',(),{'key':KEY.public_key()})()
    claims=gateway.verify(access_token(sub,**overrides))
    session_id,session=gateway.issue(claims,'Contributor test identity')
    client.cookies.set(gateway.cookie,session_id,domain='127.0.0.1',path='/')
    return {'Origin':ORIGIN,'Authorization':'Bearer '+session['csrf']}
