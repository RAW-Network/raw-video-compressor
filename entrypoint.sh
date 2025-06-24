#!/bin/sh

chown -R node:node /usr/src/app/uploads /usr/src/app/compressed

exec su-exec node "$@"
