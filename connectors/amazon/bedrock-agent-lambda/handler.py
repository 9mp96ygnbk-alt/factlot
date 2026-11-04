"""Amazon Bedrock Agents action-group Lambda for FactLot.

Attach this Lambda as the executor of an action group whose API schema is FactLot's
OpenAPI 3.0 document (https://api.factlot.com/openapi-3.0.json?operations=all for every tool, or
the curated subset at /openapi-3.0.json, also packaged as factlot.openapi("3.0")).
It runs the FactLot tools in-process; the Lambda makes no network calls.

Bedrock sends each request-body property as {name, type, value} with `value` as a string;
nested objects and arrays arrive as JSON text. This handler converts them back to typed
JSON before calling the tool, and returns the FactLot result (or its error) as the body.
Package: `pip install factlot -t .` alongside this file (no other dependencies).
"""

from __future__ import annotations

import json
from typing import Any

import factlot

_PATH_TO_TOOL = {t["path"]: t["name"] for t in factlot.tool_definitions()}


def _coerce(prop: dict[str, Any]) -> Any:
    value, kind = prop.get("value"), prop.get("type", "string")
    if not isinstance(value, str):
        return value
    try:
        if kind == "integer":
            return int(value)
        if kind == "number":
            return float(value) if any(c in value for c in ".eE") else int(value)
        if kind == "boolean":
            return value.strip().lower() == "true"
        if kind in ("array", "object"):
            return json.loads(value)
    except (ValueError, json.JSONDecodeError):
        return value
    return value


def to_arguments(event: dict[str, Any]) -> dict[str, Any]:
    """Rebuild the JSON request body from a Bedrock Agents action-group event."""
    content = ((event.get("requestBody") or {}).get("content") or {}).get("application/json") or {}
    args = {p["name"]: _coerce(p) for p in content.get("properties", []) if "name" in p}
    for p in event.get("parameters") or []:
        args.setdefault(p["name"], _coerce(p))
    return args


def lambda_handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    api_path = event.get("apiPath", "")
    tool = _PATH_TO_TOOL.get(api_path)
    if tool is None:
        status, body = 404, {"error": "NotFound", "message": f"no FactLot operation at {api_path}"}
    else:
        body = factlot.run_tool(tool, to_arguments(event))
        status = 400 if "error" in body else 200
    return {
        "messageVersion": "1.0",
        "response": {
            "actionGroup": event.get("actionGroup"),
            "apiPath": api_path,
            "httpMethod": event.get("httpMethod", "POST"),
            "httpStatusCode": status,
            "responseBody": {"application/json": {"body": json.dumps(body)}},
        },
        "sessionAttributes": event.get("sessionAttributes", {}),
        "promptSessionAttributes": event.get("promptSessionAttributes", {}),
    }
