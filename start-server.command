#!/bin/bash
# Двойной клик запускает сервер игры. Не закрывай это окно, пока играешь.
cd "$(dirname "$0")"
echo "РИЗИ — сервер игр запущен."
echo "  раннер:    http://localhost:5199/run/"
echo "  версия 2:  http://localhost:5199/v2/"
echo "  классика:  http://localhost:5199/"
echo
echo "Чтобы остановить — закрой это окно или нажми Ctrl+C."
python3 -m http.server 5199
