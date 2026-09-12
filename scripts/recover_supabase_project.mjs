#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MANAGEMENT_API = "https://api.supabase.com/v1";

function required(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

async function responseJson(response, code) {
  if (!response.ok) throw new Error(`${code}_${response.status}`);
  const value = await response.json();
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${code}_json_invalid`);
  return value;
}

export async function recoverSupabaseProject(options) {
  const projectRef = required(options.projectRef, "supabase_project_ref_required");
  if (!/^[a-z]{20}$/u.test(projectRef))
    throw new Error("supabase_project_ref_invalid");
  const accessToken = required(
    options.accessToken,
    "supabase_access_token_required",
  );
  const request = options.request ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) =>
    new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const pollAttempts = options.pollAttempts ?? 40;
  const pollDelayMs = options.pollDelayMs ?? 15_000;
  const headers = Object.freeze({
    accept: "application/json",
    authorization: `Bearer ${accessToken}`,
  });
  const projectUrl = `${MANAGEMENT_API}/projects/${projectRef}`;
  const getProject = async () =>
    responseJson(
      await request(projectUrl, {
        headers,
        signal: AbortSignal.timeout(20_000),
      }),
      "supabase_project_read_failed",
    );

  const project = await getProject();
  const status = required(project.status, "supabase_project_status_invalid");
  let action;
  if (status === "INACTIVE") action = "restore";
  else if (status === "ACTIVE_HEALTHY") action = "restart";
  else action = "wait";
  if (action !== "wait") {
    const actionResponse = await request(`${projectUrl}/${action}`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (!actionResponse.ok)
      throw new Error(
        `supabase_project_${action}_failed_${actionResponse.status}`,
      );
    console.log(`Supabase project ${action} requested from status ${status}.`);
  } else {
    console.log(`Supabase project recovery already in progress (${status}).`);
  }

  for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
    await sleep(pollDelayMs);
    const current = await getProject();
    if (current.status === "ACTIVE_HEALTHY") {
      console.log("Supabase project is ACTIVE_HEALTHY.");
      return { action, status: current.status };
    }
  }
  throw new Error("supabase_project_recovery_timeout");
}

async function main() {
  await recoverSupabaseProject({
    projectRef: process.env.SUPABASE_PROJECT_REF,
    accessToken: process.env.SUPABASE_ACCESS_TOKEN,
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
