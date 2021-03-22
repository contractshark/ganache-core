#!/bin/bash -e

# Exit script as soon as a command fails.
set -o errexit

trap onexit EXIT

ganache_port=8545

onexit() {
  # Kill the ganache instance that we started (if we started one and if it's still running).
  if [ -n "$ganache_pid" ] && ps -p $ganache_pid > /dev/null; then
    kill -9 $ganache_pid
  fi
}

ganache_running() {
  nc -z localhost "$ganache_port"
}

start_ganache() {
  npx ganache-cli --port $ganache_port --networkId 4447 --gasPrice 1000 --deterministic > /dev/null &
  ganache_pid=$!

  while ! ganache_running; do
    sleep 0.1
  done
}

if ganache_running; then
  echo "Using existing ganache instance" >&2
else
  echo "Starting our own ganache instance" >&2
  start_ganache
fi
