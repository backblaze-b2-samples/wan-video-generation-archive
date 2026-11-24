# GPU host runbook (Vultr A40 or any single CUDA GPU)

How to run this sample, and its GPU gates, on one rented CUDA machine. It was
written for a Vultr Cloud GPU instance with an NVIDIA A40 (48 GB) on Ubuntu
22.04 or 24.04; any Linux host with one NVIDIA GPU of 24 GB or more works the
same way. Provisioning a paid instance is a human-approved action.

The API and the web app both run on the GPU host. Nothing listens publicly: you
reach the UI through an SSH tunnel, because the API is unauthenticated and
bucket-wide (see [docs/SECURITY.md](../../docs/SECURITY.md)).

## 1. Check the driver

```bash
nvidia-smi
```

You should see the GPU, its memory (about 46 GB usable on an A40) and a CUDA
version of 12.x or newer. If `nvidia-smi` is missing, use the provider's GPU
image (Vultr ships one with the driver preinstalled) rather than installing a
driver by hand.

## 2. Install the toolchain

```bash
sudo apt-get update && sudo apt-get install -y git curl build-essential
curl -LsSf https://astral.sh/uv/install.sh | sh        # uv, for Python 3.12
curl -fsSL https://fnm.vercel.app/install | bash         # Node version manager
source ~/.bashrc
fnm install 22 && corepack enable                        # Node 22 + pnpm
uv python install 3.12
```

## 3. Clone, set up, configure

```bash
git clone https://github.com/backblaze-b2-samples/wan-video-generation-archive.git
cd wan-video-generation-archive
pnpm run setup
```

`pnpm run setup` creates `services/api/.venv` with Python 3.12 and installs the
locked API dependencies. Then fill in the repo-root `.env` (created from
`.env.example`) with your B2 key, bucket and region, and add:

```bash
WAN_MODEL=wan2.2-ti2v-5b
HF_HOME=/mnt/local/hf-cache       # fast local disk, not a network volume
```

Put `HF_HOME` on the instance's local NVMe: the pinned weights are tens of GB
and load at every API start. Leave `HF_ENDPOINT` unset (or
`https://huggingface.co`). `HF_TOKEN` is optional.

## 4. Install the model stack

```bash
services/api/.venv/bin/pip install -r services/api/requirements-model.txt
services/api/.venv/bin/python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

The second line must print `True`. On Linux x86_64 the default PyTorch wheel is
the CUDA build.

## 5. Run the GPU gates

```bash
pnpm gpu:preflight                              # peak VRAM of the demo preset, offload off
RUN_LIVE_B2_TESTS=1 pnpm test:live:gpu          # full self-test against the bucket
```

The first run downloads the weights into `HF_HOME`. Paste the preflight's table
row into the README "GPU validation" table, and fill in the age job result and
whether the share link opened from the self-test output.

## 6. Start the app and open it through a tunnel

On the GPU host:

```bash
pnpm dev
```

On your laptop:

```bash
ssh -N -L 3000:localhost:3000 -L 8000:localhost:8000 <user>@<gpu-host>
```

Open `http://localhost:3000`. The browser talks to the API on
`localhost:8000` through the same tunnel, so the default CORS settings work.
Do not open ports 3000 or 8000 in the provider firewall.

## 7. Optional: a cron age job

```bash
# crontab -e on the GPU host: archive the demo project nightly at 03:00
0 3 * * * cd /path/to/wan-video-generation-archive/services/api && .venv/bin/python scripts/wan_archive.py age --project demo >> /var/log/wan-age.log 2>&1
```

Run it while the API is idle, or stop the API first: the API process is meant
to be the single writer of each manifest (see
[docs/RELIABILITY.md](../../docs/RELIABILITY.md)).

## 8. Teardown

- Stop `pnpm dev` and close the tunnel.
- Delete self-test leftovers only under their own prefixes (`video/recent/selftest-*`,
  `video/archive/selftest-*`, `video/manifests/selftest-*.jsonl`); the self-test
  cleans these up itself when it finishes.
- Destroy the instance when the attended run is over: GPU instances bill by the
  hour whether or not a job is running.
