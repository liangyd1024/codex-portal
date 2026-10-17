#!/bin/bash
set -e
/bin/launchctl bootout "gui/$(/usr/bin/id -u)/local.remote-codex-manager.web"
printf '本机网页服务已停止。远端任务不会因此停止。\n'
