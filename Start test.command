#!/bin/zsh -l
set -eu
cd "${0:A:h}"
python3 prototype.py host
python3 prototype.py client --number 1
