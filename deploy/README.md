# Deployment

The worker is designed to run on demand during development (Windows 11) and as a
24/7 background service in production (Apple Silicon Mac mini). The same compiled
artifact (`dist/cli/index.js worker`) runs in both places.

## Prerequisites (both platforms)

- Node.js 20+
- `ffmpeg` and `yt-dlp` on `PATH` (or set `CLIPPER_FFMPEG_PATH` / `CLIPPER_YT_DLP_PATH`)
- A populated `.env` (see `.env.example`)
- `pnpm install && pnpm build`

Verify a machine is ready with:

```sh
node dist/cli/index.js doctor
```

## Production — Mac mini (launchd, 24/7)

On Apple Silicon the renderer automatically uses the hardware **VideoToolbox**
H.264 encoder (faster and cooler for continuous operation).

1. Build: `pnpm install && pnpm build`
2. Edit `deploy/launchd/is.neat.clipper-agent.worker.plist` — replace the
   `REPLACE_ME` paths and confirm the `node` path (`which node`).
3. Install & load:

   ```sh
   cp deploy/launchd/is.neat.clipper-agent.worker.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/is.neat.clipper-agent.worker.plist
   ```

4. The service runs at load and on reboot, and restarts on crash (`KeepAlive`).
   It stops cleanly on `launchctl unload` (the worker handles `SIGTERM`).

### Keeping the Mac mini awake

For a headless 24/7 box, disable idle sleep so the worker keeps running:

```sh
sudo pmset -a sleep 0 disksleep 0
# Optional belt-and-suspenders: run the worker under caffeinate
# ProgramArguments: /usr/bin/caffeinate -i /opt/homebrew/bin/node ... worker
```

### Disk hygiene

A 2h source VOD plus its rendered clips can be several GB. The worker writes to
the OS data dir (see `clipper doctor` for the path). Purge published clips and
old downloads on a schedule, e.g. a daily `launchd` job or `find ... -mtime +7 -delete`.

## Development — Windows 11

Run on demand:

```sh
pnpm build
node dist/cli/index.js clip "<source-url>"     # one-shot
node dist/cli/index.js worker --once           # drain the queue once and exit
node dist/cli/index.js review                   # open the review UI
```

To run the worker continuously in the background, register a **Task Scheduler**
task: action `node`, arguments `C:\path\to\clipper-agent\dist\cli\index.js worker`,
start-in `C:\path\to\clipper-agent`, trigger "At log on" / "At startup", and set
"Restart the task if it fails".

## CLI reference

```
clipper doctor             Check environment (binaries, config, paths)
clipper clip <url>         Run the full pipeline once for a source URL
clipper enqueue <url>      Add a source URL to the job queue
clipper worker [--once]    Run the queue worker (daemon; --once drains and exits)
clipper review [port]      Start the local review-gate web UI (default 4310)
clipper publish            Publish approved clips to configured platforms
```
