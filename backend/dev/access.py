"""Real-identity gateway for the separately deployed development tools.

Auth0 tokens stay server-side. Browsers receive only an opaque HttpOnly session
cookie and a session-bound CSRF capability. No production app imports this file.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import jwt
from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

ACCESS = 'devtools:access'
SIMULATE = 'simulation:use'
RESET = 'testdata:reset'
PERMISSIONS = {ACCESS, SIMULATE, RESET}
log = logging.getLogger('hikingpsu.devtools.audit')


@dataclass(frozen=True)
class Settings:
    origin: str
    domain: str
    client_id: str
    client_secret: str
    audience: str
    production_audience: str
    session_secret: str
    allowlist: Path
    assets: Path
    session_seconds: int = 900

    @classmethod
    def from_env(cls):
        if os.getenv('HIKINGPSU_ENV') != 'development' or os.getenv('DEVTOOLS_ENABLED') != '1':
            raise RuntimeError('Developer tools require HIKINGPSU_ENV=development and DEVTOOLS_ENABLED=1')
        names = ['ORIGIN','AUTH0_DOMAIN','AUTH0_CLIENT_ID','AUTH0_CLIENT_SECRET','AUTH0_AUDIENCE',
                 'PRODUCTION_AUDIENCE','PRODUCTION_CLIENT_ID','SESSION_SECRET','ALLOWLIST_FILE','ASSET_DIR']
        values = {name:os.getenv('DEVTOOLS_'+name,'').strip() for name in names}
        if any(not value for value in values.values()):
            raise RuntimeError('Developer tools configuration is incomplete; see .env.devtools.example. Access is disabled.')
        origin = values['ORIGIN'].rstrip('/')
        parsed = urlparse(origin)
        local = parsed.hostname in {'127.0.0.1','localhost'}
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {'','/'}:
            raise RuntimeError('DEVTOOLS_ORIGIN must be one exact origin without a path')
        if parsed.scheme != 'https' and not (local and parsed.scheme == 'http'):
            raise RuntimeError('Hosted developer tools require HTTPS')
        domain = values['AUTH0_DOMAIN']
        if not domain or any(char in domain for char in '/:@?# ') or '.' not in domain:
            raise RuntimeError('DEVTOOLS_AUTH0_DOMAIN must be a trusted Auth0/custom hostname')
        if values['AUTH0_AUDIENCE'] == values['PRODUCTION_AUDIENCE'] or values['AUTH0_CLIENT_ID'] == values['PRODUCTION_CLIENT_ID']:
            raise RuntimeError('Developer tools must use a separate Auth0 application and API audience')
        if len(values['SESSION_SECRET']) < 32:
            raise RuntimeError('DEVTOOLS_SESSION_SECRET must contain at least 32 random characters')
        allowlist, assets = Path(values['ALLOWLIST_FILE']).resolve(), Path(values['ASSET_DIR']).resolve()
        if not allowlist.is_file() or not (assets/'dev'/'badge-lab.html').is_file():
            raise RuntimeError('Allowlist or private developer build missing; access is disabled')
        settings = cls(origin,domain,values['AUTH0_CLIENT_ID'],values['AUTH0_CLIENT_SECRET'],values['AUTH0_AUDIENCE'],
                       values['PRODUCTION_AUDIENCE'],values['SESSION_SECRET'],allowlist,assets)
        settings.policy()  # malformed startup policy is an error, never an allow-all fallback
        return settings

    @property
    def secure(self):
        return self.origin.startswith('https://')

    def policy(self):
        try:
            if self.allowlist.stat().st_size > 100_000:
                raise ValueError('oversize policy')
            data = json.loads(self.allowlist.read_text(encoding='utf-8-sig'))
            users = data['users']
            if not isinstance(users,dict): raise ValueError('users must be a mapping')
            for sub, entry in users.items():
                if not isinstance(sub,str) or not sub or not isinstance(entry,dict): raise ValueError('invalid subject')
                if type(entry.get('enabled')) is not bool or not isinstance(entry.get('permissions'),list): raise ValueError('invalid entry')
                if any(not isinstance(p,str) or p not in PERMISSIONS for p in entry['permissions']): raise ValueError('unknown permission')
            return users
        except (OSError,ValueError,KeyError,TypeError) as error:
            raise RuntimeError('Developer allowlist is unavailable or malformed; access is denied') from error


class AccessGateway:
    cookie = 'hikingpsu_devtools_session'

    def __init__(self, settings: Settings):
        self.settings = settings
        self.oauth = OAuth()
        self.remote = self.oauth.register('auth0',client_id=settings.client_id,client_secret=settings.client_secret,
            server_metadata_url=f'https://{settings.domain}/.well-known/openid-configuration',
            client_kwargs={'scope':'openid profile '+ ' '.join(sorted(PERMISSIONS)),
                           'code_challenge_method':'S256','token_endpoint_auth_method':'client_secret_post'})
        self.jwks = jwt.PyJWKClient(f'https://{settings.domain}/.well-known/jwks.json',cache_keys=True)
        self.sessions = {}
        self.lock = threading.RLock()

    def permissions(self, claims):
        # Read on every request; a removed/disabled subject loses access without
        # waiting for the previously issued Auth0 token or cookie to expire.
        try: entry = self.settings.policy().get(claims['sub'])
        except RuntimeError as error: raise HTTPException(503,'Developer access policy is unavailable') from error
        if not entry or not entry['enabled']:
            raise HTTPException(403,'This account is not authorized for developer tools')
        issued = claims.get('permissions',[])
        if not isinstance(issued,list) or any(not isinstance(value,str) for value in issued):
            raise HTTPException(403,'Developer token has no usable permissions')
        permitted = set(issued) & set(entry['permissions'])
        if ACCESS not in permitted:
            raise HTTPException(403,'Developer access permission is required')
        return permitted

    def verify(self, token):
        try:
            key = self.jwks.get_signing_key_from_jwt(token).key
            claims = jwt.decode(token,key,algorithms=['RS256'],issuer=f'https://{self.settings.domain}/',
                audience=self.settings.audience,options={'require':['exp','iat','sub']})
            audiences = claims['aud'] if isinstance(claims['aud'],list) else [claims['aud']]
            if self.settings.production_audience in audiences or not isinstance(claims['sub'],str) or not claims['sub']:
                raise ValueError('production or missing subject')
            clients = [claims[key] for key in ['azp','client_id'] if key in claims]
            if not clients or any(client != self.settings.client_id for client in clients):
                raise ValueError('wrong client')
            return claims
        except (jwt.PyJWTError,ValueError,KeyError,TypeError) as error:
            raise HTTPException(401,'Developer identity could not be verified') from error

    def issue(self, claims, name='Authorized contributor'):
        self.permissions(claims)
        now = time.time()
        with self.lock:
            self.sessions = {key:value for key,value in self.sessions.items() if value['expires'] > now}
            if len(self.sessions) >= 1000:
                raise HTTPException(503,'Developer session capacity reached')
            session_id = secrets.token_urlsafe(32)
            session = {'claims':claims, 'csrf':secrets.token_urlsafe(32), 'name':str(name)[:120],
                       'expires':min(float(claims['exp']),now+self.settings.session_seconds)}
            self.sessions[session_id] = session
        return session_id, session

    def authenticate(self, request):
        if request.headers.get('origin') not in {None,self.settings.origin}:
            raise HTTPException(403,'Developer request origin rejected')
        session_id = request.cookies.get(self.cookie,'')
        with self.lock: session = self.sessions.get(session_id)
        if not session or session['expires'] <= time.time():
            if session:
                with self.lock: self.sessions.pop(session_id,None)
            raise HTTPException(401,'Developer login required')
        permissions = self.permissions(session['claims'])
        request.state.developer = {'sub':session['claims']['sub'], 'name':session['name'],
                                   'permissions':permissions,'csrf':session['csrf']}
        if request.method not in {'GET','HEAD','OPTIONS'}:
            if request.headers.get('origin') != self.settings.origin:
                raise HTTPException(403,'Developer action origin rejected')
            supplied = request.headers.get('authorization','')
            if not secrets.compare_digest(supplied,'Bearer '+session['csrf']):
                raise HTTPException(403,'Developer action CSRF check failed')
        return session

    @staticmethod
    def audit(request, result):
        principal = getattr(request.state,'developer',{})
        actor = hashlib.sha256(principal.get('sub','anonymous').encode()).hexdigest()[:12]
        log.info('actor=%s method=%s path=%s status=%s',actor,request.method,request.url.path,result)

    async def login(self, request: Request):
        # Clear an abandoned pre-login flow and let Authlib create state/nonce/PKCE.
        request.session.clear()
        try:
            return await self.remote.authorize_redirect(request,self.settings.origin+'/devtools/callback',
                                                        audience=self.settings.audience)
        except Exception as error:
            log.warning('Developer login provider unavailable (%s)',type(error).__name__)
            raise HTTPException(503,'Developer login provider is unavailable') from error

    async def callback(self, request: Request):
        try:
            token = await self.remote.authorize_access_token(request)
            claims = self.verify(token['access_token'])
            if token.get('userinfo',{}).get('sub') != claims['sub']:
                raise HTTPException(401,'Identity token and access token do not match')
            session_id, session = self.issue(claims,token['userinfo'].get('name','Authorized contributor'))
        except HTTPException:
            raise
        except (OAuthError,KeyError,ValueError) as error:
            raise HTTPException(401,'Developer login was rejected; start a fresh login') from error
        except Exception as error:
            log.warning('Developer callback failed (%s)',type(error).__name__)
            raise HTTPException(503,'Developer login could not be completed') from error
        finally:
            request.session.clear()
        response = RedirectResponse('/',status_code=303)
        response.set_cookie(self.cookie,session_id,httponly=True,secure=self.settings.secure,samesite='lax',
                            max_age=max(1,int(session['expires']-time.time())),path='/')
        log.info('developer_login_succeeded actor=%s',hashlib.sha256(claims['sub'].encode()).hexdigest()[:12])
        return response

    def logout(self, request: Request):
        with self.lock: self.sessions.pop(request.cookies.get(self.cookie,''),None)
        request.session.clear()
        response = Response(status_code=204)
        response.delete_cookie(self.cookie,path='/',secure=self.settings.secure,httponly=True,samesite='lax')
        return response


LOGIN_PAGE = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HikingPSU 开发者登录</title>
<body style="font:16px/1.7 system-ui;max-width:620px;margin:12vh auto;padding:24px;color:#173a40"><h1>HikingPSU 开发工具</h1>
<p>此站点仅限已授权的 contributor。登录后仍需通过服务端允许名单和权限检查。</p><p>测试数据与正式用户数据分开。</p>
<a href="/devtools/login" style="display:inline-block;padding:12px 20px;background:#2f6b47;color:white;border-radius:10px">使用 Auth0 登录</a></body></html>'''
