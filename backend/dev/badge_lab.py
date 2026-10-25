"""Dedicated, loopback-only badge simulator. Start with scripts/start-badge-lab.ps1.

Production app.main does not import this module or register these endpoints.
All records live in mongomock memory. No Mongo URI, real identity or Auth0 is used.
"""
from __future__ import annotations

import datetime as dt
import os
import secrets
import threading

import mongomock
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

USER_ID = 'badge-lab|tester'
DATABASE = 'hikingpsu_badge_lab'


class Advance(BaseModel):
    minutes: float = Field(gt=0, le=10080, allow_inf_nan=False)


def create_app() -> FastAPI:
    # An explicit opt-in and a separate command are required. Even misconfiguration
    # in a hosted deployment cannot enable this harness in the production app.
    if os.getenv('HIKINGPSU_BADGE_LAB') != '1' or os.getenv('HIKINGPSU_ENV') != 'development':
        raise RuntimeError('Badge Lab requires HIKINGPSU_BADGE_LAB=1 and HIKINGPSU_ENV=development')
    if os.getenv('RENDER') or os.getenv('AWS_EXECUTION_ENV'):
        raise RuntimeError('Badge Lab cannot run on a hosted deployment')
    from app import auth, checkins, db, users
    from app.main import app as production

    # A fresh app copies real endpoint definitions, not the production app object,
    # its CORS policy, or its dependency overrides.
    app = FastAPI(title='HikingPSU Badge Lab — development only', docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(production.router)
    app.exception_handlers.update(production.exception_handlers)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost'])
    client = mongomock.MongoClient()
    db.set_client(client)
    os.environ['MONGODB_DB'] = DATABASE
    os.environ['DEMO_MODE'] = '1'
    token = secrets.token_urlsafe(32)
    lock = threading.RLock()
    offset = dt.timedelta()

    def clock():
        with lock:
            return dt.datetime.now(dt.timezone.utc) + offset
    checkins.now = clock

    def seed():
        user = users.get_or_create(USER_ID, email='tester@example.invalid', name='Badge Lab Tester')
        db.get_db().users.update_one({'_id':USER_ID}, {'$set':{
            'registered_at':clock(), 'profile.fitness':2, 'preferences.max_level':5,
            'preferences.transit_modes':['car','walk','bus','bike']}})
        return user
    seed()

    def require_lab(request: Request):
        supplied = request.headers.get('authorization', '')
        if not secrets.compare_digest(supplied, f'Bearer {token}'):
            raise HTTPException(401, 'Badge Lab session required; reopen the local simulator')

    def identity(request: Request):
        require_lab(request)
        return USER_ID

    def user(request: Request):
        require_lab(request)
        return users.get(USER_ID) or seed()

    def optional_identity(request: Request):
        return identity(request) if request.headers.get('authorization') else None

    app.dependency_overrides[auth.current_user_id] = identity
    app.dependency_overrides[auth.current_user_id_optional] = optional_identity
    app.dependency_overrides[auth.current_user] = user

    @app.middleware('http')
    async def local_only(request: Request, call_next):
        origin = request.headers.get('origin')
        if origin and origin not in {'http://127.0.0.1:5176','http://localhost:5176'}:
            return JSONResponse({'detail':'Badge Lab only accepts the local simulator origin'}, status_code=403)
        if request.headers.get('sec-fetch-site') == 'cross-site':
            return JSONResponse({'detail':'Cross-site simulator requests are blocked'}, status_code=403)
        if request.method == 'DELETE' and request.url.path == '/me':
            return JSONResponse({'detail':'Use Reset test data; real account deletion is disabled in Badge Lab'}, status_code=403)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response

    def state():
        active = checkins.get_active(USER_ID)
        return {'now_ms':int(clock().timestamp()*1000), 'offset_ms':int(offset.total_seconds()*1000),
                'active':checkins.to_out(active) if active else None,
                'completed':db.get_db().checkins.count_documents({'user_id':USER_ID,'status':'completed'}),
                'badges':db.get_db().badges.count_documents({'user_id':USER_ID}),
                'storage':'isolated in-memory test database; discarded on server restart'}

    @app.get('/__lab/session')
    def session():
        return {'token':token, 'user_id':USER_ID, 'rules':checkins.RULES, **state()}

    @app.get('/__lab/state', dependencies=[Depends(require_lab)])
    def current_state():
        return state()

    @app.post('/__lab/advance', dependencies=[Depends(require_lab)])
    def advance(body: Advance):
        nonlocal offset
        with lock:
            offset += dt.timedelta(minutes=body.minutes)
            return state()

    @app.post('/__lab/ready', dependencies=[Depends(require_lab)])
    def ready():
        nonlocal offset
        with lock:
            active = checkins.get_active(USER_ID)
            if not active:
                raise HTTPException(409, 'Start a check-in before advancing to its finish time')
            target = checkins.utc(active['finish_after']) + dt.timedelta(seconds=1)
            offset += max(dt.timedelta(), target-clock())
            return state()

    @app.post('/__lab/reset', dependencies=[Depends(require_lab)])
    def reset():
        nonlocal offset
        with lock:
            # This is always the memory client created above, never MongoClient(uri).
            client.drop_database(DATABASE)
            db.set_client(client)
            offset = dt.timedelta()
            seed()
            return state()

    app.state.badge_lab_client = client
    return app
