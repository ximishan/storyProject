#!/usr/bin/env python3
"""One-off APIMart image-generation probe.

The script intentionally does not read or write Storybound config. Pass the key
on the command line or through APIMART_API_KEY. Proxy use is explicit so the
test does not depend on global Windows or shell proxy state.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def build_opener(proxy: str | None) -> urllib.request.OpenerDirector:
    if proxy:
        handler = urllib.request.ProxyHandler({"http": proxy, "https": proxy})
    else:
        # Disable inherited HTTP(S)_PROXY for a clean direct test.
        handler = urllib.request.ProxyHandler({})
    return urllib.request.build_opener(handler)


def request_json(
    opener: urllib.request.OpenerDirector,
    url: str,
    method: str,
    headers: dict[str, str],
    body: dict[str, object] | None,
    timeout: float,
) -> tuple[int, dict[str, object], str]:
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {**headers, "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with opener.open(req, timeout=timeout) as response:
            text = response.read().decode("utf-8", errors="replace")
            payload = json.loads(text) if text.strip() else {}
            return response.status, payload, text
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(text) if text.strip() else {}
        except json.JSONDecodeError:
            payload = {"raw": text}
        return error.code, payload, text


def extract_task_id(payload: dict[str, object]) -> str:
    data = payload.get("data")
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict) and first.get("task_id"):
            return str(first["task_id"])
    if isinstance(data, dict) and data.get("task_id"):
        return str(data["task_id"])
    if payload.get("task_id"):
        return str(payload["task_id"])
    return ""


def extract_image_url(payload: dict[str, object]) -> str:
    data = payload.get("data")
    if not isinstance(data, dict):
        return ""
    result = data.get("result")
    if not isinstance(result, dict):
        return ""
    images = result.get("images")
    if isinstance(images, list) and images:
        first = images[0]
        if isinstance(first, dict):
            url = first.get("url")
            if isinstance(url, list) and url:
                return str(url[0])
            if isinstance(url, str):
                return url
            if first.get("image_url"):
                return str(first["image_url"])
    if result.get("url"):
        return str(result["url"])
    return ""


def trim_payload(payload: dict[str, object]) -> str:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    return text if len(text) <= 4000 else text[:4000] + "\n... <trimmed>"


def download(opener: urllib.request.OpenerDirector, url: str, output: Path, timeout: float) -> None:
    req = urllib.request.Request(url, method="GET")
    with opener.open(req, timeout=timeout) as response:
        output.write_bytes(response.read())


def main() -> int:
    parser = argparse.ArgumentParser(description="Submit and poll an APIMart image generation request.")
    parser.add_argument("--api-key", default=os.environ.get("APIMART_API_KEY") or os.environ.get("APIMART_KEY") or "")
    parser.add_argument("--base-url", default="https://api.apib.ai/v1")
    parser.add_argument("--proxy", default="http://127.0.0.1:7897")
    parser.add_argument("--no-proxy", action="store_true")
    parser.add_argument("--prompt", default="A small red apple on a plain white table, studio lighting.")
    parser.add_argument("--size", default="9:16")
    parser.add_argument("--resolution", default="1k")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--poll-interval", type=float, default=3.0)
    parser.add_argument("--poll-timeout", type=float, default=180.0)
    parser.add_argument("--output", default="D:/storybound/source/.apimart-probe.png")
    args = parser.parse_args()

    proxy = None if args.no_proxy else (args.proxy.strip() or None)
    opener = build_opener(proxy)
    base_url = args.base_url.rstrip("/")
    endpoint = f"{base_url}/images/generations"
    headers = {
        "Authorization": f"Bearer {args.api_key}",
        "Accept": "application/json",
    }
    body = {
        "model": "gpt-image-2",
        "prompt": args.prompt,
        "n": 1,
        "size": args.size,
        "resolution": args.resolution,
        "official_fallback": False,
    }

    print(f"endpoint: {endpoint}")
    print(f"proxy: {proxy or '<direct>'}")
    print(f"api_key: {'<set>' if args.api_key else '<missing>'}")
    if not args.api_key:
        print("warning: no API key was provided; this can still test network/TLS, but cannot create a real image.")

    try:
        status, payload, _ = request_json(opener, endpoint, "POST", headers, body, args.timeout)
    except Exception as error:
        print(f"submit_error: {type(error).__name__}: {error}")
        return 2

    print(f"submit_status: {status}")
    print("submit_payload:")
    print(trim_payload(payload))

    task_id = extract_task_id(payload)
    if not task_id:
        print("result: no task_id returned; stopping before poll.")
        return 1 if status >= 400 else 0

    print(f"task_id: {task_id}")
    status_url = f"{base_url}/tasks/{urllib.parse.quote(task_id)}"
    started = time.monotonic()
    while time.monotonic() - started < args.poll_timeout:
        time.sleep(args.poll_interval)
        try:
            poll_status, poll_payload, _ = request_json(opener, status_url, "GET", headers, None, args.timeout)
        except Exception as error:
            print(f"poll_error: {type(error).__name__}: {error}")
            continue
        data = poll_payload.get("data") if isinstance(poll_payload, dict) else {}
        remote_status = ""
        if isinstance(data, dict):
            remote_status = str(data.get("status") or "")
        print(f"poll_status: http={poll_status} remote={remote_status or '<unknown>'}")
        if remote_status.lower() == "completed":
            image_url = extract_image_url(poll_payload)
            if not image_url:
                print("result: completed but no image url found.")
                print(trim_payload(poll_payload))
                return 1
            output = Path(args.output)
            try:
                download(opener, image_url, output, args.timeout)
            except Exception as error:
                print(f"download_error: {type(error).__name__}: {error}")
                return 2
            print(f"image_saved: {output}")
            return 0
        if remote_status.lower() in {"failed", "error", "cancelled", "canceled", "rejected", "expired"}:
            print("result: remote task failed.")
            print(trim_payload(poll_payload))
            return 1

    print("result: poll timeout.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
