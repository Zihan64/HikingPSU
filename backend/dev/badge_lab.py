"""Authorized development application, separate from app.main and production data."""
from __future__ import annotations

import contextvars
import datetime as dt
import hashlib
import os
import threading
from collections import defaultdict
from urllib.parse import urlparse

import mongomock
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .access import RESET, SIMULATE, LOGIN_PAGE, AccessGateway, Settings

DATABASE = 'hikingpsu_devtools_memory'


class Advance(BaseModel):
    minutes: float = Field(gt=0, le=10080, allow_inf_nan=False)


def simulation_uid(sub):
    return 'badge-lab|' + hashlib.sha256(sub.encode()).hexdigest()[:24]


def create_simulator() -> FastAPI:
    """Internal app. Every request requires a principal injected by the outer gateway."""
    os.environ['MONGODB_DB'] = DATABASE
    os.environ['DEMO_MODE'] = '1'
    from app import auth, checkins, db, users
    from app.main import app as production
    app = FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    app.include_router(production.router)
    app.router.routes = [route for route in app.router.routes if getattr(route,'path','') not in {'/docs','/redoc','/openapi.json','/docs/oauth2-redirect'}]
    app.exception_handlers.update(production.exception_handlers)
    client = mongomock.MongoClient()
    db.set_client(client)
    actor = contextvars.ContextVar('devtools_simulation_user',default=None)
    offsets = defaultdict(dt.timedelta)
    lock = threading.RLock()

    def clock():
        with lock: return dt.datetime.now(dt.timezone.utc) + offsets[actor.get()]
    checkins.now = clock

    def principal(request: Request):
        value = getattr(request.state,'developer',None)
        if not value or SIMULATE not in value['permissions']:
            raise HTTPException(401,'An authorized developer session is required')
        return value

    def identity(request: Request):
        return simulation_uid(principal(request)['sub'])

    def seed(uid):
        user = users.get_or_create(uid,email=None,name='Badge Lab Tester')
        db.get_db().users.update_one({'_id':uid},{'$set':{'registered_at':clock(),
            'profile.fitness':2,'preferences.max_level':5,'preferences.transit_modes':['car','walk','bus','bike']}})
        return user

    def user(request: Request):
        uid = identity(request)
        return users.get(uid) or seed(uid)

    app.dependency_overrides[auth.current_user_id] = identity
    app.dependency_overrides[auth.current_user_id_optional] = identity
    app.dependency_overrides[auth.current_user] = user

    @app.middleware('http')
    async def bind_actor(request,call_next):
        try: uid = identity(request)
        except HTTPException as error: return JSONResponse({'detail':error.detail},status_code=error.status_code)
        local_path = request.url.path.removeprefix(request.scope.get('root_path',''))
        if request.method == 'DELETE' and local_path == '/me':
            return JSONResponse({'detail':'Real account deletion is disabled; use the test reset control'},status_code=403)
        binding = actor.set(uid)
        try:
            if not users.get(uid): seed(uid)
            return await call_next(request)
        finally: actor.reset(binding)

    def state(uid):
        active = checkins.get_active(uid)
        return {'now_ms':int(clock().timestamp()*1000),'offset_ms':int(offsets[uid].total_seconds()*1000),
                'active':checkins.to_out(active) if active else None,
                'completed':db.get_db().checkins.count_documents({'user_id':uid,'status':'completed'}),
                'badges':db.get_db().badges.count_documents({'user_id':uid}),
                'storage':'per-contributor synthetic user in a separate in-memory test database'}

    @app.get('/__lab/session')
    def session(request: Request,uid: str = Depends(identity)):
        developer = principal(request)
        return {'token':developer['csrf'],'user_id':uid,'rules':checkins.RULES,
                'developer':developer['name'],'permissions':sorted(developer['permissions']),**state(uid)}

    @app.get('/__lab/state')
    def current_state(uid: str = Depends(identity)):
        return state(uid)

    @app.post('/__lab/advance')
    def advance(body: Advance,uid: str = Depends(identity)):
        with lock:
            offsets[uid] += dt.timedelta(minutes=body.minutes)
            return state(uid)

    @app.post('/__lab/ready')
    def ready(uid: str = Depends(identity)):
        with lock:
            active = checkins.get_active(uid)
            if not active: raise HTTPException(409,'Start a check-in before advancing to its finish time')
            target = checkins.utc(active['finish_after']) + dt.timedelta(seconds=1)
            offsets[uid] += max(dt.timedelta(),target-clock())
            return state(uid)

    @app.post('/__lab/reset')
    def reset(request: Request,uid: str = Depends(identity)):
        if RESET not in principal(request)['permissions']:
            raise HTTPException(403,'Test data reset permission is required')
        with lock:
            for collection in ['checkins','badges','reviews','hike_logs','likes','chat_sessions']:
                db.get_db()[collection].delete_many({'user_id':uid})
            db.get_db().checkin_locks.delete_one({'_id':uid})
            db.get_db().users.delete_one({'_id':uid})
            offsets[uid] = dt.timedelta()
            seed(uid)
            return state(uid)

    app.state.badge_lab_client = client
    return app


def create_app() -> FastAPI:
    settings = Settings.from_env()
    gateway = AccessGateway(settings)
    app = FastAPI(title='HikingPSU authorized developer tools',docs_url=None,redoc_url=None,openapi_url=None)
    app.state.devtools = gateway

    @app.middleware('http')
    async def protect(request,call_next):
        path = request.url.path
        public = request.method == 'GET' and path in {'/devtools/login','/devtools/callback','/devtools/health'}
        try:
            if not public:
                gateway.authenticate(request)
                permissions = request.state.developer['permissions']
                if path.startswith('/__badge_lab_api') and SIMULATE not in permissions:
                    raise HTTPException(403,'Simulation permission is required')
                if path == '/__badge_lab_api/__lab/reset' and RESET not in permissions:
                    raise HTTPException(403,'Test data reset permission is required')
            response = await call_next(request)
        except HTTPException as error:
            if error.status_code == 401 and path == '/' and request.method == 'GET' and 'text/html' in request.headers.get('accept',''):
                response = HTMLResponse(LOGIN_PAGE)
            else: response = JSONResponse({'detail':error.detail},status_code=error.status_code)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Vary'] = 'Cookie, Authorization'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'no-referrer'
        if not public: gateway.audit(request,response.status_code)
        return response

    app.add_middleware(SessionMiddleware,secret_key=settings.session_secret,session_cookie='hikingpsu_devtools_login',
                       max_age=600,same_site='lax',https_only=settings.secure)
    app.add_middleware(TrustedHostMiddleware,allowed_hosts=[urlparse(settings.origin).hostname])

    app.add_api_route('/devtools/login',gateway.login,methods=['GET'])
    app.add_api_route('/devtools/callback',gateway.callback,methods=['GET'])
    app.add_api_route('/devtools/logout',gateway.logout,methods=['POST'])

    @app.get('/devtools/health')
    def health():
        return {'ok':True,'environment':'development','access':'authorization required'}

    @app.get('/')
    def index():
        return FileResponse(settings.assets/'dev'/'badge-lab.html')

    simulator = create_simulator()
    app.state.simulator = simulator
    app.mount('/__badge_lab_api',simulator)
    app.mount('/',StaticFiles(directory=settings.assets,follow_symlink=False))
    return app
