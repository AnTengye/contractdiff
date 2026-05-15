---
name: mineru-task-status
description: Use when checking ContractDiff MinerU task status from log task_id or contract_id entries, especially after polling timeout, pending, stuck, or parser_type=mineru messages.
---

# MinerU Task Status

## Overview
Use the active ContractDiff `config.yaml` to query MinerU directly and report concise task state. Never print the configured token.

## Quick Use

From repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .agents/skills/mineru-task-status/scripts/query_mineru_task_status.ps1 -TaskId <task_id> [-TaskId <task_id2>]
```

For the Docker/dev setup in this project, the active config is usually `backend/config.yaml`. The script defaults to `backend/config.yaml`, then falls back to root `config.yaml`. Pass `-ConfigPath` when the user asks for a specific file.

## Workflow

1. Extract `task_id` values from logs. Keep `contract_id` only for the final mapping.
2. Run the script with all task ids in one command.
3. Report `task_id`, `data_id`, `state`, `err_msg`, `trace_id`, and whether `full_zip_url` is present.
4. Interpret results:
   - `pending`: MinerU accepted the query but the task is still queued/running.
   - `done`: result is available; `full_zip_url_present` should usually be true.
   - `failed`: include `err_msg`.
   - API auth/token errors: mention config/token issue without exposing the token.

## Common Mistakes

- Do not use the PaddleOCR URL; use `parsers.mineru.api_url`.
- Do not query by `contract_id`; MinerU status endpoint needs `task_id`.
- Do not paste or summarize `api_token`.
- Avoid complex multi-line regex parsing of YAML; use the script.
