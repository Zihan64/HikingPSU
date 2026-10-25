"""Local launcher: load only the explicitly chosen developer configuration."""
import argparse
from pathlib import Path
from urllib.parse import urlparse

import uvicorn
from dotenv import load_dotenv

from .access import Settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file',type=Path,required=True)
    parser.add_argument('--check',action='store_true',help='Validate local configuration without starting a server')
    args = parser.parse_args()
    if not args.env_file.is_file():
        raise SystemExit('Developer configuration is missing; copy .env.devtools.example to .env.devtools.local and configure Auth0/allowlist first.')
    load_dotenv(args.env_file,override=True)
    settings = Settings.from_env()
    origin = urlparse(settings.origin)
    if settings.origin not in {'http://127.0.0.1:5176','http://localhost:5176'}:
        raise SystemExit('The local launcher requires the exact localhost:5176 origin. Use the documented separate service command for hosted deployments.')
    if args.check:
        print('Developer configuration validated; authorization is still required.')
        return
    uvicorn.run('dev.badge_lab:create_app',factory=True,host='127.0.0.1',port=origin.port,access_log=False)


if __name__ == '__main__': main()
